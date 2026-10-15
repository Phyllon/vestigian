# Vestigian — Project Summary

_An atlas of the ancient world, recorded by the people who visit it._

This document is a technical deep-dive for interested, technically literate
readers. It covers accessibility, security, architecture, the technology
stack, the request lifecycle, the full feature set, how borrowed data is
cross-checked and enriched, and the legal/GDPR posture. It reflects the
codebase and its documented design decisions as of **2026-09-12**.

---

## Table of contents

1. [What Vestigian is](#1-what-vestigian-is)
2. [Architecture](#2-architecture)
3. [Technology stack](#3-technology-stack)
4. [Request flow](#4-request-flow)
5. [Feature list](#5-feature-list)
6. [Cross-information, verification & enrichment](#6-cross-information-verification--enrichment)
7. [Accessibility (a11y)](#7-accessibility-a11y)
8. [Security](#8-security)
9. [GDPR & legal](#9-gdpr--legal)
10. [Observability](#10-observability)
11. [Other notable engineering decisions](#11-other-notable-engineering-decisions)

---

## 1. What Vestigian is

Vestigian ("traces") is an atlas of the ancient world — settlements, roads,
fortifications, findspots — built on openly-licensed data originally
compiled by [vici.org](https://vici.org), reimplemented independently with
its own visual language, stack, and governance model. It is **not** a fork:
the data is shared, the code and character are not.

**Design brief:** "a field notebook carried through Roman Europe." Aged
laid-paper backgrounds, iron-gall-ink text, one oxide-red accent used once
per screen, bronze linear features, verdigris reserved for
approved/confirmed states, self-hosted Fraunces/IBM Plex type — every visual
decision traces back to that one sentence.

**Status:** the map runs on real, imported data — 61,272 sites, 11,720
tracings, rendered live through PostGIS `ST_AsMVT`. Everything above the map
(auth, contribution, moderation, revisions) has since been built out and
exercised, including a full opt-in two-factor authentication system.

---

## 2. Architecture

### 2.1 High-level system diagram

```mermaid
flowchart TB
    subgraph Client["Browser"]
        UI["Nuxt 4 SPA/SSR\nMapLibre GL JS v6"]
        SW["Service Worker\n(offline cache)"]
    end

    subgraph Edge["Edge / CDN"]
        Bunny["Bunny.net CDN"]
        Traefik["Traefik (TLS termination)"]
    end

    subgraph App["Application VPS (Dokploy / Docker Compose)"]
        Nitro["Nitro server (Nuxt SSR + API)"]
        Valkey[("Valkey\ncache / sessions / rate limits")]
        Postgres[("PostgreSQL + PostGIS")]
        LibreTranslate["LibreTranslate\n(self-hosted MT)"]
        CrowdSec["CrowdSec\n(detection only)"]
    end

    subgraph Observability["Observability stack"]
        Alloy["Grafana Alloy\n(logs+traces+metrics agent)"]
        Loki[("Loki")]
        Tempo[("Tempo")]
        Prometheus[("Prometheus")]
        Grafana["Grafana (loopback only)"]
    end

    subgraph External["External / borrowed data & services"]
        Wikidata["Wikidata / Wikipedia"]
        DARE["DARE tiles (Gothenburg)"]
        EOX["EOX Sentinel-2 (Vienna)"]
        Voorburg["OmnesViae IIIF (Voorburg)"]
        Lettermint["Brevo (EU mail)"]
        ImgProxy["imgproxy + Bunny storage"]
    end

    UI -->|HTTPS| Bunny --> Traefik --> Nitro
    UI <-. range requests .-> Bunny
    SW -. precache/serve .- UI
    Nitro --> Postgres
    Nitro --> Valkey
    Nitro --> LibreTranslate
    Nitro -->|proxied, IP hidden| Wikidata
    Nitro --> ImgProxy
    UI -.tiles.-> DARE
    UI -.tiles.-> EOX
    UI -.IIIF.-> Voorburg
    Nitro --> Lettermint
    Nitro -->|logs/traces/metrics| Alloy
    CrowdSec -->|reads structured logs| Nitro
    Alloy --> Loki & Tempo & Prometheus
    Grafana --> Loki & Tempo & Prometheus
```

### 2.2 Why these choices

| Layer                          | Choice                                          | Why (vs. the alternative)                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Map rendering                  | **MapLibre GL JS v6**                           | Vector + GPU; clusters 20k+ sites and styles 1k+ tracings without DOM thrashing (Leaflet) and with better mobile feel than OpenLayers; no per-load fee (Mapbox GL).                        |
| Spatial queries                | **PostGIS `ST_AsMVT`**                          | Answers the viewport with _tiles_, not bbox GeoJSON — the single most important architectural decision in the project.                                                                     |
| Basemap delivery               | **PMTiles** (OpenFreeMap in dev)                | Custom style keeps the app's own character; read directly by the browser over HTTP range requests — **no tile server process**.                                                            |
| ORM                            | **Drizzle + `postgres.js`**                     | TypeScript-first, compile-time-checked columns; raw SQL kept to exactly the PostGIS operations a query builder cannot express.                                                             |
| Cache/session/rate-limit store | **Valkey**                                      | Redis-compatible, no licensing ambiguity.                                                                                                                                                  |
| Media                          | **Bunny.net + imgproxy**                        | One stored original per image; derivatives generated on the fly; zero egress cost.                                                                                                         |
| Mail                           | **Brevo** (EU)                                  | Transactional mail entirely inside the EU — operator's choice, replacing Lettermint (itself a replacement for a US-hosted provider).                                                       |
| Drawing tool                   | **terra-draw**                                  | Framework-agnostic vector drawing that plugs directly into MapLibre.                                                                                                                       |
| Telemetry                      | **Grafana + Loki + Tempo + Prometheus + Alloy** | One agent (Alloy) carries logs, traces _and_ metrics — Vector carries no traces, and Alloy's built-in exporters replace four separate exporter containers. Everything lands on local disk. |
| Deployment                     | **Dokploy on one Netcup VPS**                   | One machine, no cluster to run; Dokploy _is_ Compose, so dev and prod share one artifact.                                                                                                  |

The application is strictly **12-factor** (env-only config, no local-disk
writes, `/api/health` + `/api/ready`), so a future move to Kubernetes is a
translation exercise, not a rewrite.

### 2.3 Governance & data-write architecture

Every mutation to a shared record (a site or a tracing) is designed around
one non-negotiable rule:

```mermaid
sequenceDiagram
    participant U as Contributor
    participant API as /api/contributions
    participant Rev as revisions table
    participant AR as applyRevision()
    participant Live as sites / tracings (live tables)
    participant Trust as evaluateTrust()
    participant Mail as notifications

    U->>API: submit draft (validated + sanitized)
    API->>Rev: INSERT revision (pending)
    alt trust >= threshold AND not a blanking edit
        AR->>Live: write immediately (auto-approve)
    else queued
        Note over Rev: awaits moderator review
        Rev->>AR: moderator approves
        AR->>Live: write
    end
    AR->>Trust: update contributor trust counter
    AR-->>Mail: fire-and-forget notify author
```

Key invariants (enforced in code, documented in `CLAUDE.md`, and treated as
load-bearing — never to be "quietly" weakened):

- **`applyRevision()` is the only function that ever writes a live row.**
  Automatic approval, moderator approval, and revert all funnel through it.
- **History is append-only.** A revert writes a _new_ revision restoring the
  prior state; nothing is ever deleted.
- **Trust model:** new accounts are queued; after 2 accepted contributions,
  edits publish immediately (`evaluateTrust`). Moderators can revoke trust.
  A moderator can never approve their own contribution.
- **An edit that removes more than it adds is always queued**, regardless of
  the author's trust level (`isBlankingEdit`).
- **Nobody can change their own role, and no admin can demote another
  admin** — removing an admin requires direct database access, the same as
  creating the very first one.
- **Role/trust are re-read from the database on every guarded request** —
  never trusted from the session cookie, so a demotion takes effect on the
  very next request rather than at next login.
- **Slugs never change on edit** — inbound links, citations, and the sitemap
  all depend on permanence.
- **`users.sessions_valid_from` is the only session revocation this app
  has.** Sessions are stateless sealed cookies with nothing server-side to
  delete, so ending one is a comparison, not a deletion: anything sealed
  before that column is dead on its next request. Banning an account, lifting
  a ban, and an admin's "end this session" action are the only three things
  that bump it.
- **A ban stops the person, not their work.** Published sites, tracings,
  photographs and revision history are left untouched; taking a banned
  account's work off the atlas is a separate, deliberate, reversible sweep,
  never a side effect of the ban itself — see §5.10.
- **No admin can ever ban or demote another admin, unconditionally** — not
  "while more than one exists." Removing a rogue or compromised co-admin
  requires the same direct database access as creating the first one,
  deliberately slower than a button any admin could press against any other.
- **Drift sampling is post-hoc and must never become a gate.** Trust was
  binary and permanent-until-revoked: two accepted contributions and
  everything afterwards published immediately, with nothing ever looking
  again. That is blind to the contributor who behaves well enough to earn
  trust and then degrades records slowly. A fraction of auto-approved work is
  now drawn back for a second look **after** it publishes
  (`server/utils/sampling.ts`), at a rate weighted towards newly trusted
  accounts (50% on the first, decaying) and floored at 5% so no account
  becomes permanently unwatched. It writes `revisions.sampled_at`, never
  `status` — holding a contribution back would undo the whole promise of
  trust. The draw uses `crypto.randomInt`, not `Math.random()`, because the
  mechanism is adversarial by design: V8's PRNG state is recoverable from a
  run of outputs, so a patient bad actor observing which of their own edits
  were drawn could otherwise time the damaging ones into the gaps.
- **Taking a record off the atlas is still an ordinary revision** — one
  carrying `retracted: true`, applied through `applyRevision()` like
  everything else. No second write path was added for it.

### 2.4 Versioning & releases

Semantic versioning via [Changesets](https://github.com/changesets/changesets)
— deliberately not Conventional-Commits-driven tooling (`semantic-release`,
`standard-version`), because this repo's `commit-msg` hook protects a
freeform, lowercase, imperative commit style with no type prefix, structural
rather than convention-based. A changeset is a small file under
`.changeset/`, independent of the commit message, recording what changed and
how it should move the version.

```mermaid
flowchart LR
    A["pnpm changeset\n(contributor records a bump)"] --> B[".changeset/*.md\ncommitted alongside the change"]
    B --> C{"push to main"}
    C -->|"pending changesets exist"| D["release.yml: bump package.json,\nrewrite CHANGELOG.md, commit,\ntag vX.Y.Z, cut GitHub Release"]
    C -->|"none pending"| E["no-op"]
    F["pull_request"] --> G["changeset-check.yml:\nsoft reminder, non-blocking"]
```

**The primary path is a direct push to `main`** — this project has no
release-PR step to merge, commits land on `main` directly, so the release
workflow runs the bump/tag/release in the same push rather than opening a
"Version Packages" PR the way Changesets' own GitHub Action normally would.
A `[skip release]` marker on the bump commit stops it from re-triggering
itself. **The secondary path is a branch/PR** — a non-blocking check that a
branch touching app code carries a changeset. Deploy images additionally
carry a `v${version}` tag alongside `latest` and the commit SHA, so a
specific release can be pulled or rolled back to by name rather than only by
SHA.

---

## 3. Technology stack

```mermaid
mindmap
  root((Vestigian stack))
    Frontend
      Nuxt 4 / Vue 3
      Nuxt UI v3 (Reka UI)
      MapLibre GL JS v6
      terra-draw
      Tailwind v4 (design tokens)
      @vite-pwa/nuxt (Service Worker)
      OpenSeadragon (IIIF deep zoom)
      @fontsource (self-hosted fonts)
    Backend
      Nitro (Nuxt server engine)
      Drizzle ORM
      postgres.js (raw PostGIS)
      argon2id
      otpauth + qrcode (TOTP 2FA)
      ALTCHA (self-hosted proof-of-work captcha)
      sharp (image re-encode)
      ODC / iron-seal sessions (nuxt-auth-utils)
    Data
      PostgreSQL + PostGIS
      Valkey
      MinIO/Bunny object storage
    External data sources
      vici.org import (MySQL dump)
      AWMC (Barrington Atlas + minor antiquities, ODbL)
      Pleiades (CC BY)
      DARE raster tiles (CC BY-SA/NC mix)
      EOX Sentinel-2 (CC BY-NC-SA)
      GeoNames cities500 (CC BY)
      EDH findspots (CC BY-SA)
      EDH inscriptions corpus, EpiDoc TEI (CC BY-SA 4.0)
      Attic Inscriptions Online (CC BY-SA 3.0)
      Itiner-e Roman roads (CC BY 4.0)
      Nomisma.org mints (CC BY 3.0)
      Wikidata Roman monuments (CC0)
      I.Sicily inscriptions (CC BY 4.0; 6 records CC BY-NC 4.0; text only)
      Cliopatria neighbouring realms (CC BY 4.0)
      Atlas of Hillforts of Britain and Ireland (CC BY 4.0)
      Dated survey sites, via the Ancient Sites and Monuments Survey (ODbL 1.0; per source CC BY 4.0 / OGL)
      Natural Earth country boundaries (public domain)
      OmnesViae / Tabula Peutingeriana (no stated licence; compiler confirmed reuse)
      Wikidata battles (CC0)
      Catalogue of Ancient Ports (CC BY)
      ORBIS v2 routes (CC BY)
      CHRR coin hoards (ODbL 1.0 and CC BY-NC 3.0)
      OpenHistoricalMap empire extents (CC0)
      Wikimedia Commons Cichorius Plates, mirrored (public domain)
      Heidelberg UL IIIF, Column of Marcus Aurelius, live proxy (public domain)
    Observability
      Grafana Alloy
      Loki / Tempo / Prometheus / Alertmanager
    Security
      CrowdSec (detection)
      ALTCHA
      argon2id
      disposable-email-domains (signup/email-change guard)
    i18n
      "@nuxtjs/i18n (6 locales)"
      LibreTranslate (self-hosted MT)
    Deployment
      Docker Compose
      Dokploy
      Traefik
      GitHub Actions -> GHCR
```

### 3.1 Client-side query split

| Client                             | Used for                | Why                                                                                                                                      |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Drizzle (`useDatabase()`)**      | Default for all queries | Compile-time-checked columns and typed rows.                                                                                             |
| **Raw `postgres.js` (`useSql()`)** | PostGIS-only — 8 files  | `ST_AsMVT`, `ST_AsMVTGeom`, `ST_SetSRID`/`ST_MakePoint`/`ST_GeomFromGeoJSON`, geography casts, `ST_AsGeoJSON`, the readiness `SELECT 1`. |

The two hold **separate connections**, so a transaction can never span both
— which is exactly why `applyRevision()` (geometry write + trust counter,
one atomic unit) picks a single client for the whole operation.

---

## 4. Request flow

### 4.1 A map tile request (the hot path)

```mermaid
sequenceDiagram
    participant Browser
    participant CDN as Bunny CDN
    participant Nitro
    participant Valkey
    participant PG as PostGIS

    Browser->>CDN: GET /api/tiles/{z}/{x}/{y}.mvt
    CDN->>Nitro: (cache miss) forward
    Nitro->>Nitro: validate z/x/y
    Nitro->>Valkey: GET tile:v{dataVersion}:{z}:{x}:{y}
    alt cache hit
        Valkey-->>Nitro: cached MVT bytes
    else cache miss
        Nitro->>PG: ST_AsMVT (GiST-indexed)
        PG-->>Nitro: MVT bytes
        Nitro->>Valkey: SET (24h if empty tile, else standard TTL)
    end
    Nitro-->>Browser: application/vnd.mapbox-vector-tile
```

Design rules that keep this fast:

- **Below zoom 9:** counted clusters, snapped to a grid in _projected_
  space. **At zoom 9+:** individual sites. **Tracings from zoom 7**,
  simplified with a tolerance derived from metres-per-pixel.
- **Tiles carry only `id`, `slug`, `title`, `category`.** Descriptions and
  images are fetched on demand via `/api/sites/:id` — keeping tiles small
  and cacheable far longer than editable content would otherwise allow.
- **Cache invalidation is one counter** (`bumpDataVersion()`), so an
  approval invalidates every cached tile at once without a scan/delete.
- **Empty tiles are cached for 24h** — most of the world's surface is ocean.

### 4.2 A contribution's full lifecycle

```mermaid
flowchart LR
    A["Contributor submits\nsite/tracing draft"] --> B["zod validation\n+ stripHtml sanitization"]
    B --> C["INSERT into revisions\n(pending)"]
    C --> D{"Blanking edit?"}
    D -- yes --> E["Force queue,\nregardless of trust"]
    D -- no --> F{"Trust >= threshold?"}
    F -- yes --> G["applyRevision()\nauto-approve, write live row"]
    F -- no --> E
    E --> H["Moderator reviews\n(cannot self-approve)"]
    H -- approve --> G
    H -- reject --> I["Mail author\nwith optional note"]
    G --> J["bumpDataVersion()\ninvalidate tile cache"]
    G --> K["verifySiteConcordances()\nfire-and-forget enrichment check"]
    G --> L["Mail author:\ndecision reached"]
```

### 4.3 Login with optional two-factor

```mermaid
sequenceDiagram
    participant U as User
    participant Login as /api/auth/login
    participant Valkey
    participant Verify2FA as /api/auth/verify-2fa

    U->>Login: email + password
    Login->>Login: verifyPasswordArgon(hash ?? DUMMY_HASH, pw)
    alt wrong password
        Login-->>U: 401 (same timing either way)
    else unverified email
        Login-->>U: 403, resend confirmation (rate-limited)
    else 2FA enabled
        Login->>Valkey: mint short-lived challenge {userId}
        Login-->>U: 200 { requiresTwoFactor, challengeId } — NO session cookie yet
        U->>Verify2FA: { challengeId, code }
        Verify2FA->>Valkey: check challenge + attempt counter (max 8)
        alt correct TOTP or unused backup code
            Verify2FA->>Verify2FA: setUserSession()
            Verify2FA-->>U: 200 { user }, session cookie set
        else wrong
            Verify2FA-->>U: 401, attempt counter incremented
        end
    else no 2FA
        Login->>Login: setUserSession()
        Login-->>U: 200 { user }
    end
```

---

## 5. Feature list

### 5.1 Map & exploration

- **MapLibre-powered vector map** with clustered sites, tracings, category
  markers, and a legend that adapts to the active basemap.
- **Overlapping sites are spread out, not piled.** From zoom 9, sites whose
  markers would cover one another are drawn as a ring (up to eight) or a
  square grid, each icon shrunk until they stop overlapping, with a dot and a
  hairline back to its true coordinate; zooming in dissolves the groups. Worked
  out in the browser from the loaded tiles (`useSiteArrangement`), so the tile
  pipeline and its caches are untouched.
- **Six basemap views**, in two switcher groups:
  - _Modern:_ **Vestigian** (recolored vector basemap) and **Satellite**
    (Sentinel-2 cloudless raster).
  - _Antiquity:_ **DARE** (Åhlfeldt's raster sheet) and **Barrington**
    (self-built from AWMC + Pleiades vector data, including a "Follow the
    limes" frontier overlay).
- **Tabula Peutingeriana** — a standalone IIIF deep-zoom viewer of the
  actual manuscript (OpenSeadragon), plus a separate, off-by-default
  **network overlay** showing the roads and towns it records at their real
  coordinates (gated behind an operator flag — its source states no
  licence, so nothing is served until that's confirmed with the maintainer).
- **A dedicated overlay switcher**, separate from the basemap menu, holding
  every switchable layer over the map: contributed sites, the limes
  frontier, the Tabula Peutingeriana network, Wikidata battles, the
  Catalogue of Ancient Ports, ORBIS Roman routes, AWMC's minor antiquities
  (bridges, mines, quarries and more), and CHRR coin hoards — each off by
  default, each crediting its own source in the map's own attribution the
  moment it's switched on. A "Hide all overlays" action at the top of the
  menu switches every shown layer off at once.
- **Column reliefs** (`/columns`) — Trajan's Column, mirrored from Wikimedia
  Commons' Cichorius Plates into this project's own storage, and the Column
  of Marcus Aurelius, served live via a server-side IIIF proxy onto
  Heidelberg University Library's own digitisation (a direct browser fetch
  to that host fails outright; only a server-side request succeeds). Both
  use an OpenSeadragon deep-zoom viewer — real pan/zoom-to-pointer, not a
  scrolling image frame — with a shared, typeable page pager; the Marcus
  Aurelius viewer additionally remembers the volume and plate a reader left
  off at.
- **Full-text-lite site search** across contributed titles/summaries _and_
  235k+ modern city/town names (self-hosted GeoNames table, ranked so exact
  prefix matches beat fuzzy trigram noise).
- **Offline maps:** a bounded, explicit "download this area" flow (three
  detail tiers), backed by a Service Worker precache and a measured, sampled
  size estimate before download — never a blanket "cache everything."
- **Geolocation button**, mobile-first responsive layout.
- **Distance scale** beside the key button: MapLibre's own control (metric, rounded to a round
  distance, following zoom and latitude), mounted by hand into the key's row so it never sits under
  another control and does not move when the key opens.
- **"Turn the map with my compass"** on touch devices: heading-up while walking, from the phone's
  magnetometer (`deviceorientationabsolute`, or `webkitCompassHeading` on iOS after its permission
  prompt). Smoothed on the circle, rate-limited, north arrow while active, north back on top when
  switched off. Nothing is stored or sent. Magnetic north, not true: not corrected (a few degrees
  across Europe). Tested as arithmetic and as wiring with synthetic events — **not on a handset.**
- **A Features page** (`/features`): the things that are easy to miss, each with the list of what
  its button will switch on and a button that opens a real example on the map — switches the layers
  on, selects the record and puts the camera on its icon clear of the record sheet. First entry:
  what a frontier watchtower could see (§5.11).

### 5.2 Contribution & editing

- Site and tracing **draft editors** (Nuxt UI form controls, no hand-rolled
  inputs), a geometry draw tool (terra-draw), and an image uploader.
- **Every submission goes through the revision pipeline** described in §2.3
  — nothing bypasses moderation review when trust or blanking rules say it
  shouldn't.
- **Revision history and diffing** (`RevisionDiff.vue`) visible per record.

#### The "needs work" queue — answering "what can I do near here"

61,273 records were imported and **82% of them have no photograph**. Until
`/nearby` existed the application offered a map to browse and no way to find
the records that need somebody to stand in front of them — the one kind of
work a visitor can do that nobody at a desk can. That is this project's
cold-start problem stated precisely, and it is a product gap rather than a
technical one.

`/api/sites/needs-work` returns approved sites within a radius that are still
missing something, **nearest first** — deliberately not ordered by how
incomplete a record is. The binding constraint on a visitor is where they are
standing; a very incomplete site forty kilometres away is not more useful than
a nearly complete one at the end of the road. Completeness decides _which_
records appear and what each one asks for.

What counts as a gap is a single tested rule (`shared/utils/completeness.ts`),
weighted by both scarcity and by who can close it:

| Gap           | Sites lacking it | Weight |
| ------------- | ---------------- | ------ |
| a photograph  | 49,964 (82%)     | 0.40   |
| a description | 29,417 (48%)     | 0.30   |
| a period      | 29,905 (49%)     | 0.20   |
| a summary     | 5 (~0%)          | 0.10   |

Concordances are deliberately **not** counted: there is no field for them in
`SiteEditorForm`, so listing a record as incomplete for lacking one would ask
for something the application cannot accept. The page is public on purpose —
it is the best argument this project has for signing up, and putting it behind
an account would show it only to people already contributing.

### 5.3 Moderation

- **Review queue** with per-revision notes, batch actions, and a
  contributor table (trust level, suspension with a required reason field).
- **Suspension leaves prior approved contributions untouched** — restoring
  trust returns someone exactly where they left off.

### 5.4 Accounts & identity

- Registration with **ALTCHA proof-of-work** + honeypot + per-IP rate limit
  - email verification + a **disposable/throwaway-domain check** — a check
    against the `disposable-email-domains` package's list (loaded lazily, on first
    use, in the handler rather than the zod schema), applied
    identically to registration and to email change, so a burner address is
    refused before it can ever receive a verification link.
- **Opt-in TOTP two-factor authentication** — QR enrollment, 10 single-use
  backup codes (shown once, copy-or-download), disable requires _both_
  password and a code.
- Password reset, email change (parked on a token until the new address is
  proven reachable), account export (GDPR data portability), account
  deletion (anonymization, not hard delete).
- **Public contributor profile pages**, opt-in, a strict projection (no
  email, no role, no trust state, no location data).

### 5.5 The field notebook (this project's one feature vici.org has no analogue for)

- **"I have stood here"** — private visit records (`site_visits`), never
  joined to any public feed, never entering the tile pipeline.
- **"Places to go"** — private bookmarks (`site_bookmarks`).
- **GPX field kit export** (`/api/me/field-kit.gpx`) — a hand-written,
  fully-escaped GPX 1.1 file of a user's notebook places, usable on any
  handheld GPS or offline map app.
- **Milestones** — eight named achievements, derived on read and stored
  nowhere (no points, streaks, or leaderboards by design — a leaderboard
  would reward speed over substance).
- **"Found this useful" endorsements** — a public per-site count from a
  strictly private table (no identity of the endorser ever surfaces, on any
  surface, to anyone including moderators).

### 5.6 Enrichment & cross-referencing

See §6 for the full mechanism. In short: live Wikipedia extracts in six
languages, verified concordances against Wikidata/EDH/iDAI.gazetteer/Historic
England, and machine translation on demand — nothing is ever republished as
stored content.

### 5.7 Internationalization

Six interface languages (EN, FR, ES, DE, IT, NL) via `@nuxtjs/i18n` with a
cookie-based locale (not URL-prefixed), bootstrapped from a single English
source catalogue through a self-hosted LibreTranslate instance.

### 5.8 SEO & discoverability

- Hand-rolled, paginated **sitemap index** (sites, tracings, the three inscription
  corpora, static pages, limes sectors — about 160,500 URLs in 8 files, each under the
  50,000-URL/50 MB sitemaps.org cap; a test keeps it in step with `app/pages/`).
- `robots.txt` + page-level `noindex` (two distinct mechanisms, used
  together deliberately).
- JSON-LD structured data (`schema.org/Place`) for sites and tracings.
- Open Graph images: real photo when available, one of eleven static
  category cards otherwise.
- A **Turtle feed** at `/api/data/sites.ttl` and, for the reference layers adapted from
  ODbL sources, the **ODbL feeds** at `/api/odbl/<layer>.{geojson,ttl}` — an offer
  ODbL §4.6 requires (see `.claude/rules/open-data-feeds.md`).
- A **Linked Places Format feed** at `/api/data/sites.lp.json`, alongside the
  existing GeoJSON one. This project consumes vici.org, EDH, AWMC, OHM, CHRR
  and ORBIS and previously gave back only raw GeoJSON; LPF is what Recogito,
  Peripleo and the World Historical Gazetteer actually read, so publishing it
  puts Vestigian _inside_ the gazetteer graph rather than beside it. Built
  against the real specification (v1.3, fetched rather than recalled — that
  version made `fclasses` required, which a build from memory of the older
  shape would have silently omitted), and the `external_ids` table already
  held exactly the Pleiades/Wikidata identifiers LPF wants as `links`.
- A public, machine-readable **OpenAPI document** (dev-only — 404s in
  production), built by merging Nitro's auto-generated shape with each
  route's real zod validation schema, so documentation can never silently
  drift from what a handler actually enforces. Interactive UI at
  `http://localhost:3000/_scalar` while `pnpm dev` is running; raw document
  at `/api/openapi.json`.

### 5.9 Epigraphy — two mirrored inscription corpora

- **The Epigraphic Database Heidelberg's inscriptions tree**, mirrored
  file-for-file from its public EpiDoc TEI GitHub repo (CC BY-SA 4.0):
  **79,206 records**, of which **13,388 (17%)** carry a resolved map
  position — a Trismegistos place reference joined against the same
  `edh_findspots` table the site-enrichment concordance check already uses,
  accepted only where the join resolves to exactly one distinct coordinate
  rather than guessing among several.
- **Attic Inscriptions Online**, a second, entirely separate corpus (CC BY-SA
  3.0): **3,412** Athenian decrees and dedications, 4th–1st century BC,
  geolocated through Pleiades place URIs — the same identifier space the
  Barrington sheet's own places already live in — resolving a findspot for
  **78%** of records, far denser than EDH's 17% because this corpus is
  concentrated in Attica.
- **A third corpus, I.Sicily** (Oxford / ERC Crossreads, CC BY 4.0; six records
  CC BY-NC 4.0): 5,136 Sicilian inscriptions in Greek, Latin, Elymian, Sikel and
  Punic, 5,009 with a position, 1,218 with an English translation. Its own table,
  tile layer and detail page (`/inscriptions/sicily/:id`). **Text only** — the
  photographs are captioned "with the permission of" the Sicilian heritage
  department, a permission to the project and not a licence downstream, so the page
  links to I.Sicily instead of mirroring them.
- **Both EDH and Attic are imported reference material, not contributed data** — their own
  table, no `siteId`, outside the revision/moderation pipeline entirely, the
  same treatment already given the Barrington sheet and the other overlay
  datasets in §6.3.
- Surfaced three ways: a **"nearby inscriptions" cross-reference** on every
  site and tracing page (`ST_DWithin` against the resolved geometry), a
  standalone **browse/detail page per corpus** (`/inscriptions`,
  `/inscriptions/attic`) with facet filters and a "show on map" link, and two
  independent, off-by-default **map overlay layers** (distinct icons, so both
  can be switched on together near Athens without reading as one dataset).
- EDH's German scholarly metadata (title, commentary) is machine-translated
  on read through the same self-hosted LibreTranslate path enrichment uses;
  the carved Latin/Greek transcription itself is **never** machine-translated
  — the interface has no source-language engine for it, and a fluent-sounding
  wrong rendering of an epigraphic abbreviation would be worse than none.
- Photograph _metadata_ for the EDH corpus is mirrored for link-out credit
  (43,199 records checked, not sampled); no image bytes are mirrored, since
  every one carries a "rights reserved, free access" statement rather than an
  open licence.

### 5.10 Administration — the command station

- **`/admin`**, admin-role-only, absorbing what used to be a separate
  `/moderation/contributors` page. One station, sections switched via the
  query string (`?section=activity|accounts|images|audit|system`) rather than
  sub-routes, so any view is linkable and survives a reload.
- **The activity stream is the reason it exists.** Moderation's own review
  queue only ever showed _pending_ work; the moment a contributor crosses the
  trust threshold their edits publish immediately and, until this station,
  never appeared on any screen again. The activity stream lists every
  revision regardless of status, flags which ones auto-published unreviewed,
  and reuses the same diff/blanking-edit logic the moderation queue already
  has.
- **A ban is a new, harder power than trust revocation.** Trust revocation
  (existing, moderator-level) only re-queues someone's future edits. A ban
  (new, admin-only) refuses login, ends every live session immediately via
  `sessions_valid_from`, and refuses every write — while leaving already-
  published work untouched (§2.3). **An admin can never be banned or demoted
  by another admin**, unconditionally, closing the obvious lockout attack.
- **Taking a banned account's work offline is a separate, counted, reversible
  sweep** — an explicit dossier action, never automatic on ban — built
  entirely out of `applyRevision()`: reverting their edits to others' records,
  retracting records they created (a revision carrying `retracted: true`),
  and withdrawing their photographs, with per-item outcomes rather than an
  all-or-nothing transaction.
- **Role changes and bans demand the password again** (step-up
  re-authentication, TOTP too if enabled) — a short-lived grant keyed to the
  specific session, not just the account, so a different stolen session for
  the same admin can't ride a grant the real admin minted. This check **fails
  closed** on a cache outage, the one deliberate inversion of this project's
  usual fail-open rate-limit philosophy, because these actions are the ones
  the app cannot undo from inside itself.
- **Every admin action is written to an append-only audit log** — who did
  what, to whom, when — including every read of the accounts view, since that
  view surfaces every registered email address. Nothing is ever updated or
  deleted from it.
- **Deliberately unfindable**: `X-Robots-Tag: noindex, nofollow, noarchive`
  and `Cache-Control: no-store` on every `/admin` and `/api/admin` response,
  `Disallow: /admin` in `robots.txt`, every admin fetch client-side only so
  nothing privileged is ever baked into cacheable server-rendered HTML, and a
  non-admin visiting the route gets a **404**, not a 403 — the route's
  existence is not confirmed to someone who cannot use it (the API endpoints
  behind it still answer honest 403s, once the caller is already
  authenticated).
- Also surfaces what previously existed only in Grafana: images stuck with
  an unresolved (`UNKNOWN`) or all-rights-reserved licence, and failed mail
  deliveries — both invisible to anyone without a Loki login until now.

---

### 5.11 Line of sight from the frontier towers, and the relief along a line

Full narrative — the terrain it stands on (12 m pixels, accuracy, bare earth vs surface), the height
model and where each figure was taken from, the three amendments, results and limits — is in
[`line-of-sight-and-relief.md`](line-of-sight-and-relief.md).

A limes watchtower's record now says what its guard platform could have seen, and every line tracing
carries a profile of the ground along it. All of it is a **calculation over the elevation tiles the
map already reads**, and the interface labels it so.

- **The tower** (447 `watchtower` records within 1.5 km of a limes sector; the 5,720 Sardinian
  nuraghi filed under the same word are excluded): the view at three assumed heights — the
  _unbroken_ view and everything _seen_, which are different things for a tower on a rim (Turm
  15-25b has 0.5 km² open and sees 28 km²) — drawn as a polar diagram with its figures written on
  it, written out by compass point, and on the map as the same shapes with the same numbers. Pick a
  direction and the panel explains it from the numbers of the ground: the crest that ends the open
  view, the long shadow behind it ("dead ground") and where ground comes back.
- **Both ways.** A toggle turns the view round: from where could this tower be seen? (Sight is
  symmetric; the tower's whole height is the thing looked at.)
- **Neighbours.** Whether each of the six nearest towers is in sight, at all three heights, with
  the ground between them as a section.
- **The sector** (a script, `pnpm sightlines:build`): the towers of a frontier sector taken
  together — could a signal pass from tower to tower (83 % of the Raetian Limes's recorded chain, 93 %
  of the Upper German), where it breaks, what share of the line and how much country is overlooked by
  one tower and by three, and the stretches no tower watches — with the chain, the ground and the
  gaps drawn on the map. About the towers _recorded_: where none is, the line is unrecorded, not
  unwatched.
- **The height is an estimate and says so.** No tower survives to its original height; the figure
  (about 10 m overall, guard platform 6–8.5 m, eyes 1.6 m above it) is a convergence of heritage-site
  handbooks, the Idstein-Dasbach replica and the Gask Ridge analysis, with its sources in
  `.claude/rules/sightlines.md`. A measurement it is not.
- **"No trees" is mostly a fact about the data, not an assumption.** Mapterhorn's tiles are national
  lidar bare-earth models in Germany, Austria, Slovakia, Britain, the Netherlands and Romania, and a
  surface model (Copernicus GLO-30) where none is open — the Hungarian, Serbian and Bulgarian Danube.
  The panel prints a caution for the latter.
- **The profile** gives elevation against distance, climb and fall (ignoring wobbles under 3 m), the
  average slope and the steepest stretch, with a cursor that is also a dot on the map. For an
  aqueduct the net fall is the meaningful figure; the terrain it crosses is not its channel.
- **Geometry**: curvature and ordinary refraction are allowed for; the target is a standing person.
  It is geometry, not eyesight — haze and the limit of the eye cut a real view short.

## 6. Cross-information, verification & enrichment

Vestigian treats every borrowed identifier as **a lead, not a guarantee** —
this is one of its more carefully engineered subsystems.

### 6.1 The core problem, measured

Sampling 30 sites that already carried a Wikidata id from the vici.org
import: coordinate agreement had a **median of 53 m**, but a **p90 of
1,050 m**, and a worst case of **35.8 km** — a Q-id that pointed at a modern
municipality rather than the actual ruin. Roughly a tenth of "verified"
identifiers were simply wrong.

### 6.2 The verification gate

```mermaid
flowchart TD
    A["Candidate match\n(Wikidata / EDH / iDAI.gazetteer /\nHistoric England / Pleiades)"] --> B{"Has a coordinate?"}
    B -- no --> R1["Rejected:\nno-coordinate"]
    B -- yes --> C{"Within 250 m\nof our site?"}
    C -- no --> R2["Rejected:\ntoo-far"]
    C -- yes --> D{"Place type compatible\nwith our category?"}
    D -- incompatible --> R3["Rejected:\nwrong-kind-of-place"]
    D -- compatible / unknown --> E["Accepted\nstored in external_id_verifications"]
```

- **250 m** was chosen empirically: 19 of 29 comparable samples fell inside
  it; 100 m started rejecting genuine matches on anything large enough that
  two projects picked different reference points (a fort complex, an
  aqueduct); 1 km started admitting the neighbouring village.
- **Place-type compatibility** is what a distance check alone cannot catch —
  the classic failure is a concordance whose _centre point_ happens to fall
  inside 250 m of the site but which actually describes the modern town that
  grew over it. An `other` category never contradicts anything, since it
  carries no positive claim to begin with.
- Every accepted match is persisted per **identifier × source**, so the same
  Wikidata id can be independently verified against Wikidata _and_ against
  iDAI.gazetteer, and shown to readers as a small verdigris "confirmed" mark
  — this project's own visual token for approved/verified state — never a
  negative marker on something nobody has checked yet.

### 6.3 Sources cross-referenced

| Source                                   | What it adds                                                                      | How it's reached                                 | Coverage note                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Wikidata / Wikipedia**                 | Free-text extracts, six languages                                                 | Server-side proxy, cached in Valkey              | English alone answers 77% of Q-id'd sites; the six-language set reaches 87%.                         |
| **EDH** (Epigraphic Database Heidelberg) | Inscription findspots                                                             | Bulk import (no live search API)                 | 29,861 rows, CC BY-SA 4.0.                                                                           |
| **iDAI.gazetteer**                       | Title-searched matches                                                            | Live API, per-site on write                      | Useful for brand-new contributions, unlike EDH.                                                      |
| **Historic England**                     | Position-searched matches (GB only)                                               | Live API, per-site on write                      | GB-scoped.                                                                                           |
| **AWMC / Pleiades** (Barrington Atlas)   | The whole antiquity basemap: coastline, roads, urban extents, 38,002 named places | Bulk import, own tables, never joined to `sites` | ODbL / CC BY — kept separate specifically to avoid pulling contributed data under share-alike terms. |

### 6.4 Automatic vs. manual verification

```mermaid
flowchart LR
    subgraph Automatic["On every publish (applyRevision)"]
        A1["verifySiteConcordances(siteId)\nfire-and-forget, never awaited"]
    end
    subgraph Manual["Operator-run backfill"]
        M1["scripts/verify-concordances.ts\nre-checks the full 61k+ catalog"]
    end
    A1 -->|"checks EDH, iDAI.gazetteer,\nHistoric England"| DB[(external_id_verifications)]
    M1 -->|"same three checks,\n batch scale"| DB
```

The live-write path is intentionally fire-and-forget: an external API
timing out must never delay or fail a contribution's own approval — the same
fail-open philosophy applied throughout this project (rate limiting, mail
delivery).

### 6.5 Translation, not silent substitution

Enrichment text is **never** presented as something it isn't: a
machine-translated paragraph is explicitly labelled "Machine-translated from
Dutch," the original-language version says "In Dutch," and every paragraph
carries a proper `lang` attribute. Nothing is stored — the extract is CC
BY-SA third-party content, so persisting a copy would make the app a
republisher rather than a linker; Valkey caches a hit for 7 days and a miss
for 1 day instead.

### 6.6 The import pipeline is a supply chain, and is now guarded

Twenty-four scripts fetch someone else's data and write it straight into the
tables the map reads. None of them compared what arrived against what arrived
last time, so an upstream that changed shape, lost half its rows, or was
replaced outright would import silently and look exactly like a successful
run. The failure is not loud: it is a map that is quietly wrong, discovered
whenever somebody happens to notice.

`scripts/import/guard.ts` is a tripwire between a source and the atlas. Each
run records its row count and a checksum of the fetched bytes in an
append-only `import_runs` table, and refuses an implausible delta against the
previous run — a sharp shrink (upstream truncated or restructured) or an
implausible growth. The quiet case it also catches is a **checksum change with
an unchanged row count**, which is what a silently rewritten upstream looks
like. A `--dry-run` flag fetches, parses and reports the delta without
writing.

Wired into the three highest-volume importers first (vici's own conversion,
`09-cities.ts`, `12-edh-inscriptions.ts`) rather than all twenty-four at once:
the guard is worth nothing until it has been proven against a real import, and
retrofitting every script in one pass would be a large mechanical change
landing on top of unverified behaviour. The decision logic is pure and unit
tested; only the bookkeeping touches a database.

---

---

## 7. Accessibility (a11y)

Automated accessibility checks now run at two levels of the pipeline:

```mermaid
flowchart LR
    A["Template lint\n(build-time)"] --> C["pnpm check"]
    B["e2e axe scan\n(Playwright + axe-core,\nproduction build)"] --> D["pnpm test:e2e"]
    C --> E["pre-push hook"]
    D --> F["Manual / CI"]
```

Baseline commitments (per `CLAUDE.md`'s "always" section, applied
throughout the component set):

- **Semantic HTML** — the most fitting tag is always used, never a generic
  `<div>` standing in for a button or a landmark.
- **ARIA everywhere it's needed**, and improved wherever automated scanning
  finds a gap — a template-lint step now catches obvious issues (missing
  labels, invalid roles) before code ever reaches a human reviewer, and an
  end-to-end **axe-core scan against the real production build** catches
  what static linting structurally cannot (contrast against actual rendered
  colors, focus order, live-region behaviour).
- **Every form field carries an explicit `id`**, deliberately, even where
  Vue's auto-generated ids would technically work — documented as a fix for
  an SSR/CSR hydration mismatch that silently broke label association.
- **Keyboard-first interaction and keyboard-aware i18n** — the language
  switcher and theme toggle are both reachable and operable via keyboard,
  and interactive controls avoid keyboard traps.
- **Nuxt UI v3 (built on Reka UI)** is used for every interactive control
  (forms, selects, checkboxes, toasts) rather than hand-rolled equivalents —
  Reka UI ships its own accessibility behaviour (focus trapping, ARIA
  wiring) that a bespoke control would have to reimplement and re-test from
  scratch.
- **Mobile-first responsive design** at documented breakpoints (phone
  <768px, tablet <1000px, desktop above), so touch targets and layout are
  never an afterthought on the smallest viewport.
- **Honeypot fields are positioned off-screen, never `display:none`** — a
  `display:none` honeypot is invisible to assistive technology in a way that
  can trip some screen-reader heuristics and is also trivially detectable by
  bots; off-screen positioning keeps it out of the visual and interaction
  flow without hiding it from the accessibility tree in a way that would
  cause confusion.
- **Dark mode is a genuine second palette**, not an inverted filter — warm
  charcoal, never blue-grey — which matters for readers who rely on a
  specific contrast/color profile rather than raw luminance inversion.

---

## 8. Security

### 8.1 Authentication & credential handling

| Control                   | Detail                                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing          | **argon2id** at OWASP-recommended parameters.                                                                                                                                                                                                                                                       |
| Timing-safe login         | Always hashes, even for a non-existent user, against a `DUMMY_HASH` — prevents user enumeration via response timing.                                                                                                                                                                                |
| Password reset            | Identical response whether or not the address exists; a token's **SHA-256 hash** only is stored, compared with `timingSafeEqual`.                                                                                                                                                                   |
| Registration              | Trades the enumeration guarantee for usability: a duplicate email/display name returns 409 (documented, deliberate trade-off — throttled by rate limiting to bound the leak).                                                                                                                       |
| Unverified login          | Re-sends the confirmation link, throttled to at most once per 15 minutes, placed **below** the credential check since there is nothing left to enumerate once the password is already confirmed correct.                                                                                            |
| Credential changes        | Both password _and_ email change require re-entering the **current password** — a session proves a past login, not present possession.                                                                                                                                                              |
| Two-factor authentication | Opt-in **TOTP (RFC 6238)** — no third-party provider at all; a shared secret and the current time, checked entirely server-side and in the user's own authenticator app. Ten single-use backup codes, hashed the same way as email tokens. Disabling 2FA requires both password _and_ a valid code. |
| Session cookie            | Sealed (iron-seal) and now correctly **expires** — an earlier unset `maxAge` meant a captured session was valid forever; there is no server-side revocation since sessions are stateless, so expiry is the only mitigation.                                                                         |

### 8.2 Signup / bot resistance

```mermaid
flowchart LR
    A["Registration attempt"] --> B["Self-hosted ALTCHA\nproof-of-work"]
    B --> C["Off-screen honeypot field"]
    C --> D["Per-IP rate limit"]
    D --> DD["Disposable-domain check\n(zod .refine, same rule\nreused on email change)"]
    DD --> E["Account created at trust 0"]
    E --> F["Email verification required\nbefore login succeeds"]
    F --> G["Even a bot that clears\nevery gate earns nothing\nbut a queued revision"]
```

The disposable-domain check runs entirely against a static npm package's
domain list (`disposable-email-domains`) — no external lookup, no added
latency, and no false sense of security against a determined attacker
registering their own throwaway domain, which is exactly why it sits
alongside the other gates rather than replacing any of them.

ALTCHA replaced Turnstile specifically to remove the app's last third-party
runtime dependency — a deliberate trade: it _prices_ automated signup rather
than _detecting_ it, which is weaker against a well-funded attacker, but
acceptable because a fresh account starts at trust level 0 and every
contribution it makes still goes through the moderation pipeline in §2.3.

### 8.3 Upload safety

- The declared content type is treated as a hint only; **real format is
  read from magic bytes**.
- Every image is **re-encoded through sharp**, which strips EXIF and
  guarantees the stored object is a plain JPEG — no client-crafted file
  metadata or embedded payload survives.
- **`sharp` is given an explicit `limitInputPixels`** — its default ~268 MP
  ceiling meant a small, compressible PNG under the body-size limit could
  decode to roughly a gigabyte of resident memory, especially once
  `.rotate()` forces a full decode.
- Storage keys are derived from database ids, **never** from the uploaded
  filename.
- Images with an unresolved (`UNKNOWN`) or all-rights-reserved licence are
  never published.

### 8.4 Network-facing hardening

| Control                              | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted-proxy IP resolution          | Forwarded headers are believed only behind `NUXT_BEHIND_TRUSTED_PROXY`; `x-forwarded-for` is **deliberately never read** (Bunny puts the CDN's own address first), `x-real-ip` is used instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rate limiting                        | Fails **open** on a cache outage (never locks everyone out) — but the outage itself is now surfaced via `rate_limit_decisions_total{outcome="failed_open"}` and an alert, and `/api/ready` factors in the same cache check so the instance drops out of the load balancer rather than reporting healthy while silently unprotected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CSP                                  | Allows only the specific map-asset origins listed in `nuxt.config.ts`; the Scalar API-doc bundle's `cdn.jsdelivr.net` allowance is gated to development only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Strict-Transport-Security`          | Configured in `nuxt-security`'s `security.headers`, but verified **never actually sent** on any route — `nuxt-security@2.6.0` rebuilds its own injected `/**` Nitro route rule from a fixed allowlist of header names and silently drops any other key placed there, and this header just isn't on that allowlist for a route with no _other_ matching rule (i.e. every route in this app). Confirmed against a running production build with a raw socket request, not inferred from the module's docs. Now disabled in `security.headers` (set `false`, documented, so nothing implies it still works there) and delivered instead as a plain `routeRules['/**']` header — the same mechanism that already reliably delivers `cache-control` and `x-robots-tag` elsewhere in the same file.                                                                                                                         |
| Response `cache-control` default     | Every route used to get **no `cache-control` at all** unless someone had already reasoned about that specific one — `/api/me`, `auth/export.get.ts` (a full GDPR export), `/api/moderation/**` and every page all shipped with nothing, leaving Bunny's own default edge TTL to decide whether a session-bearing response gets cached and handed to the next visitor. `server/middleware/security-defaults.ts` now defaults every response to `private, no-store` unless a route has already set its own. Pages get this too, for a second, sharper reason: each SSR render stamps a fresh CSP nonce into both the response header and the inline `<script nonce="...">` tags in the body, so a cache serving one response's body against a different response's headers would reproduce — via cache poisoning rather than a missing CSP allowlist entry — the exact blank-page bug already on record in `CLAUDE.md`. |
| `Cross-Origin-Resource-Policy`       | Same delivery gap as HSTS above, same root cause: `nuxt-security` only ever applies CORP (and CSP, `Permissions-Policy`, COOP, COEP) to the rendered HTML document, never to `server/api/**`. Added via the same middleware — CORP is arguably more valuable on exactly those JSON/tile responses than on the HTML shell, since it exists specifically against a cross-origin subresource read (the Spectre-class threat model).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bunny cache-control trust boundary   | None of the above protects anything if the Bunny pull zone in front of the app has "override cache control" enabled — a dashboard setting, not something this repo controls, that would cache every 200 for the zone's own TTL regardless of what the origin sends. Recorded as a required operational check in `.claude/rules/deployment-and-releases.md` and the deployment runbook, since it cannot be verified from code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Metrics endpoint                     | `/api/metrics` answers **404 to any request that carries a proxy header** (`x-forwarded-*`, `x-origin-key`) — in-network scrapes carry none — so it no longer rests on the Traefik `deny-external` middleware, which the deployment cannot confirm is loaded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Upstream proxy path                  | The Heidelberg IIIF proxy accepts only IIIF-shaped path segments (no dot-segments, decoded twice; no query, `@`, backslash or slash inside a segment). The prefix pinned the host; it did not pin the path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Detection vs. enforcement            | CrowdSec reads the app's own structured audit logs and writes decisions; **nothing is enforced yet** — a decision requires a bouncer, deliberately placed at the CDN edge rather than this box, since a VPS provider's DDoS protection works at L3/L4 and does not absorb L7 HTTP floods.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Alternatives considered and rejected | Fingerprinting (GDPR/ePrivacy exposure, redundant with ALTCHA + trust 0), fail2ban (bans CDN edge IPs, not real clients), SafeLine, Coraza, KrakenD, Wazuh, Zeek/Snort/Suricata — each with a documented, specific reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 8.5 Input handling philosophy

Vestigian runs with `nuxt-security`'s generic `xssValidator` **turned off**
— a considered decision, not an oversight. That validator HTML-escapes
anything it can't parse as a recognised tag and then rejects the whole
request the moment filtering changes a byte, which meant an entirely
innocent site description like _"the wall is <2m tall"_ was refused
identically to an actual `<script>` payload. The design instead relies on
two narrower, verifiable guarantees:

1. **No `v-html` exists anywhere in the codebase** (confirmed by grep), so
   every value a Vue template renders is escaped by `{{ }}` regardless.
2. **Free-text input is stripped of markup on the way in, not merely
   escaped on the way out** — `stripHtml` runs inside the zod validation
   pipeline for every site/tracing description, so the stored payload (and
   everything derived from it, including revision history) is plain text
   even if a future surface renders it outside Vue entirely (an RSS export,
   the public GeoJSON feed, etc.).

The two non-Vue-rendered surfaces that exist today — HTML email and the GPX
export — encode explicitly for their own context (`escapeHtml`,
`escapeXml`) and are unit-tested specifically for that encoding.

### 8.6 Local static analysis (this session's own work)

The project has no hosted SonarQube instance; **`eslint-plugin-sonarjs`**
was added as a local, offline equivalent covering SonarQube's own bug- and
code-smell rule categories (nested-conditional/ternary/template-literal
complexity, ReDoS-shaped regex, hardcoded-secret heuristics, non-crypto
randomness, fixed test waits, assertion-free tests). A full pass through the
initial 40 findings produced one genuine bug fix (dead-branch logic in
licence normalization), several readability improvements, and a handful of
narrowly scoped, documented suppressions for verified false positives —
never a blanket rule disable.

Since then the local-only scanning story has widened considerably, all of it
offline and none of it spending hosted CI minutes (a deliberate constraint —
see §2.4):

| Layer              | Tool                                    | Blocking?                                             |
| ------------------ | --------------------------------------- | ----------------------------------------------------- |
| Lint-level SAST    | `eslint-plugin-security`                | yes, in `pnpm lint`                                   |
| SAST               | **opengrep** (pinned binary)            | yes, in `pnpm check`                                  |
| Secrets            | gitleaks                                | yes — staged at pre-commit, full tree in `pnpm check` |
| Dockerfile         | hadolint                                | yes, in `pnpm check`                                  |
| Dependencies (SCA) | osv-scanner                             | no — `pnpm scan:deps`                                 |
| Container image    | Trivy                                   | no — `pnpm scan:image`                                |
| DAST               | OWASP ZAP baseline                      | no — `pnpm scan:dast`                                 |
| Quality + SAST     | SonarQube Community, local server + CLI | no — `pnpm scan:sonar`                                |

opengrep rather than Semgrep because it is a full open-source fork made before
parts of the rule registry moved behind a login. Its vendored ruleset is an
**allowlist** of the frameworks this stack actually uses, not a denylist: the
first unfiltered run produced 1,196 findings on real source, almost all of it
React/Express/jQuery rules matching Vue, Nitro and cheerio by coincidence.
Allowlisting means a future upstream registry addition cannot silently
reintroduce that noise. Three custom rules encode this project's own
governance invariants as an enforced diff check rather than prose — no second
write path to `sites`/`tracings`, no authorization decision outside
`shared/utils/authorization.ts`, no `requireUserSession` where
`requireActiveUser` belongs.

**Dependency posture.** `pnpm scan:deps` first reported 41 known
vulnerabilities across 17 packages; it now reports 22 across 6, and each
remaining one is there for a stated reason. `sharp` and `drizzle-orm` were
bumped and verified against their real behaviour rather than their unit tests
— the sharp upgrade specifically re-checked that EXIF is still stripped and
that `limitInputPixels` still _throws_ rather than warning, since that is the
decompression-bomb guard §8.3 depends on. `happy-dom` was **removed** rather
than bumped, because nothing imported it. `maplibre-gl` has since gone to 6.9.0,
closing the CVSS 10.0 sanitizer-bypass XSS — see
`.claude/rules/map-and-tiles.md` for why this application sat at the narrow end
of it and what the ESM-only migration actually required. What remains is four
devDependencies reachable only from import scripts a human runs by hand, most
with no fixed version in existence.

**A form vulnerability fixed without the major upgrade it shipped in.**
`@nuxt/ui`'s advisory (GHSA-gj2h-2fpw-fhv9) is fixed in 4.8.1 — a major
version of the whole design system. The flaw itself is one attribute: `UForm`
renders a bare `<form>` whose only submit handling is `@submit.prevent`, so a
submission landing **before Vue hydrates** (slow network, a bundle blocked by
CSP, autofill firing Enter early) falls through to the browser default, which
is GET — serialising every field into the query string. For this app that
means a password in the address bar, in browser history, in the `Referer` of
the next request, and in every access log in between. The upstream fix is
`method="post"`, applied by hand to every form in the application, including
the hand-written ones with the identical shape: the 2FA challenge, the admin
step-up prompt, and the password/email-change forms in `/settings`.

**Vulnerability disclosure.** `public/.well-known/security.txt` (RFC 9116).
Its values are placeholders matching the ones the legal notice already
carries, and must be filled in before the site is public — a security.txt
advertising an address nobody reads is worse than none, because it stops a
finder looking for another way through.

**gitleaks caught its own new script, twice.** `scripts/security/scan-sonar.sh`
tripped the default `curl-auth-user` rule on `-u admin:admin` (SonarQube
Community's own well-known bootstrap credential, used exactly once to
authenticate the request that rotates it away) and on `-u "${TOKEN}:"` (a
shell variable, not a literal — the rule matches shape, not content). Both
allowlisted by path in `.gitleaks.toml` with the reasoning inline, same
mechanism already used for `.env.example`. Separately, the pre-commit hook's
`gitleaks protect --staged` call printed only a leak _count_ on a real hit,
not which file or line — fixed by adding `-v`, which still keeps `--redact`
in place so the matched secret text itself never reaches the terminal.

### 8.7 Administrative governance (`/admin`)

The admin station (§5.10) is the one place in the app where a single role
can read every registered email address and end another account's access
entirely, so its security model is layered rather than resting on the role
check alone:

| Control                        | Detail                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concealment                    | Non-admins get a **404** at `/admin`, not a 403 — existence is not confirmed to someone who cannot use it. `noindex`/`no-store` headers and a `robots.txt` disallow keep it out of crawlers and CDN caches.                                                                        |
| Step-up re-authentication      | Role changes and bans require the password again (plus TOTP if enabled), minting a 15-minute grant keyed to `{userId}:{loggedInAt}` — the session's own timestamp, not just the account id, so a second stolen session for the same admin cannot spend a grant it never earned.    |
| Fails closed                   | A Valkey outage refuses a step-up-gated action outright — the one deliberate exception to this project's usual fail-open posture (rate limiting, mail delivery), because a ban or role change is the one class of action the app cannot undo from inside itself if abused.         |
| Unconditional admin protection | Neither `checkBan` nor `checkRoleChange` can ever be satisfied against a target who is already an admin, full stop — not "while more than one admin exists." Removing a rogue admin requires direct database access, the same deliberately slower path that creates the first one. |
| Audit trail                    | Every admin write, and every read of the accounts view (it surfaces emails), lands in an append-only `admin_audit_log` row — actor, action, subject, a detail blob, never a password, a TOTP secret, or an IP address.                                                             |
| Session revocation             | Banning, unbanning, and an explicit "end this session" action are the only three things that bump `users.sessions_valid_from` — the sole session-revocation mechanism this stateless-cookie app has.                                                                               |

---

## 9. GDPR & legal

_Not legal advice — the operator's real identity still needs to go into the
impressum/privacy pages, and counsel should review both before real users
see them. What follows is the technical posture, verified against the
running code._

### 9.1 Data map

```mermaid
flowchart TD
    subgraph Personal["Personal data collected"]
        Email["Email address"]
        DisplayName["Display name"]
        PWHash["Password hash (argon2id)"]
        TOTP["Encrypted TOTP secret (opt-in)"]
        IP["Request IP (30-day log retention)"]
        Visits["Private: site_visits, site_bookmarks"]
    end
    subgraph Rights["User-exercisable rights"]
        Export["/api/auth/export.get.ts\n→ full JSON export"]
        Delete["/api/auth/account.delete.ts\n→ anonymization"]
    end
    Personal --> Export
    Personal --> Delete
    Delete -->|"email → deleted-{id}@vestigian.invalid\nname → 'Deleted account #{id}'\nhash → DUMMY_HASH"| Anonymized["users row anonymized,\nnot removed"]
    Delete -->|"ON DELETE CASCADE"| VisitsGone["site_visits / site_bookmarks\nhard-deleted (private data\nhas no archival justification)"]
    Anonymized -->|"contribution content kept"| Archive["Art. 17(3)(d): archival\nexemption for cultural-heritage\npublic-interest content"]
```

- **Right to erasure** anonymizes rather than hard-deletes a `users` row —
  `revisions.author_id`, `sites.created_by`, `tracings.created_by`, and
  `site_images.created_by` all cascade to `NULL` on hard delete, but
  anonymizing instead keeps every other contributor's history equally
  legible (no generic "unknown author" collision) while removing everything
  that identifies the erased person. The **content** of past contributions
  is retained under the Art. 17(3)(d) archival-material-of-public-interest
  exemption — a reasonable position for a cultural-heritage atlas, flagged
  explicitly as needing legal confirmation rather than treated as settled.
  The **private notebook** (`site_visits`, `site_bookmarks`) gets no such
  exemption and is hard-deleted in the same transaction — nobody else can
  read it, and keeping it serves no archival purpose.
- **Right to access/portability** is a plain authenticated export of the
  caller's own data — account fields, and every site/tracing/image/revision
  they authored. There is no admin variant.
- **A password reset notifies the real account owner** that it happened —
  the reset link itself goes to whatever inbox is on file, which may
  already be an attacker's; the follow-up notice is the one point where the
  genuine owner learns something happened at all.
- **The admin station is the one surface where email addresses are shown and
  searched by someone other than their owner** — a deliberate, narrowly
  scoped exception (role: admin only), and every such read is itself written
  to the audit log in §8.7, so the exception is accountable rather than
  silent. The admin audit log holds no IP addresses and no credentials, the
  same restriction already applied to the request log's own retention.

### 9.2 Cookies — no consent banner, and why

Exactly three cookies exist: a 7-day session cookie, a colour-mode cookie,
and a locale cookie — all three strictly necessary for functionality the
visitor directly requested. There is **no analytics, tracking pixel, or
advertising cookie anywhere in the app** (confirmed by code search, not
assumed). Under §25(2) TDDDG (Germany's ePrivacy transposition), consent is
required for storing/reading something on a device **beyond what a
requested feature needs** — which is not the case here, so a banner would be
consent theatre. This exemption is explicitly conditional: the moment
analytics or an advertising cookie is added, that addition is what needs a
banner.

### 9.3 Third-party / cross-border data flows

| Recipient                                                    | What reaches them                                                                                                                                                                                      | Basis / mitigation                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Wikidata / Wikipedia / Pleiades**                          | Nothing from the visitor — the server proxies every enrichment call, so only the app server's own IP is exposed.                                                                                       |
| **Heidelberg University Library**                            | Nothing from the visitor — viewing the Column of Marcus Aurelius's plates is served by a server-side IIIF proxy, for the same reason: a direct browser request to that host fails outright regardless. |
| **CrowdSec central blocklist**                               | IP addresses already flagged as abusive, shared with the community blocklist (`DISABLE_ONLINE_API: false`)                                                                                             | Legitimate interest (abuse prevention); documented in the privacy policy's recipients section.                       |
| **Mapterhorn basemap tiles**                                 | Visitor IP, fetched **directly by the browser**, the same as any embedded map tile host                                                                                                                | Hosting jurisdiction **not yet confirmed** — flagged as needing verification before the privacy policy is finalized. |
| **DARE (Gothenburg), EOX (Vienna), OmnesViae (Netherlands)** | Visitor IP, for basemap/manuscript tile requests, until a self-hosted mirror is built and pointed at                                                                                                   | Courtesy-contact relationships established with each maintainer before any at-scale traffic; EU-hosted throughout.   |
| **Brevo**                                                    | Recipient email + display name, for transactional mail only                                                                                                                                            | EU-hosted (Paris), operator's choice, replacing Lettermint — same EU-hosting rationale.                              |

### 9.4 Licensing discipline as a legal control, not just an attribution nicety

The project treats data licence terms as a hard architectural boundary, not
a footnote:

- **ODbL (AWMC) and CC BY (Pleiades) data lives in entirely separate
  tables**, never joined to the CC BY-SA/CC0 contributed `sites` table —
  ODbL's share-alike clause attaches to a derivative _database_, and folding
  these rows together would risk pulling the contributed-data feed under
  ODbL's terms.
- **A dataset with no stated licence (the Tabula Peutingeriana network)
  lives in its own tables, never joined to the contributed data.** It is
  served because its compiler confirmed reuse, credited on the map and on
  `/licence`, and a single switch (`TABULA_PEUTINGERIANA_ENABLED`) withdraws
  it.
- **Every later overlay (battles, ports, routes, minor antiquities, coin
  hoards) got the same own-table, own-attribution treatment from the start**
  — and for four of them (ports CC BY, routes CC BY, minor antiquities
  ODbL, coin hoards ODbL and CC BY-NC) crediting the source on the map is the
  licence condition itself, not a courtesy. This was missed on first build
  — none of the seven newer overlay sources set a MapLibre `attribution` at
  all — and surfaced only once the vici-sourced site overlay went off by
  default, since that source had been carrying the map's one visible credit
  line for everything else.
- **Image licences are tracked per record** (`licence`, `attribution`
  columns are non-null), because unlike the text/metadata (CC BY-SA/CC0
  uniformly), image rights vary photograph by photograph.

### 9.5 Log retention

IP addresses are logged and retained for **30 days** in Loki, on a
legitimate-interest basis (abuse investigation) — the same field that is
_not_ redacted by the logger's `REDACTED_FIELDS` list, which does scrub
passwords, emails, and tokens. Rate-limit keys in Valkey embed a plaintext
IP for at most one hour (the longest configured rate-limit window).

---

## 10. Observability

Six containers, one agent doing three jobs:

```mermaid
flowchart LR
    App["Nitro app\n(manual spans + structured logs)"] --> Alloy["Grafana Alloy"]
    Docker["Container stdout\n(json-file driver)"] --> Alloy
    Postgres -.exporter.-> Alloy
    Valkey -.exporter.-> Alloy
    Alloy --> Loki[("Loki — 30d logs")]
    Alloy --> Tempo[("Tempo — 7d traces")]
    Alloy --> Prometheus[("Prometheus — 15d metrics")]
    Prometheus --> Alertmanager
    Loki & Tempo & Prometheus --> Grafana["Grafana\n(loopback-bound, SSH tunnel only)"]
```

- **Everything lives on local disk** — no object-storage cost, since
  telemetry here is diagnostic rather than a record of record; under 20 GB
  total against a 240 GB disk.
- **Tracing is manual, deliberately** — no auto-instrumentation, because
  Nitro ships only its compiled `.output` with no `node_modules` for a
  loader hook to resolve against, and `postgres.js` has no OTel package
  regardless. Spans exist exactly where `withSpan()` is called.
- The whole point of this stack, stated directly in the project's own
  notes: the application **fails open in eight distinct places**, and every
  one of them used to be silent. The rate limiter failing open on a Valkey
  outage is the sharpest example — it used to remove every policy,
  including the signup throttle that is the app's actual defence against
  account farming, with nothing recording that it had happened.
- **Grafana itself has no public router** and binds to loopback only —
  reached exclusively via an SSH tunnel, since its own dashboards surface
  visitor IPs and the moderation trail.

### 10.1 Backups, and knowing when they stop

One VPS is one failure domain. The nightly `pg_dump` used to write to a volume
on the same machine it was backing up, which meant losing the box lost the
dumps along with the database they were dumps of. Each dump is now also pushed
to a **restic** repository on **netcup Storage Space** — an external storage
cluster mounted over NFS, not the VPS's own disk — content-addressed,
deduplicated, and encrypted client-side so the copy on someone else's disk is
not a second place the atlas is readable in the clear.

Two details are deliberate rather than incidental: `RESTIC_PASSWORD` **is** the
backup (restic has no recovery path, so losing it makes every off-box snapshot
permanently unreadable); and a missing NFS mount must never read as a backup —
`backup.sh` refuses unless a marker file on the Storage Space is present. The
trade-off against an SFTP key restricted to one path is stated in
`.claude/rules/deployment-and-releases.md`: the mount is writable by anything on
the VPS, so it protects against losing the machine, not against a compromised one.

**Testing the restore, not just the dump.** `docker/restore-drill.sh` restores
a real snapshot into a throwaway PostGIS container, asserts the tables that
cannot be regenerated actually carry rows, and checks that geometry reads back
— a restore that lost PostGIS leaves the column present and every value
unreadable, which a row count alone would not catch. Verified once against a
real 58 MB dump: 61,273 sites, 11,720 tracings, 39,213 images, all geometries
readable.

Running it surfaced a trap worth recording. The postgres image's entrypoint
starts a _temporary_ server during initialisation with `listen_addresses`
empty, so a plain `pg_isready` passes against that one, the restore begins, and
initdb then shuts the server down underneath it — surfacing as
`PQputCopyData: server closed the connection unexpectedly` partway through a
COPY, which reads exactly like a corrupt dump and is not one. The drill waits
on TCP instead, which the init server is not listening on.

**The failure this guards against is not a backup that errors — it is one that
quietly stopped months ago.** `backup.sh` prints one `backup.outcome=` line per
stage per run, and since Alloy already ships every container's stdout to Loki,
four alerts sit on those lines: nothing dumped in 26 hours, any stage failing,
dumps succeeding but **not leaving the machine**, and no integrity check
passing in nine days — plus three on retention (below). That needed a Loki **ruler**, which this deployment did
not have — `alerts.yml` is Prometheus-only, and the backup container has no
scrape endpoint and no reason to grow one.

**Retention is bounded, and checked.** The local dumps are pruned by age
(about 15 files, under 1 GB at today's ~60 MB each) and the restic repository
by `forget --keep-daily 14 --keep-weekly 8 --prune` (at most 22 snapshots, on
the Storage Space, not the VPS disk). A plateau is a claim, so each run now logs
what is actually held and three rules fire when it is not there: more than 17
local dumps, more than 4 GiB of them, or more than 26 snapshots. They were
loaded into a real Loki and evaluated in three states; the numbers on the
production volume have not been read.

---

## 11. Other notable engineering decisions

A few things worth knowing that don't fit neatly under the headings above,
but materially shape how trustworthy and maintainable this project is:

- **The vici.org MySQL schema was originally _inferred_, then verified
  against a real dump — and the guess was wrong in every particular.**
  There is no `places` table, no `lines` table; the real shape (`points`,
  `psummaries`/`ptexts`, `pmetadata`, `pkinds`, `plines`/`pline_data`) was
  discovered by actually reading the dump, and four specific import traps
  were found this way (swapped lat/lng in `pline_data`, `line_kind`
  meaning something entirely different from "category," each tracing
  stored six times pre-generalized, and free-text concordance identifiers
  needing an allowlist parser rather than a naive split). This is a running
  theme in the project's own documentation: **guesses are explicitly
  flagged as guesses**, and every one that has since been checked against
  real data or a real browser run is recorded as either confirmed or
  corrected, never silently assumed correct.
- **Migrations are hand-written**, not generated, because `drizzle-kit`
  cannot emit PostGIS geometry columns, GiST indexes, or the expression
  indexes behind search — a documented trap for anyone tempted to
  regenerate from the schema files.
- **A one-counter cache invalidation strategy** (`bumpDataVersion()` /
  atlas's own separate generation counter) rather than per-record cache
  keys — deliberate, because approvals are rare and tile reads are not, so
  the cost of invalidating everything at once is far lower than the
  complexity of tracking per-tile dependencies.
- **Every route's OpenAPI documentation is derived from the same zod schema
  the handler validates against** (`zodToJsonSchema`), specifically so a
  route's real validation and its published documentation can never drift
  apart — and that documentation is hard-gated to development only (two
  independent checks, not one) since a machine-readable map of every
  parameter and response shape is a convenience for developers, not
  something to leave reachable on the public internet.
- **A pre-commit hook keeps all six locales in sync automatically** — when
  the English source catalogue changes, translation runs _before_ linting,
  and a translation failure blocks the commit outright rather than letting
  a locale silently go stale.
- **Backups exist but are not yet off-box** — nightly `pg_dump` on the same
  VPS it's backing up, honestly documented under "Not built" as a real gap
  rather than glossed over, since one VPS is one failure domain until an
  off-site copy exists.
- **Third-party sources are verified live, not assumed from memory or
  documentation, before anything is built against them.** A source that
  looks reachable can sit behind a bot wall that only shows up when actually
  queried — Heidelberg University Library's IIIF API, evaluated for a
  planned feature, turned out to be openly reachable even though its
  human-facing HTML viewer pages are not, a distinction only a real request
  revealed. A licence tag can also differ from what a summary implies (a
  "no known copyright" Public Domain Mark is not the same legal act as an
  active CC0 dedication). This check-before-build discipline is now a
  standing rule in CLAUDE.md's "Also, always" list, not a one-off.
- **`playwright.config.ts` and `e2e/**` were type-checked by nothing.** The
  root `tsconfig.json` is solution-style (`files: []` plus `references`),
  and no referenced project's `include` covered either — invisible to
  `pnpm typecheck`, and the reason an editor read `process`, `window` and
  `document` inside them as unresolved (not a missing `@types/node`, a
  missing project to belong to). `tsconfig.e2e.json`, referenced from the
  root, closes it — the same shape as the pre-existing `tsconfig.scripts.json`
  and `tsconfig.eslint.json`, each written for exactly this class of orphan
  file.

---

_Generated from the project's own documented architecture, security
invariants, and governance model (`CLAUDE.md`) as maintained in this
repository. Where the source material itself flags something as unverified
or provisional, this summary preserves that flag rather than presenting it
as settled fact._
