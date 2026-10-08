---
paths:
  - 'docker/observability/**'
  - 'server/plugins/observability.ts'
  - 'server/utils/logger.ts'
  - 'server/utils/metrics.ts'
  - 'server/utils/tracing.ts'
---

## Observability — what the silence used to hide

Six containers: Grafana, Loki, Tempo, Prometheus, Alertmanager and **Alloy**,
which carries logs, traces and metrics in one agent. Vector was the initial
choice and carries no traces; Alloy also has built-in
`prometheus.exporter.{unix,cadvisor,postgres,redis}`, which is four exporter
containers not run. Promtail, the other candidate, reached EOL in March 2026.

**Everything is on local disk.** R2 was considered and refused: Loki and Tempo
write often enough for Class A operations to be a real line item, and telemetry
is diagnostic rather than a record of record. Retention is 15d metrics, 30d
logs, 7d traces — under 20 GB of the 240 GB disk, and roughly 1.6 GB of RAM.

**Grafana has no Traefik router and binds to loopback.** It holds request logs
containing visitor IPs and the moderation trail. Reach it with
`ssh -L 3001:localhost:3001 <vps>`.

### Why the point was never the dashboards

The app fails open in eight places, every one of them formerly silent. The
worst is `enforceRateLimit`: a Valkey outage removes **every** policy in
`RATE_LIMITS`, including the four signups an hour that `register.post.ts` names
as its defence against account farming, and nothing recorded it.
`rate_limit_decisions_total{outcome="failed_open"}` and the
`RateLimiterFailingOpen` alert exist for that one case. `ready` now counts the
cache too, so the same outage takes the container out of the load balancer
instead of reporting healthy.

### Three traps, all found by running it

- **Sampling must key on `url.path`, not the span name.** Sampling happens at
  span creation, which in Nitro is _before_ routing — `matchedRoute` is
  undefined there, so every span is named `unmatched` at that moment. Keying on
  the name matched nothing and traced every tile at full rate. The span is
  renamed to the route pattern in `beforeResponse`.
- **Child spans need the parent passed explicitly** (`withSpan({ parent })`).
  The server span opens in `request` and closes in `beforeResponse` — two
  callbacks, so there is no call stack to wrap and nothing ambient to inherit.
  Without it, sixty tile requests produced sixty orphaned `postgis.render_tile`
  root traces that also escaped sampling.
- **Never label a metric with an identifier.** Route _patterns_ only:
  `/api/sites/:id`, never `/api/sites/61272`. Sixty thousand sites would
  otherwise be sixty thousand series.

Two PromQL habits the alerts depend on: `or vector(0)` on a division's
numerator, because an empty vector makes an alert unable to fire in exactly the
case it exists for; and excluding read-only filesystems from the disk alert,
since a read-only image mount reports 0% free by definition and fires forever.

### Tracing is manual, deliberately

No `auto-instrumentations-node`. ESM auto-instrumentation needs a loader hook
before any instrumented module loads (`node --import`), but the runtime image
ships only `.output`, so a root-level bootstrap has no `node_modules` to resolve
against. `postgres.js` has no OTel instrumentation package regardless — `pg`
does, and this project does not use `pg`. Spans exist only where `withSpan` is
called, which is the cost; no loader hook and no Dockerfile change is the gain.

**Pino ships no transport in production.** Its transports run in a worker
thread, which Rollup cannot bundle — Nitro tree-shakes the target out and the
process dies at startup looking for a module that was never emitted. Plain JSON
to stdout is what Docker's json-file driver and Alloy want anyway. `pino-pretty`
is guarded behind `import.meta.dev`, where nothing is bundled.

### Reaching the logs

**Development**: `pnpm dev` pretty-prints to the terminal, and that stays the
fast loop. `pnpm stack:observability` adds Grafana on `localhost:3001` when a
dashboard or alert rule needs testing. Traces and metrics work fully; **the
app's own logs do not reach Loki**, because `nuxt dev` runs on the host and
Alloy discovers containers. Container logs do arrive.

**Production**: Pino → stdout → json-file → Alloy → Loki → Grafana over the SSH
tunnel. `docker compose logs -f` still works and is the fallback for when Loki
is itself the broken thing.

