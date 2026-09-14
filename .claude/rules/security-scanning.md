---
paths:
  - 'scripts/security/**'
  - '.opengrep/**'
  - '.gitleaks.toml'
  - '.hadolint.yaml'
  - '.husky/pre-commit'
  - 'eslint.config.mjs'
---

## SAST/DAST — local only, no GitHub Actions minutes spent

Everything below runs on the developer's own machine (Docker + two vendored
CLI binaries), wired into `.husky/pre-commit` and `pnpm check` (the same
gate `.husky/pre-push` already ran) — nothing was added to
`.github/workflows/**`. Dependabot was considered and explicitly excluded per
instruction; dependency scanning instead runs locally via `pnpm scan:deps`
(osv-scanner), on demand, not as an always-on bot opening PRs.

| Layer                 | Tool                                | Where it runs              | Blocking?                                        |
| --------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------ |
| SAST                  | `eslint-plugin-security`            | `pnpm lint` (existing)     | Yes — part of `pnpm check`                       |
| SAST                  | opengrep (`scan-sast.sh`)           | `pnpm check`, pre-push     | Yes (`--error`)                                  |
| Secrets               | gitleaks (`scan-secrets.sh`)        | `pnpm check`, pre-push     | Yes                                              |
| Secrets               | gitleaks `--staged`                 | `.husky/pre-commit`        | Yes, per commit                                  |
| Dockerfile lint       | hadolint (`lint-dockerfile.sh`)     | `pnpm check`, pre-push     | Yes                                              |
| Image scan (SCA)      | Trivy (`scan-image.sh`)             | manual (`pnpm scan:image`) | No — builds the image first, minutes not seconds |
| Dependency scan (SCA) | osv-scanner (`scan-deps.sh`)        | manual (`pnpm scan:deps`)  | No — queries osv.dev over the network            |
| DAST                  | OWASP ZAP baseline (`scan-dast.sh`) | manual (`pnpm scan:dast`)  | No — full build + boot per run                   |

## opengrep, not Semgrep

