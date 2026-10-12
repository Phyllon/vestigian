# Vestigian — architecture overview

High-level map of how the pieces fit together, for anyone (human or agent)
picking this project up cold. Detail, reasoning and gotchas live in
`CLAUDE.md`; this is the shape of the thing, not the why.

## In one sentence

A Nuxt 4 app (Vue frontend + Nitro server, one process) renders a MapLibre map
of ancient-world sites from PostGIS vector tiles, backed by Valkey for caching
and rate limiting, Bunny.net + imgproxy for photographs, and a six-container
Grafana stack for observability — all deployed as one Docker Compose unit via
Dokploy on a single Netcup VPS.

## Request flow

```
Browser (MapLibre GL JS, vector tiles + GPU rendering)
   │
   │  HTTPS
   ▼
Traefik (TLS termination, routing, rate-limit middleware)
   │
   ├──► Nitro server (Nuxt's server, one Node process)
   │       │
   │       ├─ SSR page render (Vue) ── first paint, SEO, /site/[slug] etc.
   │       ├─ /api/tiles/**            MVT tile routes (see below)
   │       ├─ /api/sites, /tracings,   Drizzle ORM ── Postgres (site records)
   │       │  /auth, /contributions,
   │       │  /moderation, /limes
   │       ├─ /api/sites/:id/enrichment  proxy → Wikidata/Wikipedia,
   │       │                             cached in Valkey, translated via
   │       │                             self-hosted LibreTranslate
   │       └─ /api/images/:id/:preset  redirect → imgproxy
   │
   └──► imgproxy ──► Bunny.net object storage (originals) + Bunny CDN (edge)
```

Everything the browser needs for a screenful of map is one MVT request:

```
GET /api/tiles/{z}/{x}/{y}.mvt
   → validate coordinate
   → Valkey GET  (key: tile:v<dataVersion>:z:x:y)  — cache hit → return
   → miss: ST_AsMVT(...) against PostGIS, using the GiST index on sites.geom
   → Valkey SET, return binary tile
```

The same pattern repeats for several more tile families, each a separate
route so a reader who never asks for them pays nothing:

- `/api/tiles/antiquity/{z}/{x}/{y}.mvt` — the Barrington sheet (AWMC + Pleiades
  data, imported once, its own cache generation)
- `/api/tiles/limes/{z}/{x}/{y}.mvt` — the Roman frontier, drawn over the
  Barrington sheet when switched on, riding the same cache generation
- `/api/tiles/antiquity-{battles,ports,routes,features,coin-hoards,empire}/{z}/{x}/{y}.mvt`
  — one route per switchable overlay (Wikidata battles, ancient ports,
  ORBIS routes, AWMC minor antiquities, CHRR coin hoards, OpenHistoricalMap
  empire extents), each off by default and each with its own MapLibre
  `attribution` string
- `/api/tiles/basemap/{z}/{x}/{y}.get.ts` — reads one tile out of the
  production PMTiles archive server-side, used only by the offline
  download flow so it gets one ordinary, cacheable HTTP response per tile

## Data layer

| Store                         | Holds                                                                                                                                                                                    | Notes                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL + PostGIS**      | Everything durable: `sites`, `tracings`, `users`, `revisions`, `antiquity_*` (AWMC/Pleiades, read-only reference data), `limes_*` (derived frontier), `import_runs` (import bookkeeping) | One instance, ~190 MB of real data. Drizzle is the default client; raw SQL (`useSql()`) only where PostGIS functions are needed |
| **Valkey** (Redis-compatible) | Tile cache, sessions, rate-limit counters, enrichment cache                                                                                                                              | No persistence for tiles — regenerable. `--maxmemory 1gb`, LRU eviction                                                         |
| **Bunny.net**                 | Original site photographs (one per image)                                                                                                                                                | imgproxy generates every displayed size on the fly; zero egress from the origin                                                 |
| **Bunny CDN**                 | Edge cache for imgproxy output and static assets                                                                                                                                         |                                                                                                                                 |

## Background work (not request-driven)

