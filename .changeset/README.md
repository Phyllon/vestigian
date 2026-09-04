# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for
semantic versioning — deliberately chosen over Conventional Commits-driven
tools (`semantic-release`, `standard-version`) because this repo's own
`commit-msg` hook (`scripts/verify-commit-msg.ts`) protects a freeform,
lowercase, imperative commit style with no type prefix, not a
`feat:`/`fix:` convention. A changeset is a small file, independent of the
commit message, that says what changed and how it should bump the version.

## Adding a changeset

Whenever a change should move the version number — a new feature, a bug
fix, a breaking change to a documented API or behaviour — add one before it
lands on `main`:

```bash
pnpm changeset
```

This asks which bump (major/minor/patch) and for a short summary, then
writes a markdown file under `.changeset/`. Commit that file alongside your
change, in whatever commit you'd normally make — no special commit message
is required.

**What warrants a changeset, given `package.json`'s `private: true`** — this
app is never published to a registry, so "bump" here means "the deployed
version of the running service changed in a way worth recording," not a
package consumers pin to. As a rule of thumb:

- **patch** — a bug fix, a dependency bump, a security hardening change, a
  content/data-import change.
- **minor** — a new feature or endpoint, a backwards-compatible behaviour
  change.
- **major** — a breaking change to a public contract: the `/api/data/*`
  reuse feed shape, the OpenAPI-documented request/response shape of an
  existing route, a migration that is not purely additive.

A change with no user-facing or API-facing effect (a comment, a docstring,
CI config, this README) needs no changeset at all.

## How the version actually moves

See "Versioning & releases" in `CLAUDE.md` for the full mechanism. In short:
`.github/workflows/release.yml` bumps `package.json` and `CHANGELOG.md`
directly on `main` whenever pending changesets exist, tags the commit, and
cuts a GitHub Release — no separate "Version Packages" PR step, since this
project pushes directly to `main` rather than merging release PRs. A
`pull_request` workflow checks that a branch touching app code carries a
changeset, as a secondary safety net for anyone working from a branch.
