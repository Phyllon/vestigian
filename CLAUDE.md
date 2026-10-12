# CLAUDE.md — Vestigian

Context for continuing this project. Read this first.

## What this is

**Vestigian** ("traces") is an atlas of the ancient world — settlements, roads, fortifications, findspots — recorded by the people who visit them. It is an independent reimplementation inspired by [vici.org](https://vici.org), reusing that project's openly-licensed data.

**It is not a fork and must not become one.** Do not copy vici.org's code, markup, layout, or visual language. The data is shared; the character is not.

**Status: the map runs, on real data.** It was originally written without network
access — nothing had been executed, no dependency installed, no query run. That
is no longer true of the spine: the stack comes up, the import pipeline runs
end to end, and 61,272 sites and 11,720 tracings render through `ST_AsMVT`.

Still unexercised: everything above the map — auth, contribution, moderation,
revisions, uploads through the app's own endpoints. Treat those as unverified,
and expect the same class of bug that the map had (see "Start here").

## Design brief

The agreed mood is **"a field notebook carried through Roman Europe."** Every visual decision follows from that sentence.

- Ground is aged laid paper (`#f2ede1`), cooler and greener than a generic warm cream.
- Text is iron-gall ink, browned — never pure black.
- One oxide red (`#9a3b22`) as accent, used **once per screen**, never decoratively.
- Bronze for linear features, verdigris only for approved/confirmed states.
- Dark mode is a _night_ notebook, not an inverted one: warm charcoal, never blue-grey.
- Type: Fraunces Variable (display), IBM Plex Sans (body), IBM Plex Mono (coordinates, ids, licences). **All self-hosted via `@fontsource*` — never a runtime request to Google.** Only `latin` and `latin-ext` are shipped, and only the **weight** axis of Fraunces: the brief once called for its optical-size axis, but `index.css` is a hard link to `wght.css`, so `'opsz'` was being set against a font that did not carry it and did nothing. Restoring it costs 54 KB across the two subsets — worth doing deliberately, not by leaving a dead declaration in the CSS.
- Signature element: `.leaf`, a sheet of the notebook — raised ground, 2px corners, a shallow shadow. It once had a companion `.leaf-margin` that drew a ruled annotation column down the left of every panel; nothing was ever put in the column, so it read as a stray vertical line beside an oddly indented block and has been removed. If the ruled margin returns, it returns with provenance, licence and revision state actually in it.

Tokens live in `app/assets/css/main.css` as Tailwind v4 `@theme` variables. Nuxt UI is pointed at those palettes in `app/app.config.ts`, so components inherit the palette rather than being restyled individually.

## Code conventions (these were specified — follow them exactly)

- **Arrow functions only.** No `function` declarations.
- **Clear, readable function names.** No abbreviations.
- **Define a named interface when a function takes more than two parameters.** Do not add a third positional parameter.
- **Vue SFC order: `<script setup>` first, `<template>` second.** No `<style>` blocks — Tailwind inline only.
- **Nuxt lifecycle hooks (`onMounted`, `onBeforeUnmount`) go at the bottom of the script block**, after all other declarations.
- **Unit tests live in `__test__/` subfolders beside the code they test** — for composables and server utils only. **Components have no `__test__` folders and no tests.**
- **End-to-end tests live in `./e2e`** and run under Playwright against the **production build**, never `nuxt dev` — two of this project's worst bugs existed only in the built output. `pnpm test:e2e`, separate from `pnpm test`. Read `e2e/README.md` before adding one: every anti-flake rule there was a real failure first.
- **Components and composables are grouped into folders by meaning** (`map`, `site`, `contribute`, `auth`, `moderation`, `ui` / `data`).
- **Prefer established open Vue/Nuxt components over hand-rolling.** Nuxt UI v3 (built on Reka UI) covers forms, inputs, buttons, selects, toasts, checkboxes. Do not write a custom form control.
- Tests cover **critical logic only** — tile planning, trust, permissions, rate limiting, licences, diffing, ordering. Not glue.

## Stack and why

| Choice                                   | Reason it was chosen over the alternative                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MapLibre GL JS v6**                    | Vector + GPU. Handles 20k sites via clustering and 1k tracings as styled LineStrings. Leaflet would thrash the DOM; OpenLayers (what vici uses) has a worse mobile feel; Mapbox GL charges per load.                                 |
| **PostGIS `ST_AsMVT`**                   | The viewport requirement is answered by _tiles_, not bbox GeoJSON queries. This is the single most important architectural decision in the project.                                                                                  |
| **PMTiles basemap** (OpenFreeMap in dev) | Custom style = the app's character. A hosted MapTiler style would make it look like everything else. PMTiles is read by the browser over HTTP range requests — **no tile server process exists**.                                    |
| **Drizzle + `postgres.js`**              | TS-first. Drizzle is the default for every query; raw SQL is kept for PostGIS only — six files, not "most of the hot path" as this table used to claim. See "Which client to reach for".                                             |
| **Valkey**                               | Tile cache, sessions, rate limits. Redis-compatible, no licence question.                                                                                                                                                            |
| **Bunny.net + imgproxy**                 | One original stored per image; derivatives on the fly. Zero egress.                                                                                                                                                                  |
| **Brevo**                                | Transactional mail, hosted in the EU (Paris). Replaced Lettermint, the operator's own choice — same EU-hosting rationale either way, carried over from replacing Resend originally.                                                  |
| **terra-draw**                           | Framework-agnostic drawing that works with MapLibre.                                                                                                                                                                                 |
| **Grafana + Loki + Tempo + Prometheus**  | One agent (Alloy) carries logs, traces and metrics; Vector carries no traces, and Alloy's built-in exporters replace four separate exporter containers. Promtail reached EOL in March 2026. All on local disk — see "Observability". |
| **Dokploy on one Netcup VPS**            | One machine, no cluster to run. Dokploy _is_ Docker Compose, so dev and prod are the same artifact.                                                                                                                                  |

The app is strictly 12-factor (env-only config, no local disk writes, `/api/health` + `/api/ready`), so moving to Kubernetes later is a translation, not a rewrite.

## Topic detail lives in `.claude/rules/`

This file carries only what's relevant regardless of what you're touching:
identity, design, conventions, stack, the hard governance/security
invariants, and onboarding. Everything else — the tile pipeline, antiquity
basemaps, the limes, the Tabula Peutingeriana, column reliefs, OpenAPI, SEO,
GDPR specifics, the import pipeline, observability, enrichment/i18n, the
field notebook, deployment — lives in `.claude/rules/*.md`, each scoped by
`paths:` frontmatter so it only loads when you're actually working in that
area. Read a rule file directly if you need its detail outside that scope.

**When you learn something worth recording, it does not default to this
file.** Find the existing `.claude/rules/*.md` file whose `paths:` cover
what you touched and amend that one; if the finding doesn't fit any existing
file's area, create a new one there with its own `paths:` frontmatter,
following the shape of the others (a scoped topic, verified detail, real
bug write-ups over prose summaries). Only add something here, to the main
file, if it's a cross-cutting invariant that matters regardless of which
files are touched — the kind already in Governance/Security below — not a
topic-specific finding. This file grew to 2000+ lines once already from
exactly this default; the discipline that keeps it from happening again is
checking `.claude/rules/` first, every time, not just this once.

## Governance model — do not weaken these

- Every change to a site or tracing is written to `revisions` **before** any live table is touched.
- `applyRevision()` (`server/utils/revisions.ts`) is the **only** place a live row is written — automatic approval, moderator approval and revert all go through it. Never add a second path.
- **Every authorization rule lives in `shared/utils/authorization.ts`** and nowhere else.
- **Trust:** new accounts are queued. After **2 accepted contributions** (`evaluateTrust`), edits publish immediately. Moderators can revoke. Images do not count toward trust.
- **Drift sampling is post-hoc and must never become a gate.** A fraction of auto-approved work is drawn back for a second look _after_ it publishes (`server/utils/sampling.ts`), weighted towards newly trusted accounts and never decaying to zero. It writes `revisions.sampled_at`, never `status` — holding a contribution back would undo the whole promise of trust.
- **A moderator cannot approve their own contribution** (`canReviewRevision`).
- **An edit that removes more than it adds is queued regardless of trust** (`isBlankingEdit`) — a wrong auto-approval on a blanking edit costs far more than a moderator glance.
- **Revert writes a new revision** restoring the prior state. Never delete a revision. History is append-only, and reverts do not increment the moderator's trust counter.
- **A decision reaches the person it was made about** — review and trust decisions mail the author after the write, never before (reverts excluded: their author is the moderator).
- **Nobody can change their own role, and no admin can demote another admin** (`checkRoleChange`) — removing an admin requires direct database access, same as creating the first one. **`checkBan` refuses a block against an admin for exactly the same reason**: a locked-out admin is neutralised as completely as a demoted one.
- **`users.sessions_valid_from` is the only session revocation this app has.** The session is a stateless sealed cookie with nothing to delete, so revocation is `isSessionCurrent` comparing the sealed `loggedInAt` against that column. Blocking an account bumps it, lifting a block bumps it, and `/api/admin/sessions` bumps it alone. Anything that must end a live session bumps it; nothing else can.
- **A block stops the person, not their work.** Published sites, tracings, photographs and revision history are untouched, and pending revisions stay in the moderator queue. Taking work offline is a separate, counted, reversible sweep — never a side effect of a block.
- **Retraction goes through `applyRevision()` like everything else.** Taking a record off the atlas is an approved revision carrying `retracted: true`, not an `UPDATE ... SET status` in an endpoint. No second write path was added for it.
- **Role and trust are re-read from the database inside every guard**, never from the session cookie.
- **Slugs never change on edit.**
- Suspension leaves `approved_contributions` untouched, so restoring trust returns someone exactly where they were.

Full rationale (why Casbin/CASL/Cerbos were rejected, the notification mechanics, the last-admin proof) is in `.claude/rules/security-and-governance.md`.

## Security invariants — do not weaken these either

- argon2id at OWASP parameters; login always hashes (against `DUMMY_HASH`) so timing cannot enumerate the user table.
- `forgot-password` responds **identically** whether or not the address exists. Registration reports a duplicate email/display name as 409.
- Only the SHA-256 **hash** of an email token is stored; comparison is constant-time.
- **A password reset tells the owner it happened.**
- **An unverified login re-sends the confirmation link**, rate-limited.
- **Mail delivery never throws** — failures land in the log and in `mail_deliveries_total{outcome="failed"}`, never as a different HTTP outcome.
- **Nothing a user typed reaches an inbox as markup** (`renderTokenEmail` escapes).
- Uploads: format is read from **magic bytes**, every image is **re-encoded through sharp**, storage keys derive from database ids, never the filename.
- Images with an unresolved licence (`UNKNOWN`) or `ARR` are never published.
- Signup: self-hosted **ALTCHA** + honeypot + per-IP rate limit + email verification, and a disposable-domain check on the address (`server/utils/disposable-email.ts`).
- **Every authenticated route asks `requireActiveUser`, not `requireUserSession`.** The latter only proves a cookie unseals; the former is what makes a block and a revoked session bite on contributing, uploading and endorsing rather than only on the moderation routes a blocked contributor could never reach.
- **Role changes, blocks and bulk retraction demand the password again** (`requireStepUp`), and that check **fails closed** on a cache outage — the one deliberate inversion of `enforceRateLimit`'s fail-open, because those are the actions this app cannot undo from inside itself.
- **Forwarded headers are believed only behind a trusted proxy** (`NUXT_BEHIND_TRUSTED_PROXY`); `x-forwarded-for` is deliberately never read.
- **The session cookie expires** (`maxAge` set).
- **sharp is given an explicit `limitInputPixels`.**
- **Detection is not enforcement** — CrowdSec writes decisions; nothing applies them until a bouncer exists.
- Rate limiting **fails open**.
- CSP allows only the map asset origins listed in `nuxt.config.ts`.
- **Two-factor login is opt-in TOTP, and nothing else** — no third-party provider; the secret is encrypted (not hashed), backup codes are hashed and single-use.
- **`nuxt-security`'s `xssValidator` is deliberately off** — safe only because there is no `v-html` anywhere in this app.
- **A description is stripped of markup on the way in** (`stripHtml`), not merely escaped on the way out.

Full rationale for every bullet above — the 2FA key-loss risk, why `xssValidator` breaks on ordinary text, the `stripHtml` implementation detail — is in `.claude/rules/security-and-governance.md`.

## Layout

```
e2e/                         Playwright, against the production build (+README)
i18n/locales/ en fr es de it nl .json    bootstrapped by scripts/i18n/translate-locales.ts
service-worker/sw.ts         offline caching; built separately via injectManifest, own tsconfig
app/
  assets/css/main.css        design tokens (Tailwind v4 @theme)
  components/
    map/       MapCanvas BasemapSwitcher GeolocateButton MapSearchField Legend FeaturePicker
               OfflineDownloadControl OverlaySwitcher PeriodSwitcher
    site/      SiteDetailPanel SiteGallery SiteGalleryManager SiteMetaList
               SiteExternalLinks SiteEnrichment SiteEndorsementButton
    tracing/   TracingDetailPanel
    contribute/ ContributionPanel SiteEditorForm TracingEditorForm GeometryDrawTool ImageUploader
    auth/      LoginForm RegisterForm PasswordField PasswordRequirements AccountMenu
    moderation/ ReviewQueue RevisionDiff
    admin/     AdminCommandBar AdminActivityStream AdminAccountTable AdminAccountDossier
               AdminImageQueue AdminAuditLog AdminSystemPanel AdminStepUpDialog
    epigraphy/ EpigraphyNearbyInscriptions EpigraphyNearbyAtticInscriptions
    limes/     LimesPanel
    terrain/   TerrainTowerSightlines TerrainSightRose TerrainRaySection TerrainRayChart
               TerrainSectorWatch TerrainTracingProfile TerrainProfileChart
    notebook/  NotebookControls MilestoneStamps
    columns/   ColumnTrajanGallery ColumnTrajanViewer.client
               ColumnMarcusAureliusViewer.client ColumnPlatePager
    tabula-peutingeriana/ TabulaPeutingerianaViewer.client
    ui/        ThemeToggle LanguageSwitcher LanguageNotice RevisionHistory AppMenu
  composables/
    map/  useMapInstance useBasemapStyle useViewportTiles useGeolocation useSiteIcons
          useNotebookOverlay useOfflineAreas useTabulaPeutingerianaOverlay
          useAtlasPlaceOverlay useLimesOverlay usePeriodOverlay useEmpirePeriods
          useBattleOverlay usePortOverlay useRouteOverlay useCoinHoardOverlay
          useMinorFeatureOverlay useInscriptionsOverlay useAtticInscriptionsOverlay
          useReferenceOverlays useOverlayPopup
                                                                                   (+__test__/)
    data/ useSiteQuery useSiteEnrichment useSiteEndorsement useImageUrl useCanonicalUrl
          useNoIndex useSocialMeta                                                     (+__test__/)
    epigraphy/ useInscriptionBrowse useNearbyInscriptions
               useAtticInscriptionBrowse useNearbyAtticInscriptions
    columns/ useColumnPlatePosition useOpenSeadragonHost                               (+__test__/)
    auth/ useSession
    admin/ useAdminStepUp
    user/ useNotebook
    limes/ useLimes
    terrain/ useTowerSightlines useTowerRay useSectorWatch useTracingProfile useTerrainFormat
    ui/   useColorScheme useUiLocale useBreakpoint useCountryName                      (+__test__/)
  layouts/ default.vue (map shell) reading.vue (documents)
  middleware/ authenticated.ts moderator.ts admin.ts (404s, not 403s)
  router.options.ts          scroll behaviour; the camera hash is not a selector
  pages/ index login register verify forgot-password reset-password
         licence privacy impressum settings offline partners
         notebook/index notebook/visits notebook/contributions
         contributor/[name]
         site/[slug] site/[slug]/edit tracing/[id] tracing/[id]/edit
         limes/index limes/[slug]
         inscriptions/index inscriptions/[edhId]
         inscriptions/attic/index inscriptions/attic/[aioKey]
         inscriptions/sicily/[isicilyId]
         moderation/index          admin/index (one station, sections in the query string)
         tabula-peutingeriana columns nearby
server/
  plugins/ observability.ts   the only per-request hook: id, access log, span
  middleware/ content-language.ts   sets Content-Language from the locale cookie
  api/ tiles/[z]/[x]/[y]  tiles/antiquity/[z]/[x]/[y]
       tiles/reference/[layer]/[z]/[x]/[y]  tiles/antiquity-polities/[year]/[z]/[x]/[y]
       isicily-inscriptions/[isicilyId]
       tiles/limes/[z]/[x]/[y]  tiles/basemap/[z]/[x]/[y]
       sites/ (+ [id]/endorse.post.ts endorse.delete.ts sightlines.get.ts sightlines/ray.get.ts needs-work)
       tracings/ (+ [id]/profile.get.ts)  contributions/  places/
       limes/sectors/[slug]/ (+ sightlines.get.ts sightlines.geojson.get.ts)
       auth/ (+ account.delete.ts export.get.ts change-password.post.ts change-email.post.ts)
       me/ (index.get/patch contributions visits bookmarks map.geojson field-kit.gpx)
       contributors/[name]
       moderation/  data/  limes/
       admin/ (activity accounts accounts/[id] images audit system
               step-up ban retract sessions)
       images/[id]/[preset]  sites/[id]/enrichment  health ready metrics openapi.json
       column-reliefs/ (+ [id]/[preset])  tabula-peutingeriana/network.geojson
  routes/ robots.txt sitemap.xml sitemap-static.xml
          sitemap-sites/[page]  sitemap-tracings/[page]  sitemap-inscriptions/[page]
          sitemap-attic-inscriptions/[page]  sitemap-isicily-inscriptions/[page]
  database/ schema/ (users sites notebook endorsements geo atlas imports) migrations/ migrate.ts
  utils/ mvt atlas limes openapi permissions ratelimit images images-order uploads tokens diff
         step-up retraction admin-audit disposable-email
         notebook gpx basemap-pmtiles endorsements
         site-record validation sanitize
         mail mail-template notifications
         revisions slug db cache argon altcha enrichment enrichment-sources concordances
         concordance-sources translate logger metrics tracing sitemap
         totp two-factor sampling
         inscriptions attic-inscriptions battles ports orbis-routes
         coin-hoards minor-features terrain sightlines elevation-profile
                                                                            (+__test__/)
shared/types/  vocabulary shared by both sides
shared/utils/  password policy, authorization rules, the limes gazetteer, JSON-LD builders,
               tile enumeration and limits, offline-cache naming, byte formatting,
               milestones, Pleiades identifiers, Linked Places (Pelagios) builders,
               record completeness, line of sight (sightline, seen-grid, sightline-overlay,
               sector-watch), elevation profile                                   (+__test__/)
scripts/import/  four-stage vici.org import + vici-licences.ts (shared vocabulary)
                 guard.ts (upstream delta tripwire, +__test__/)
                 02c-geo-names.ts 04-mirror-basemap-tiles.ts 05-antiquity-atlas.ts
                 06-limes.ts 07-country-boundaries.ts 08-edh-findspots.ts 09-cities.ts
                 10-tabula-peutingeriana.ts 11-column-reliefs.ts 12-edh-inscriptions.ts
                 13-battles.ts 13-edh-inscription-images.ts 14-ancient-ports.ts
                 15-orbis-routes.ts 16-awmc-minor-features.ts 17-awmc-minor-lines.ts
                 18-chrr-coin-hoards.ts 19-ohm-empire-extents.ts 20-attic-inscriptions.ts
                 21-itinere-roads.ts 22-nomisma-mints.ts 23-wikidata-monuments.ts
                 24-isicily-inscriptions.ts 25-cliopatria-polities.ts 26-hillforts-atlas.ts
                 atlas-cache.ts
scripts/sightlines/build-sector-sightlines.ts  what a sector's towers see together (`pnpm sightlines:build`)
scripts/generate-og-placeholders.ts  static per-category Open Graph cards, run by hand
scripts/generate-brand-assets.ts  the V mark, favicon and partner badges; `pnpm brand:build` runs it with icons and OG cards
scripts/brand/vestigian-mark.ts  the one definition of the mark
scripts/warm-tiles.ts snapshot-database.ts reconcile-images.ts build-glyphs.ts
                 strip-description-html.ts backfill-country-codes.ts verify-concordances.ts
scripts/i18n/translate-locales.ts   bootstraps i18n/locales/{fr,es,de,it,nl}.json via LibreTranslate
public/fonts/    self-hosted SDF label glyphs + the font's OFL
docker/  Dockerfile compose.dev.yml compose.prod.yml traefik/ backup.sh
  observability/  alloy.alloy loki.yml tempo.yml prometheus.yml alerts.yml
                  alertmanager.yml grafana/{datasources,dashboards}
```

## Start here (in this order)

The map, the tile pipeline and the record import now run and have been seen
working against real data. What has _not_ been exercised is most of the
application above the map: auth, contribution, moderation, revisions.

1. `pnpm install`
2. `pnpm stack:up && pnpm db:migrate && pnpm dev`
3. Import — see "Import pipeline" below. The map is populated after
   `import:convert`; photographs come later and cost someone else's bandwidth.
4. `pnpm check` — lint, typecheck, tests (with coverage floor), formatting, SAST,
   secrets, and Dockerfile / shell / workflow-and-config / migration checks, run in parallel by
   `concurrently` and reported under one exit code. It is the same gate CI
   runs. **It passes; treat any output as a regression rather than as the
   backlog it used to be.** Typecheck in particular was 36 errors and is now
   zero — the `Transaction` alias in `server/utils/revisions.ts` was most of
   them, deriving its type from an overloaded `sql.begin` and collapsing to
   `never`.
5. `pnpm stack:observability` when you need Grafana — see "Observability".
6. `pnpm fix` applies what is mechanically fixable: `lint:fix` then `format`.
   It is deliberately sequential — ESLint and Prettier both rewrite the same
   files, so running them together would have them clobbering each other.
7. Git hooks run automatically after `pnpm install` (Husky's `prepare` script,
   alongside `nuxt prepare` in `postinstall`). **pre-commit** runs
   `lint-staged` — the same `eslint --fix` then `prettier --write` order as
   `pnpm fix`, scoped to staged files. **commit-msg**
   (`scripts/verify-commit-msg.ts`) rejects an empty or under-10-character
   subject; it is a structural check, not a conventional-commits gate — this
   repo's own log is lowercase, imperative, no type prefix, and the hook
   protects that style rather than replacing it. **pre-push** runs the full
   `pnpm check`, the same gate CI runs, so a bad push is caught locally first.

Two things that had never run and silently broke everything, now fixed — worth
knowing because both failed _invisibly_:

- **CSP without a nonce token killed the entire client app.** `script-src` did
  not allowlist the nonce Nuxt stamps on its inline scripts, so the one setting
  `window.__NUXT__.config` was refused and Vue never mounted. The page showed
  its server-rendered "Unfolding the map" placeholder forever.
- **`maplibre-gl.css` was never imported**, leaving the canvas `position: static`.

Scripts do not read `.env` on their own — every `tsx` entry in `package.json`
now passes `--env-file-if-exists=.env`. Before that, `NUXT_DATABASE_URL` was
`undefined` in all of them and they worked only because their fallbacks happened
to match the compose defaults. Those fallbacks are gone: a missing URL now
stops the script (`requireDatabaseUrl`, `server/database/database-url.ts`), so
a script run by hand needs `tsx --env-file-if-exists=.env` too.

## Not built

- Purging withdrawn images from object storage (withdrawal is reversible by design — nothing deletes bytes).
- Notifications beyond mail. A review decision and a trust change reach the
  person by email (`server/utils/notifications.ts`), and `users.notify_by_email`
  now turns both off from `/settings`; a role change and a revert still send
  nothing, and there is nothing in the interface itself. Security notices —
  password changed, address change requested — deliberately ignore that
  preference, for the reason given under "Credentials" above.
- Full-text search across descriptions (titles and summaries only).
- Full i18n component coverage — see "i18n" above for what is and is not migrated. Note the vici source has `nl`, `de` and `fr` text for thousands of sites — the import takes `en` and discards the rest; none of that is surfaced by the interface language yet, only the borrowed Wikipedia enrichment is.
- Purging withdrawn images from object storage stays unbuilt (above), and
  `pnpm db:snapshot` still writes beside the database it copies — it is a
  developer convenience, not a backup. The **nightly** backup does now leave the
  machine: `docker/backup.sh` pushes each dump to a restic repository and
  `docker/restore-drill.sh` proves one restores. See
  `.claude/rules/deployment-and-releases.md`.

## Working style for this project

Cross-project working-style preferences (say it once in the file, keep chat
short, ask before spawning agents, don't announce completed tasks) now live
in `~/.claude/CLAUDE.md` and apply here too. What follows is specific to
this project.

**Also, always:**

- **Mobile first.** Every component optimised for phones (fast load, real UX),
  desktop second but not neglected. Breakpoints: 375px–<768px phone, <1000px
  tablet, above desktop.
- **Fast, clean, modern.** Make it quick, keep it readable, use current best
  practice.
- **Lazy-loading** use lazy-loading always where suitable to decrease first loading bytes (composables & components)
- **Accessibility every time** — ARIA and the rest, improved where possible. Also take keyboard i18n into account.
- **Semantic HTML** — the most fitting tag, always.
- **ORM over string queries.**
- **Install type packages** whenever they exist, and use those types.
- **Open source** look for established open source projects to solve some problem first instead of
  writing the logic yourself directly. Then ask for decision
- **EU/GDPR compliance** all packages or code dealing with user data or which are user-related must be GDPR compliant
- **e2e-tests** add e2e-tests when new features were added. do not run them on your own for checks.
- **i18n** always use i18n for defined languages (de, en, fr, es, it, nl)
- **Deep nesting** never use nested terneries
- **Verify third-party sources before integrating them** — before mirroring or
  linking to any external open-data, open-source, or IIIF/tile asset, confirm
  its actual licence and reachability with a real request (fetch the source,
  check its licence tags, hit the real endpoint), not from memory or
  documentation alone. Also you are free to use NC licenses. Cite what was actually checked and
  how.
- **Maintain documentation** Keep documentation up-to-date (documents/, .claude/rules/) after implementing a new feature
- **commits** never commit code yourself, always wait for user instruction
- **changesets** fill in changesets with brief descriptions of the current commit's changes