- **Import pipeline** (`scripts/import/`): a resumable, numbered pipeline
  (26 stages and growing), run by the maintainers rather than by every
  copy of the project, since it reads other people's servers. It pulls
  vici.org's MySQL dump, converts it to
  the Postgres schema, mirrors photographs and the DARE raster basemap,
  builds the Barrington/limes vector data, and imports every later overlay
  (battles, ports, routes, minor antiquities, coin hoards, empire extents,
  Tabula Peutingeriana, column relief plates, modern cities, three inscription
  corpora, Itiner-e roads, Nomisma mints, Wikidata monuments, Cliopatria realms, the
  Atlas of Hillforts). Run once per environment, not per request.
- **`pnpm tiles:warm`**: pre-populates the Valkey tile cache after a deploy or
  bulk import so the first visitors don't pay for cold PostGIS renders.
  Each guarded stage records its row count and a checksum in `import_runs`
  and refuses an implausible delta (`scripts/import/guard.ts`), so an upstream
  that silently changed shape stops the import rather than quietly rewriting
  the map.
- **`pnpm db:snapshot`** / **`pnpm images:reconcile`**: nightly-ish maintenance,
  not wired to a scheduler beyond `docker/backup.sh` in production.
- **Nightly backup** (`docker/backup.sh`, production): `pg_dump` kept 14 days
  locally _and_ pushed off the machine to an encrypted restic repository —
  one VPS is one failure domain. `docker/restore-drill.sh` is the part that
  proves a snapshot actually restores; four Loki alerts watch for the backup
  quietly stopping, which is the real failure mode rather than one that errors.

## Governance / write path

Every edit to a site or tracing goes through one function,
`applyRevision()` in `server/utils/revisions.ts` — the only place a live row
is written. A revision is recorded before the live table changes, trust level
decides whether it publishes immediately or queues for a moderator, and
reverts write a new revision rather than deleting history. Authorization rules
live in one file, `shared/utils/authorization.ts`, imported by both the client
(to hide controls) and the server (to actually enforce).

Drift sampling sits beside that path without becoming part of it: a fraction
of auto-approved work is drawn back for a second look **after** it publishes
(`server/utils/sampling.ts`), weighted towards newly trusted accounts and
floored so no account becomes permanently unwatched. It writes
`revisions.sampled_at`, never `status` — making it a gate would undo the whole
promise of trust.

`/admin` (admin role only, `server/api/admin/**`) sits above this as a
governance layer, not a second write path: banning an account is a column
flip plus a `users.sessions_valid_from` bump (the app's only session
revocation, since sessions are stateless), and its bulk "take this account's
work offline" sweep still goes through `applyRevision()` — a revision
carrying `retracted: true` for records the person created, an ordinary
revert for edits they made to someone else's. Role changes and bans require
re-entering the password (step-up), which fails closed on a cache outage —
the one place this app is not fail-open by default.

## Observability

One request in, three signals out, via a single per-request Nitro plugin
(`server/plugins/observability.ts`):

```
Nitro app ──stdout(JSON)──► Alloy ──► Loki   (logs)
           ──OTel spans────► Alloy ──► Tempo  (traces)
           ──/api/metrics──► Alloy ──► Prometheus (metrics) ──► Alertmanager
                                              │
                                              ▼
                                          Grafana (loopback-only, SSH tunnel)
```

Alloy is the one agent carrying all three signals plus built-in Postgres/Redis
exporters, replacing what would otherwise be four separate exporter
containers. Everything lives on local disk with bounded retention (15d
metrics, 30d logs, 7d traces).

## Security layer

CrowdSec reads the app's structured logs and writes ban/captcha decisions;
nothing currently enforces them (no bouncer wired to Traefik yet — see
`docker/security/README.md`). Application-level defenses that do run today:
argon2id password hashing, ALTCHA proof-of-work + a disposable-email-domain
check on signup (also enforced on email change), per-IP rate limits enforced
through Valkey (fail open, logged), a strict CSP, a session cookie that now
actually expires, and the `/admin` governance layer above (step-up
re-authentication, fail-closed, an append-only audit log). Every response now
also carries a verified `Strict-Transport-Security` and
`Cross-Origin-Resource-Policy` (`nuxt-security`'s own delivery of both was
confirmed broken outside HTML responses) and defaults to
`cache-control: private, no-store` unless a route has explicitly opted into
public caching (`server/middleware/security-defaults.ts`) — none of which
protects anything if Bunny's pull zone is configured to override cache
control, which is a dashboard setting outside this repo's control.

