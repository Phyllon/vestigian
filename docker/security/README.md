# Security layer

CrowdSec reads the application's structured logs, decides, and a bouncer
enforces. This directory holds the detection half; the enforcement half and the
origin firewall are deployment steps that cannot live in this repo.

## Why the application's logs and not Traefik's

They carry the matched route pattern and an `audit` vocabulary — `auth.login`,
`auth.register`, `ratelimit.blocked` — so a scenario can say "repeated login
refusals" rather than "repeated 401s on a path that looks like login". Traefik's
access log is configured as a second source because it sees what the app never
does: TLS errors, malformed HTTP, and anything refused before routing.

This only became possible when the access log started carrying `ip`. Before
that no line here could be attributed to anyone, and a detector with no source
address cannot produce a decision.

## What is here

| File                    |                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `acquis.yaml`           | Docker log source for the app container, plus Traefik's access log                                                     |
| `parsers/vestigia.yaml` | Pino JSON → `evt.Meta.source_ip` and the fields scenarios filter on                                                    |
| `scenarios/*.yaml`      | One file per scenario — `cscli` registers local items per file, so a multi-document file silently loads only the first |

Verify any change with `cscli explain`, which shows the whole chain:

```bash
docker exec vestigia-dev-crowdsec-1 \
  cscli explain --file /tmp/line.json --type vestigia -o human
```

A correct result shows `vestigia/access-log` green in `s01-parse`,
`geoip-enrich` green in `s02-enrich` (which only happens if `source_ip` was
extracted), and the intended scenario green at the bottom. An ordinary
`{"msg":"request","status":200}` line must match **no** scenario — that is the
false-positive check, and it is the one worth re-running after every edit.

**Known limitation:** Pino writes `time` as epoch milliseconds and nothing sets
`evt.StrTime`, so `cscli explain` warns about time-machine mode. Live detection
is unaffected — it uses ingestion time — but replaying an old log file will not
reconstruct the original timing.

## Enforcement — not done by any of the above

A decision does nothing until a bouncer reads it. `cscli decisions list` will
show bans that nothing is applying.

**The right place is the Bunny edge**, so blocked traffic never reaches the box.
That matters more than it sounds: everything on this machine — CrowdSec,
Traefik's limiter, the Valkey limits — runs _after_ the request has arrived and
paid for a TCP connection and a TLS handshake. Hetzner's included DDoS
protection covers L3/L4 and explicitly does not cover L7 HTTP floods, so
absorbing those at the edge is the only thing that actually works.

CrowdSec has no first-party Bunny bouncer. Options, in order of preference:

1. **A small custom bouncer** driving Bunny's IP-blocklist API from the LAPI
   decision stream. Roughly a hundred lines; the shape is the same as the
   Cloudflare worker bouncer.
2. **The Traefik plugin bouncer** (Yaegi, no sidecar). Needs Traefik _static_
   config, which Dokploy owns — editable through its Traefik file-system UI, not
   from this repo. Blocks at the proxy, after TLS.
3. **The firewall bouncer** on nftables. Cheapest on-box option because it drops
   before the TLS handshake, but it sees Bunny edge addresses unless the origin
   passes the real IP, so it is a blunt instrument here.

## The origin firewall — do this first

Everything above assumes `x-real-ip` is trustworthy, and it is trustworthy only
while the origin refuses connections that did not come from Bunny.
`NUXT_BEHIND_TRUSTED_PROXY=true` without this rule is **worse than leaving it
false**: it takes an attacker-supplied header as identity, so anyone who finds
the Hetzner address gets a fresh rate-limit bucket per request and every policy
in `RATE_LIMITS` stops existing.

Hetzner Cloud Firewall, inbound:

- `80`, `443` — Bunny edge ranges only (published via their API)
- `22` — your address only
- everything else — denied

Verify from a host outside the allowlist:

```bash
curl -m 5 https://<origin-ip>/api/health   # must time out, not answer
```

That test is what makes every other control in this directory real.
