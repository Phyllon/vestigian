---
paths:
  - 'server/api/**'
  - 'server/utils/openapi.ts'
---

## OpenAPI

**Reach the interactive UI at `http://localhost:3000/_scalar` while `pnpm dev` is running** — confirmed live (200 response), not assumed from Nitro's docs. That's Nitro's own default route for `nitro.openAPI.ui.scalar`, not something this project chose or configured a path for; the raw merged document is `/api/openapi.json`. Both 404 in production — see below.

Every route under `server/api/` declares `defineRouteMeta({ openAPI: {...} })`
for `tags`, `summary` and `description` — and only those three. **`defineRouteMeta`
is a build-time macro, not a runtime call**: its argument is parsed as an AST
(`nitropack/dist/rollup/index.mjs`'s `astToObject`) and only object/array
literals of literals survive. A function call — `paramsFromSchema(schema)` — or
a bare reference to an imported constant returns `undefined` there, silently,
with no build error. `tags`/`summary`/`description` are written as string
literals and come through; `parameters`, `requestBody`, `responses` and
`security` cannot be, since they need to be derived from the same zod schema a
handler actually validates against — so they do not live in `defineRouteMeta`
at all.

Instead, `server/api/openapi.json.get.ts` fetches Nitro's own auto-generated
document (moved to the internal path `/_nitro-base-openapi.json` via
`nitro.openAPI.route` in `nuxt.config.ts` specifically so nothing collides with
this route) and merges in `parameters`/`requestBody`/`responses`/`security` by
path and method, built from each route's real, already-`export`ed zod schema
via `zodToJsonSchema` (`server/utils/openapi.ts`). One schema, not two — a route
whose validation changes and whose documentation does not is worse than no
documentation.

Nitro's two bundled UIs (`/_scalar`, `/_swagger`) both load their renderer
from `cdn.jsdelivr.net` — the exact third-party runtime request self-hosted
fonts, self-hosted glyphs and ALTCHA-over-Turnstile all exist to avoid — so
only one is on, and only in development. `nuxt.config.ts`'s
`nitro.openAPI.ui` is `{ scalar: !isProduction, swagger: false }`: Scalar is
the nicer of the two, Swagger stays off outright, and `!isProduction` gates
the CSP too — `script-src`/`style-src`/`font-src`/`connect-src` allowlist
`cdn.jsdelivr.net` only when `!isProduction`, or the policy here would refuse
Scalar's own bundle silently, the same way the missing nonce token once did.
Safe to loosen for development only: `/_scalar` 404s in production regardless
of the CSP, via the same `nitro.openAPI.production` flag below, so the wider
CSP never ships. `/api/openapi.json` is same-origin JSON either way; paste it
into Insomnia, Postman or scalar.com's own hosted reference for a production
deployment, which serves no UI bundle of its own at all.

**Dev only — 404s in production.** A machine-readable map of every route,
parameter and response shape is a development convenience, not something to
leave reachable on the public internet, even though each endpoint underneath
still enforces its own auth guard and rate limit regardless of whether its
shape is documented anywhere. Two independent guards: `nitro.openAPI.production`
is `false` in production, so Nitro's own base document
(`/_nitro-base-openapi.json`) stops being generated at all; and
`server/api/openapi.json.get.ts` refuses outright on `!import.meta.dev` before
it ever fetches that base document, rather than relying on the fetch failing
to fail this route indirectly.