## Deployment

```
git push → GitHub Actions (test, build multi-stage image) → GHCR
                                                                │
                                                                ▼
                                                      Dokploy webhook
                                                                │
                                                                ▼
                                              docker/compose.prod.yml
                                    (app + postgres + valkey + imgproxy +
                                     libretranslate + backup + 6 observability
                                     containers + crowdsec, one Netcup VPS)
```

Dokploy _is_ Docker Compose with a UI and a webhook — dev and prod run the same
compose artifact, just different files (`compose.dev.yml` vs
`compose.prod.yml`). The app itself is strictly 12-factor (env-only config, no
local disk writes, `/api/health` + `/api/ready`), so a future move to
Kubernetes would be a translation of the same containers, not a rewrite.

## Directory-to-architecture map

| Layer                                                                            | Where                                                                                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| UI / map rendering                                                               | `app/components/map/` (basemap switcher + separate overlay switcher), `app/composables/map/`                                                    |
| Column relief viewers (OpenSeadragon)                                            | `app/components/columns/`, `app/composables/columns/`                                                                                           |
| Record detail, contribution forms                                                | `app/components/site/`, `contribute/`, `moderation/`                                                                                            |
| Admin command station                                                            | `app/pages/admin/`, `app/components/admin/`, `server/api/admin/**`                                                                              |
| Epigraphy (EDH, Attic Inscriptions Online, I.Sicily)                             | `app/pages/inscriptions/`, `app/components/epigraphy/`, `server/utils/inscriptions.ts`, `isicily-inscriptions.ts`, `server/api/inscriptions/**` |
| Reference overlays (Itiner-e, Nomisma, Wikidata monuments, I.Sicily, Cliopatria) | `server/utils/reference-layers.ts`, `server/api/tiles/reference/**`, `antiquity-polities/**`, `app/composables/map/useReferenceOverlays.ts`     |
| Domain vocabulary shared by client + server                                      | `shared/types/`, `shared/utils/`                                                                                                                |
| API routes                                                                       | `server/api/**` (one file per route, Nitro file-based routing)                                                                                  |
| Tile SQL generation                                                              | `server/utils/mvt.ts`, `atlas.ts`, `limes.ts`, `reference-layers.ts`                                                                            |
| Governance (revisions, trust, permissions)                                       | `server/utils/revisions.ts`, `permissions.ts`, `sampling.ts`                                                                                    |
| Open-data feeds out (GeoJSON + Linked Places)                                    | `server/api/data/**`, `shared/utils/linkedPlaces.ts`                                                                                            |
| Contribution queue ("what needs work near me")                                   | `server/api/sites/needs-work.get.ts`, `shared/utils/completeness.ts`, `app/pages/nearby.vue`                                                    |
| Info-box facts for a coordinate (town, country, elevation, extent)               | `server/api/spot.get.ts`, `server/utils/spot.ts`, `terrain.ts`, `app/composables/map/useSpotFacts.ts`                                           |
| Local security scanning                                                          | `scripts/security/`, `.opengrep/rules/`                                                                                                         |
| DB schema (Drizzle)                                                              | `server/database/schema/`                                                                                                                       |
| Hand-written SQL migrations                                                      | `server/database/migrations/`                                                                                                                   |
| One-off data pipelines                                                           | `scripts/import/`, `scripts/*.ts`                                                                                                               |
| Container definitions                                                            | `docker/`                                                                                                                                       |

## What this diagram leaves out

Deliberately: the reasoning behind each choice (why PostGIS over bbox
queries, why Valkey over a CDN-side cache, why one counter invalidates the
whole tile pyramid), which lives in `CLAUDE.md` under "Stack and why" and
"How the map stays fast". This file is the shape; that file is the why.
