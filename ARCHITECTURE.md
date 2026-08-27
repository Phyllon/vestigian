# Rate limiting
two independent layers, and they're deliberately different in kind.

App layer (server/utils/ratelimit.ts) — per-endpoint, per-IP counters in Valkey, applied by explicit enforceRateLimit(event, name) calls:

policy - limit	- covers
login	8 / 15 min	login, verify, reset-password
register	4 / hour	signup
passwordReset	5 / hour	forgot-password (newly split off register)
challenge	20 / hour	ALTCHA challenge issuing (new)
contribute	30 / hour	contributions
upload	20 / hour	image upload
search	120 / min	search, geojson feed
record	300 / min	site/tracing records + revisions (new)
expensive	30 / min	sitemap.xml, /api/ready (new)
enrichment	60 / min	Wikipedia enrichment
tiles	1200 / min	vector tiles
Proxy layer (docker/traefik/dynamic.yml) — one coarse app-rate-limit middleware, 100/s average with 200 burst, attached to the app router.

They're not redundant. The app layer is precise but lives in Valkey and fails open by design — a cache outage silently removes every limit above. The Traefik one is held in the proxy's own memory, costs nothing, and survives both a Valkey outage and an app restart. It catches floods; the app layer catches abuse of specific endpoints.

Both layers depend on the same identity, and that identity is only as good as the network. resolveForwardedIdentifier now believes cf-connecting-ip only when NUXT_BEHIND_TRUSTED_PROXY is set, and Traefik's sourceCriterion uses the same header. That's correct while the origin is reachable only through Cloudflare — anyone who can talk to Traefik directly can forge it for both layers at once. That's a firewall job, noted in the docblock.

There's also a third thing that isn't rate limiting but sits alongside it: robots.txt now asks 16 named model-training crawlers to stay out. That binds only crawlers that read it — it's a request, not a control.
