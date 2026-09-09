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
`.github/workflows/release.yml` no longer runs on every push to `main` —
that raced a human's own push and diverged the branch. It now runs only on
`workflow_dispatch`: a maintainer opens the Actions tab, runs **release**,
and picks a `bump` (patch/minor/major) from a dropdown. The workflow then
applies pending changesets — plus one it writes itself recording the chosen
bump, so a release is never _less_ than what was picked, though a pending
changeset already at a higher severity still wins — bumps `package.json`,
rewrites `CHANGELOG.md`, commits, tags `vX.Y.Z`, and cuts a GitHub Release.

To cut a release locally instead (e.g. the workflow is unavailable):

```bash
pnpm changeset:version   # bumps package.json, rewrites CHANGELOG.md, consumes .changeset/*.md
git add package.json CHANGELOG.md .changeset
git commit -m "bump version to vX.Y.Z"
git tag vX.Y.Z && git push origin main --follow-tags
```

A `pull_request` workflow still checks that a branch touching app code
carries a changeset, as a safety net for anyone working from a branch.
