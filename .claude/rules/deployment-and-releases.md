---
paths:
  - 'docker/**'
  - '.github/workflows/**'
  - '.changeset/**'
  - 'scripts/verify-commit-msg.ts'
  - 'scripts/db-snapshot.ts'
  - 'scripts/reconcile-images.ts'
---

## Backups — two stores that fail apart

```bash
pnpm db:snapshot        # pg_dump -Fc → .import/snapshots/, keeps 14
pnpm images:reconcile   # do the database and the object store still agree?
```

The database is reproducible until the first real contribution lands; the
mirrored photographs never are. `images:reconcile` exists for one silent
failure: a database restored newer than the bucket leaves rows at `approved`
describing objects that are gone, and the gallery breaks while every query
reports health. `--repair` returns those rows to `pending`. Orphaned objects are
reported only — nothing in this project deletes bytes.

Neither snapshot leaves the machine yet — see "Not built".

Data is CC BY-SA (text) / CC0 (metadata); **image licences vary per record**, which is why `licence` and `attribution` are non-null columns and attribution renders under every image rather than hiding behind an interaction.

## Security layer — detection, and where it is enforced

CrowdSec reads the app's own structured logs (route pattern plus an `audit`
vocabulary, which is far more precise than a status code and a path) and writes
decisions. AppSec covers the WAF slot in the same ~150 MB engine — virtual
patching plus generic SQLi/XSS rules — which is why no separate WAF container
exists. Config and the full reasoning: `docker/security/README.md`.

**Nothing is enforced yet.** A decision does nothing until a bouncer reads it,
and the right place is the Bunny edge rather than this box: CrowdSec, Traefik's
limiter and the Valkey limits all run _after_ a request has paid for a TCP
connection and a TLS handshake. Hetzner's included DDoS protection covers L3/L4
and explicitly not L7 HTTP floods, so those can only be absorbed at the edge.

Rejected, with reasons, so they are not revisited by default: **fingerprinting**
(EDPB 2024 puts it under GDPR _and_ ePrivacy, and it duplicates ALTCHA plus
email verification plus trust 0); **fail2ban** (behind any CDN it bans edge
addresses); **SafeLine** (2 vCPU / 4 GB, and it would replace Traefik);
**Coraza** (the WASM Traefik plugin ships no CRS; the fast one is Traefik Hub);
**KrakenD** (an API gateway, not a WAF); **Wazuh** (6–16 GB for the indexer);
**Zeek/Snort/Suricata** (network IDS, and the traffic is TLS).

## Deployment

`docker/compose.prod.yml` is the deployment unit. GitHub Actions runs tests, builds a multi-stage image to GHCR, calls a Dokploy webhook. Traefik terminates TLS. Nightly `pg_dump` kept 14 days.

**One VPS is one failure domain.** Test the restore, not just the dump.

To move from OpenFreeMap to self-hosted tiles: download a Europe + Mediterranean extract from maps.protomaps.com, upload to R2, set `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles` and `NUXT_PUBLIC_BASEMAP_PMTILES_URL`.

## Versioning & releases

Semantic versioning, via [Changesets](https://github.com/changesets/changesets)
— not Conventional-Commits-driven tooling (`semantic-release`,
`standard-version`). Those infer the bump from a commit message prefix, and
this repo's `commit-msg` hook (`scripts/verify-commit-msg.ts`) deliberately
protects the opposite: a lowercase, imperative subject with **no** type
prefix, checked structurally (length only), not rewritten to fit a
convention. A changeset is a small file under `.changeset/`, independent of
the commit message, that records what changed and how it should move the
version — see `.changeset/README.md` for the contributor-facing how-to and
what warrants patch/minor/major on a `private: true` app that is never
published to a registry.

**The primary path is a direct push to `main`.** This project has no
release-PR step to merge — commits land on `main` directly, so
`.github/workflows/release.yml` runs on every push there: if pending
changeset files exist, it runs `pnpm changeset:version` (bumps
`package.json` and rewrites `CHANGELOG.md`, consuming the changeset files),
commits that with `[skip release]` in the message, tags `vX.Y.Z`, and cuts a
GitHub Release with that version's changelog section as its notes. The
`[skip release]` marker is what stops the bump commit's own push from
re-triggering the workflow — without it every release would be followed by
a second, no-op run checking (correctly) that no changesets remain.

**The secondary path is a branch/PR.** `.github/workflows/changeset-check.yml`
runs on `pull_request` against `main` and reports (does not block — no
branch protection currently depends on it) when a branch changes app code
with no changeset alongside it. Docs-only, `.github/`-only, or
`.changeset/`-only diffs are exempt.

**`deploy.yml`'s image is tagged with the version, not just `latest` and the
commit SHA** — `ghcr.io/.../vestigian:v0.2.0` alongside the two it already
carried, read from `package.json` at build time via `jq`, so a specific
released version can be pulled or rolled back to by tag rather than only by
remembering a SHA.