### Unresolved

- Nothing mounts `docker/traefik/`, so `deny-external@file` — which keeps
  `/api/metrics` off the public router — rests on the same unconfirmed
  mechanism as `app-rate-limit@file`. Until that is checked on the box, treat
  `/api/metrics` as reachable; it leaks route names and volumes, not data.
- Request logs contain IP addresses. 30 days on an EU box is the position, and
  `REDACTED_FIELDS` in `server/utils/logger.ts` is the rest of it.

### Dashboards

Eight, in one Grafana folder, linked from each other by a shared `vestigian` tag
(dropdown top-left). **Seven are generated** by `pnpm dashboards:build` from
`scripts/observability/dashboards/*.ts`; they are provisioned read-only, so edit
the generator and commit both. `overview.json` predates it and stays hand-written.
The build formats its output with the repo's Prettier config so a rebuild is
never a formatting diff.

| Dashboard              | uid                        | Answers                                                                                                                                                                            |
| ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| overview               | `vestigian-overview`       | Is the app alive: rate, latency, 5xx, rate-limit decisions.                                                                                                                        |
| infrastructure         | `vestigian-infrastructure` | Host, per container, Postgres, Valkey, Node process — all already scraped by Alloy, previously shown nowhere.                                                                      |
| map & tiles            | `vestigian-map`            | Tile cache/render/size **by zoom**, clustered vs every-site mode, search, featured, photographs, and browser-reported timings.                                                     |
| community & moderation | `vestigian-community`      | Backlog and its age, contribution flow, trust funnel, accounts, uploads, licences, mail.                                                                                           |
| security & abuse       | `vestigian-security`       | Fail-open first, CrowdSec → Bunny enforcement, sign-in outcomes and lockouts, rate limits and scraping pressure, refused requests, step-up, bans, audit and CrowdSec/bouncer logs. |
| logs & traces          | `vestigian-logs`           | Loki (levels, errors, slow requests) and Tempo (slowest, failed, `postgis.render_tile`). Fields like `route`/`status` are JSON, so queries `\| json`.                              |
| SLOs                   | `vestigian-slo`            | Availability, tile latency, API latency; budget remaining and burn rate over **14 d** (Prometheus keeps 15).                                                                       |
| data & import health   | `vestigian-data`           | Catalogue size and completeness, import freshness (`import_runs`), enrichment/translation upstreams.                                                                               |

**The security board's CrowdSec and Bunny row** (added 2026-10-08) draws on three
sources, all verified against real output rather than assumed:

- **CrowdSec's own metrics**, scraped by Alloy from `crowdsec:6060` (job
  `crowdsec`, address from `CROWDSEC_ADDR` in both compose files). Useful ones,
  confirmed by triggering a ban in a throwaway v1.6.11 container:
  `cs_active_decisions{action,origin,reason}` (gauge, only exists once a
  decision does) and `cs_alerts{reason}`. IP addresses are never labels.
- **The bouncer's logs**, now one JSON object per line (`level`, `msg`, plus
  fields) so `| json` works; the earlier multi-line object printing reached Loki
  as unparseable fragments. Its `reconciled with Bunny` line, emitted at startup
  and every 10 minutes, is both the heartbeat (**Bouncer heartbeat** is zero when
  it stops) and the source of the **Entries on Bunny (cap 100)** gauge. The LogQL
  queries were run against a real Loki 3.4.2 fed real bouncer output.
  `or vector(0)` needs the `sum(...)` inside it, or a labelled series and the
  empty one both come back.
- **The app's rate-limit counters**, for lockouts (login, second factor, admin
  step-up) and scraping pressure (`record`, `recordDaily`, `search`, `tiles`,
  `enrichment`, `expensive`).

