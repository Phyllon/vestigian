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
