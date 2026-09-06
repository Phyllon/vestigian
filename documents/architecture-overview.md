# Vestigian — architecture overview

High-level map of how the pieces fit together, for anyone (human or agent)
picking this project up cold. Detail, reasoning and gotchas live in
`CLAUDE.md`; this is the shape of the thing, not the why.

## In one sentence

A Nuxt 4 app (Vue frontend + Nitro server, one process) renders a MapLibre map
of ancient-world sites from PostGIS vector tiles, backed by Valkey for caching
and rate limiting, Bunny.net + imgproxy for photographs, and a six-container
Grafana stack for observability — all deployed as one Docker Compose unit via
Dokploy on a single Hetzner VPS.

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

The same pattern repeats for two more tile families, each a separate route so
a reader who never asks for them pays nothing:

- `/api/tiles/antiquity/{z}/{x}/{y}.mvt` — the Barrington sheet (AWMC + Pleiades
  data, imported once, its own cache generation)
- `/api/tiles/limes/{z}/{x}/{y}.mvt` — the Roman frontier, drawn over the
  Barrington sheet when switched on, riding the same cache generation

## Data layer

| Store                         | Holds                                                                                                                                                | Notes                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL + PostGIS**      | Everything durable: `sites`, `tracings`, `users`, `revisions`, `antiquity_*` (AWMC/Pleiades, read-only reference data), `limes_*` (derived frontier) | One instance, ~190 MB of real data. Drizzle is the default client; raw SQL (`useSql()`) only where PostGIS functions are needed |
| **Valkey** (Redis-compatible) | Tile cache, sessions, rate-limit counters, enrichment cache                                                                                          | No persistence for tiles — regenerable. `--maxmemory 1gb`, LRU eviction                                                         |
| **Bunny.net**                 | Original site photographs (one per image)                                                                                                            | imgproxy generates every displayed size on the fly; zero egress from the origin                                                 |
| **Bunny CDN**                 | Edge cache for imgproxy output and static assets                                                                                                     |                                                                                                                                 |

## Background work (not request-driven)

- **Import pipeline** (`scripts/import/`): a six-stage, resumable pipeline that
  pulls vici.org's MySQL dump, converts it to the Postgres schema, mirrors
  photographs and the DARE raster basemap, and builds the Barrington/limes
  vector data. Run once per environment, not per request.
- **`pnpm tiles:warm`**: pre-populates the Valkey tile cache after a deploy or
  bulk import so the first visitors don't pay for cold PostGIS renders.
- **`pnpm db:snapshot`** / **`pnpm images:reconcile`**: nightly-ish maintenance,
  not wired to a scheduler beyond `docker/backup.sh` in production.

## Governance / write path

Every edit to a site or tracing goes through one function,
`applyRevision()` in `server/utils/revisions.ts` — the only place a live row
is written. A revision is recorded before the live table changes, trust level
decides whether it publishes immediately or queues for a moderator, and
reverts write a new revision rather than deleting history. Authorization rules
live in one file, `shared/utils/authorization.ts`, imported by both the client
(to hide controls) and the server (to actually enforce).

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
argon2id password hashing, ALTCHA proof-of-work on signup, per-IP rate limits
enforced through Valkey (fail open, logged), a strict CSP, and a session
cookie that now actually expires.

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
                                     containers + crowdsec, one Hetzner VPS)
```

Dokploy _is_ Docker Compose with a UI and a webhook — dev and prod run the same
compose artifact, just different files (`compose.dev.yml` vs
`compose.prod.yml`). The app itself is strictly 12-factor (env-only config, no
local disk writes, `/api/health` + `/api/ready`), so a future move to
Kubernetes would be a translation of the same containers, not a rewrite.

## Directory-to-architecture map

| Layer                                       | Where                                                          |
| ------------------------------------------- | -------------------------------------------------------------- |
| UI / map rendering                          | `app/components/map/`, `app/composables/map/`                  |
| Record detail, contribution forms           | `app/components/site/`, `contribute/`, `moderation/`           |
| Domain vocabulary shared by client + server | `shared/types/`, `shared/utils/`                               |
| API routes                                  | `server/api/**` (one file per route, Nitro file-based routing) |
| Tile SQL generation                         | `server/utils/mvt.ts`, `atlas.ts`, `limes.ts`                  |
| Governance (revisions, trust, permissions)  | `server/utils/revisions.ts`, `permissions.ts`                  |
| DB schema (Drizzle)                         | `server/database/schema/`                                      |
| Hand-written SQL migrations                 | `server/database/migrations/`                                  |
| One-off data pipelines                      | `scripts/import/`, `scripts/*.ts`                              |
| Container definitions                       | `docker/`                                                      |

## What this diagram leaves out

Deliberately: the reasoning behind each choice (why PostGIS over bbox
queries, why Valkey over a CDN-side cache, why one counter invalidates the
whole tile pyramid), which lives in `CLAUDE.md` under "Stack and why" and
"How the map stays fast". This file is the shape; that file is the why.