[opengrep](https://github.com/opengrep/opengrep) is a full fork of the
Semgrep OSS engine, taken December 13, 2024 — before Semgrep Inc. moved parts
of its rule registry behind a login. Same rule syntax, same CLI, no account
needed anywhere in this setup.

`scripts/security/install-opengrep.sh` downloads the pinned opengrep binary
and a pinned snapshot of `opengrep/opengrep-rules` (commit
`f1d2b562b414783763fd02a6ed2736eaed622efa`, the fork point) into `.tools/`
(gitignored, regenerated on demand — nothing here is committed). Re-run it
by hand to bump either pin; nothing bumps them automatically.

**Binary selection matters on Linux.** The obvious `musllinux` asset needs
`/lib/ld-musl-x86_64.so.1`, which a glibc distro (Ubuntu/Debian/Zorin/Fedora/…)
does not have — confirmed by actually hitting that missing-loader error, not
assumed. The install script uses `manylinux` for Linux instead.

### The vendored ruleset is an allowlist, not a denylist

A first pass vendored the entire `javascript`/`typescript`/`dockerfile` trees
and ran it against this codebase: **1196 findings on real source** (after
excluding `.tools/` itself from the scan — the first number, 1461, included
the ruleset's own bundled test fixtures matching each other). Nearly all of
it was rule packs for frameworks this project does not use at all:

- `typescript/react/portability/i18next` alone matched 25 ordinary
  `vue-i18n` `t()` calls — this is a Vue app, not React.
- `javascript/express/*` (142+ hits) — this app is Nitro/h3, not Express.
- `javascript/jquery/*` (38 hits) — cheerio's `$(el)` wrapping a DOM
  element, not a jQuery selector built from a string; the rule can't tell
  the two idioms apart.
- `typescript/aws-cdk/*` (53 hits), `javascript/jose`/`jsonwebtoken` (30
  hits — sessions here are sealed cookies via `nuxt-auth-utils`, not raw
  JWT), `javascript/phantom`, `sequelize` (Drizzle, not Sequelize) — all
  zero relevance.

Vendoring the full registry and suppressing findings after the fact would
mean every registry update risks silently reintroducing that noise. Instead
`install-opengrep.sh` copies an **explicit allowlist** matching this
project's real stack — `javascript/{lang,node-crypto,argon2,vue,playwright}`,
`typescript/lang`, `dockerfile/*` — so a future upstream addition for some
other framework is never even fetched.

Three more rules were dropped from even that curated set, each with the
false positive that justified it:

- `javascript/lang/correctness`, `*/lang/best-practice` (both languages) —
  style/compat, not security (e.g. flagging `.replaceAll()` for pre-2021
  browser support).
- `javascript/lang/security/html-in-template-string` — flagged every
  already-escaped template literal in `mail-template.ts` and `sitemap.ts`
  alike, with no taint tracking to tell "interpolates an escaped value" from
  "interpolates a raw one." Pure noise against code that exists specifically
  to close this gap (`renderTokenEmail`/`escapeXml`, both tested).
- `dockerfile/audit/dockerfile-source-not-pinned` — see "Accepted, not
  fixed" below; this is the same finding `.hadolint.yaml` already excludes
  for the identical reason, kept in exactly one place rather than nagging
  twice for a decision already made.

Final curated set: **79 rules, 0 findings** on this codebase as of this
setup. Re-run `pnpm scan:sast` after any change; a real hit fails the exit
code (`--error`), including the project's own three custom rules below.

### Custom rules — governance invariants as an enforced diff check, not prose

`.opengrep/rules/` (committed, unlike the vendored community set) encodes
three invariants from this project's CLAUDE.md as rules a diff actually gets
checked against:

- `single-write-path.yml` — no file but `server/utils/revisions.ts` may
  `.update()`/`.insert()` into `sites` or `tracings`. Verified against a
  deliberately-introduced violation in a scratch file: fired correctly,
  failed the exit code, removed after confirming.
- `authorization-single-source.yml` — no `.role === '...'` /
  `.role !== '...'` comparison inside `server/api/**`, `app/middleware/**`
  or `server/utils/permissions.ts`; import from
  `shared/utils/authorization.ts` instead. Scoped narrowly on purpose: a
  blanket rule would also flag `app/components/admin/AdminAccountTable.vue`
  (a pure display filter, already gated server-side by `requireAdmin`) and
  `shared/utils/milestones.ts` (a read-only "trusted" badge, not a gate) —
  both real, both not authorization decisions, checked against the running
  codebase before scoping the rule to avoid exactly that false-positive
  class.
- `require-active-user.yml` — `requireUserSession()` should not appear in
  `server/api/**` outside `server/api/auth/**` (no session exists yet
  there) and `server/api/me/index.patch.ts` (a documented, deliberate
  exception — see its call site's docstring in
  `server/utils/permissions.ts`).

All three currently match nothing in the real codebase — that absence is
the point being enforced, not a gap.

## Real findings fixed as a result of this setup

- **`server/utils/totp.ts`** — `createCipheriv`/`createDecipheriv` for the
  2FA secret's AES-256-GCM encryption didn't pin an explicit auth-tag
  length. Node defaults to 16 bytes already, but leaving it implicit means
  `setAuthTag` would accept any shorter tag supplied at decrypt time — now
  pinned explicitly on both sides (`AUTH_TAG_LENGTH = 16`). Confirmed
  against `totp.test.ts` (9 tests, still passing) — this touches the
  encrypted-2FA-secret path CLAUDE.md's security invariants call out.
- **`scripts/i18n/translate-locales.ts`'s `unflatten()`** — walked
  dot-separated key-path segments into a nested object
  (`cursor = cursor[segment]`) with no guard against `__proto__`,
  `constructor` or `prototype` segments — the textbook prototype-pollution
  loop shape. The keys currently only ever come from this project's own
  `en.json`, but the guard costs one `if` and closes the class of bug
  outright rather than relying on provenance. (This script is retired from
  the standard i18n workflow per `.claude/rules/enrichment-and-i18n.md` but
  still runs on demand, so the fix still matters.)
- **`docker/Dockerfile`'s `HEALTHCHECK`** — shell form (`CMD node -e "..."`)
  changed to JSON-array/exec form. Verified, not assumed: built a minimal
  throwaway image with the same healthcheck shape and confirmed
  `docker inspect` reports `"Status":"healthy"` before touching the real
  Dockerfile.
- Two false-positive suppressions with inline rationale, both verified
  false before suppressing: `server/api/me/index.patch.ts`'s camera-hash
  regex (`detect-unsafe-regex` — three sibling optional groups that don't
  nest or overlap, so no ambiguous backtracking path despite the plugin's
  star-height heuristic) and `docker/security/bunny-bouncer/bouncer.mjs`'s
  `log`/`warn` helpers (`unsafe-formatstring` — the "format string" argument
  is already fully interpolated before it reaches `console.log`, and the
  second argument is never used to fill a placeholder in the first).

## Accepted, not fixed — a deliberate trade-off, not an oversight

**`FROM node:26-alpine` is not pinned to a digest**, in either Dockerfile,
and **`apk add --no-cache tini vips` is not pinned to exact package
versions** (hadolint DL3018). Both are real reproducible-builds
improvements. Both are left alone for now because Alpine's package index
keeps only the current build per branch — pinning an exact `apk` version
risks a future build failing outright when that build is pruned, and this
project has no Renovate/Dependabot (excluded per instruction) to keep a
pinned digest from going stale unnoticed either. Documented once, in
`.hadolint.yaml`'s `ignored:` comment and excluded from opengrep's vendored
set for the same reason (see above) rather than nagging about the same
undecided trade-off in two tools. Revisit if/when this project adds a
dependency-update bot of some kind.

## Dependency vulnerabilities — 41 down to 22

`pnpm scan:deps` (osv-scanner against `pnpm-lock.yaml`) first reported **41
across 17 packages**. It now reports **22 across 6**, and every one that remains
is there for a stated reason rather than because nobody looked.

### Fixed

- **`sharp` 0.33.5 → 0.35.4** (CVSS 8.9). Every uploaded image is re-encoded
  through it, so this was verified against the real pipeline rather than the
  unit tests alone: the exact `sharp(…, { failOn: 'error', limitInputPixels })`
  → `.rotate()` → `.metadata()` → `.resize()` → `.jpeg({ mozjpeg })` sequence
  from `contributions/images.post.ts`, checked for EXIF actually being stripped,
  for `limitInputPixels` still **throwing** (the decompression-bomb guard, not a
  warning), and for a malformed buffer still throwing rather than hanging.
  One source change was needed: 0.35 stopped publishing its types as a namespace
  beside the default export, so `sharp.Metadata` became
  `import { type Metadata }`.
- **`drizzle-orm` 0.36.4 → 0.45.2** and **`drizzle-kit` 0.28.1 → 0.31.10**
  (CVSS 7.5). Verified by `pnpm typecheck` clean and `pnpm db:generate`
  reporting _no schema changes_ — a bumped kit that reads the schema differently
  would have produced a spurious migration, which is the failure to watch for.
  Deliberately **not** 1.0, which is still release-candidate.
- **`vitest` 2.1.9 → 4.x** (CVSS 9.8) plus `@vitest/coverage-v8`. This also
  cleared `@vitest/mocker`, and the `vite` 5.4.21 / `esbuild` 0.21.5 that were
  vitest's own bundled internals. All 561 tests pass unchanged.
- **`happy-dom` removed entirely** (CVSS 9.3 among three). It was declared in
  `package.json` and imported by nothing — `vitest.config.ts` runs
  `environment: 'node'`. Deleting an unused dependency beat bumping it.
- **`js-yaml`, `svgo`, `minimist`** lifted through `pnpm.overrides`, since each
  sits behind a parent that will not move on its own schedule.

### The `@nuxt/ui` advisory, fixed without the major bump

GHSA-gj2h-2fpw-fhv9 (6.9) is fixed upstream in `@nuxt/ui` **4.8.1** — a major
version of the entire design system. The vulnerability itself is one attribute:
`UForm` renders a bare `<form>` whose only submit handling is `@submit.prevent`,
so a submit that lands **before Vue hydrates** — slow mobile network, a bundle
blocked by CSP, autofill firing Enter early — falls through to the browser
default, which is GET. That serialises every field into the query string.

For this app that means a password in the address bar, in browser history, in
the `Referer` header of the next request, and in every access log between the
visitor and the origin. Mobile-first plus a strict CSP is exactly the profile
where pre-hydration submits happen.

The upstream patch is `method="post"`. That was applied by hand to **every**
form in the app — the four `UForm`s carrying credentials, and the hand-written
`<form>` elements too, which have the identical shape: the 2FA challenge in
`LoginForm.vue`, `AdminStepUpDialog.vue` (the password prompt in front of the
irreversible admin actions), and the password/email-change forms in
`settings.vue`. Confirmed first that `UForm` sets no `inheritAttrs: false`, so
the attribute genuinely reaches the rendered `<form>`.

The 4.x upgrade is therefore worth doing on its own merits, not as a security
fix. **If a new form is added, it needs `method="post"` until then.**

### Still open, and why

- ~~`maplibre-gl` 5.24.0 → 6.4.1 (CVSS 10.0)~~ — **done**, at 6.9.0. The
  adapter turned out not to gate it (`terra-draw-maplibre-gl-adapter` peers on
  `maplibre-gl: >=4`), and the 26 importing files were almost all named or
  type-only imports already. See `.claude/rules/map-and-tiles.md` for the
  advisory's actual reach here and for the one non-optional migration step.
- **`xmldom` (14), `xlsx` (2), `adm-zip` (1), `esbuild` 0.18.20 (1)** — all
  **devDependencies reachable only from import scripts a human runs by hand**,
  never from the shipped `.output`. `xmldom` comes via `osmtogeojson`
  (`19-ohm-empire-extents.ts`), `xlsx` via `14-ancient-ports.ts`, `adm-zip` via
  the cities/AWMC importers, `esbuild` via `drizzle-kit`'s deprecated
  `@esbuild-kit/esm-loader`. Most have no fixed version at all. The honest
  mitigation is not a bump that does not exist but knowing what those scripts
  wrote — which is what the import guards are for.

`pnpm.overrides` lives in `package.json`, which is correct for the pinned
`packageManager: pnpm@9.12.0` and is recorded in `pnpm-lock.yaml`'s own
`overrides:` block. A **newer** pnpm on `PATH` warns that it ignores that field
(pnpm 10 moved settings to `pnpm-workspace.yaml`); if the pinned version is ever
raised, the overrides have to move with it or they silently stop applying.

Full current table: run `pnpm scan:deps`.

## Vulnerability disclosure

`public/.well-known/security.txt`, RFC 9116, served straight out of `public/`
with no route of its own. **Every value in it is a placeholder** matching the
ones `impressum.contactPlaceholder` already carries, and must be filled in
before the site is public — a security.txt advertising an address nobody reads
is worse than none, because it stops a finder looking for another way through.

`Expires` is an obligation rather than a formality: RFC 9116 says a consumer
should treat an expired file as absent, so the date has to be moved before it
passes or the file quietly stops counting.

## Not yet validated end to end

- **`scan-image.sh` (Trivy)** — was blocked by the image build failing on
  `corepack enable` (Node 26 unbundled corepack). That is fixed in
  `docker/Dockerfile` and the image now builds end to end, so this is
  unblocked; see `.claude/rules/deployment-and-releases.md` for why that
  failure was invisible from outside.
- **`scan-dast.sh` (ZAP baseline)** — follows the exact
  `pnpm build && node .output/server/index.mjs` pattern
  `playwright.config.ts`'s `webServer` already uses for e2e (same port
  pattern, different port: 3112 vs e2e's 3111, to avoid a collision if both
  run at once). Actually run once, with the dev stack already up: the build
  and boot worked (`/api/health` answered 200 to the script's own polling),
  but the ZAP container could not reach the app over `--network host` —
  confirmed this was the sandbox's own Docker networking, not the script:
  a bare `curl`/`alpine` container with `--network host` also could not
  reach Postgres or Valkey on the host's published ports from inside that
  session, meaning that sandbox's Docker daemon and shell don't share a
  network namespace the way `--network host` assumes on an ordinary Linux
  dev machine. Re-run `pnpm scan:dast` on a real developer machine to get an
  actual report — nothing about the app or the script itself is in
  question, only whether this one sandboxed run could reach it.

**ZAP baseline is safe to run locally, including against a real build.**
Baseline mode is passive only: it crawls with a spider and inspects response
headers/config (CSP, cookie flags, missing security headers) — it never
sends the SQLi/XSS attack payloads ZAP's _full active_ scan does. That is
what makes it safe against this app's own production build and not against
a live deployment: an active scan belongs against a disposable staging
environment, never this app's real contribution/moderation endpoints, since
it could genuinely write garbage revisions through them (this repo has no
staging environment yet, so active scanning stays out of scope entirely for
now — see the earlier SAST/DAST planning conversation for why).