**Alerts** (`docker/observability/rules/fake/security.yml`, Loki ruler; and
`CrowdSecDown` in `alerts.yml`): `BunnyBouncerSilent` (no heartbeat in 30 min,
critical — also fires while the bouncer is deliberately stopped, on purpose),
`BunnyBouncerFailing` (3+ failed cycles in 15 min), `BunnyBlockedListFull` and
`BunnyBlockedListNearlyFull` (90+ of Bunny's 100 slots). All loaded into a real
Loki 3.4.2 with the repo's `loki.yml` and each expression evaluated in three
states (no logs, healthy, failing). **Every "nothing happened" rule must wrap its
count as `(sum(count_over_time(...)) or vector(0)) == 0`**: with no matching line
the plain form returns no series and the alert can never fire. That bug was in
`backup.yml`'s `BackupNotRunning`, `BackupNotLeavingTheMachine` and
`BackupRepositoryUnverified` until 2026-10-08, i.e. they were silent in precisely
the case they exist for.

**Verification and its limit.** All 235 PromQL expressions parse
(`@prometheus-io/lezer-promql`) and every app-side metric name was checked
against a live `/api/metrics`. Exporter metric names (node, cAdvisor, postgres,
redis) are from the exporters' documented names, **not** from a running
Prometheus: Docker was not available when this was written, so no panel has
been seen drawing. LogQL and TraceQL were reviewed by hand only. First thing to
do with `pnpm stack:observability` is open each dashboard and look for "No data"
panels — most likely suspects are the cAdvisor `name` label and Alloy's postgres
collectors (`pg_stat_user_tables_*`).

### New metrics

Event counters/histograms (`server/utils/metrics.ts`): `tile_requests_total` now
carries `zoom` and `mode` (`clustered`/`every`); `tile_response_bytes`,
`search_requests_total{source,outcome}`, `featured_requests_total`,
`image_requests_total{preset,outcome}`, `upload_events_total{outcome}`, plus
`auth_events_total` events `step-up`, `password-reset-request`, `password-reset`,
`email-verify`, `email-change`. Cardinality is bounded (zoom 0–18, fixed
vocabularies); no query text, id or coordinate is ever a label.

**Catalogue gauges** (`server/utils/catalogue-metrics.ts`, `atlas_*`): computed
on scrape from one cached snapshot (30 s), **counts and ages only** — sites by
status/category/missing gap, tracings, photographs by status/licence, accounts by
state/role (incl. two-factor and 1/7/30-day active), revisions and the age of the
oldest pending one, endorsements, last import run per source. Written with Drizzle;
note that `${table.column}` renders **unqualified** in a single-table select, so
a correlated subquery must spell its qualifiers out (this once made every site
look unphotographed — 61,273 instead of 49,964).

### Real-user timings and why they are the one piece of client telemetry

`app/plugins/web-vitals.client.ts` (production only) loads `web-vitals`
(Apache-2.0, Google Chrome team — licence read from the installed package) when
idle and reports LCP, FCP, TTFB, INP, CLS plus the app's own `map-load` /
`map-idle` (`MapCanvas`) to `POST /api/vitals` by `sendBeacon`. Skipped under
**Do Not Track and Global Privacy Control**. The server validates against
`shared/utils/web-vitals.ts`, **rates the value itself** (never trusts a
client-sent rating), folds it into histograms labelled only by name, device
class and rating, and stores nothing else — `204` always. For this route the access log carries **no
IP address or user agent** and the rate limit counts a one-way pseudonym, not the
address (details and tests: `.claude/rules/gdpr-legal.md`). Disclosed on the privacy page
(`privacy.performanceHeading`). **Open legal question:** whether reading the
Performance API counts as accessing the terminal under §25 TDDDG is contested;
this assumes no, and relies on the aggregate-only design and the DNT/GPC opt-out.
Have it checked before relying on it. Abuse: a flood from many addresses can
skew the histograms (per-IP limit only); the numbers are advisory, not security.

### SLOs and alerts

`docker/observability/slo-rules.yml` (mounted in both compose files, listed in
`prometheus.yml`): recording rules for error and slow ratios at 5 m / 30 m / 1 h /
6 h and four multi-window burn-rate alerts (availability 99.5%, tile latency 95%
within 250 ms), plus `ModerationBacklogStale` (a revision older than 3 days).
Objectives live in that file **and** `scripts/observability/dashboards/slo.ts` —
change both.
