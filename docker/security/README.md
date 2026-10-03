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

| File                     |                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `acquis.yaml`            | Docker log source for the app container, plus Traefik's access log                                                     |
| `parsers/vestigian.yaml` | Pino JSON → `evt.Meta.source_ip` and the fields scenarios filter on                                                    |
| `scenarios/*.yaml`       | One file per scenario — `cscli` registers local items per file, so a multi-document file silently loads only the first |

Verify any change with `cscli explain`, which shows the whole chain:

```bash
docker exec vestigian-dev-crowdsec-1 \
  cscli explain --file /tmp/line.json --type vestigian -o human
```

A correct result shows `vestigian/access-log` green in `s01-parse`,
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
paid for a TCP connection and a TLS handshake. A VPS provider's DDoS
protection works at L3/L4 and does not absorb L7 HTTP floods, so absorbing
those at the edge is the only thing that actually works.

CrowdSec has no first-party Bunny bouncer. Options, in order of preference:

1. **A small custom bouncer** driving Bunny's Edge Rule API from the LAPI
   decision stream. **Built** — `docker/security/bunny-bouncer/`, wired into
   `docker/compose.prod.yml` as its own service. Polls the LAPI decision
   stream and mirrors the current IP-scope ban list onto one Bunny Edge Rule
   (`RemoteIP` trigger, `BlockRequest` action) rather than one rule per IP.
   The exact Bunny enum values it sends (`ActionType`, trigger `Type`,
   `PatternMatchingType`) come from Bunny's API reference, not from a request
   against a real account — there is no Bunny account to verify against from
   a dev environment. **Confirm it actually blocks** before relying on it: the
   test is in the "5. CrowdSec-Bouncer" step of
   `.plans/runbook_prod.deployment.md`. Needs `CROWDSEC_BUNNY_BOUNCER_KEY`
   (register with `cscli bouncers add bunny`, or let the `BOUNCER_KEY_bunny`
   env var on the `crowdsec` service pre-register it), `BUNNY_API_KEY`, and
   `BUNNY_SITE_PULL_ZONE_ID` — the pull zone in front of `SITE_HOST`
   specifically, not the images zone.
2. **The Traefik plugin bouncer** (Yaegi, no sidecar). Needs Traefik _static_
   config, which Dokploy owns — editable through its Traefik file-system UI, not
   from this repo. Blocks at the proxy, after TLS. Shelved in favour of option 1,
   which blocks before the request reaches the box at all — not run alongside it.
3. **The firewall bouncer** on nftables. Cheapest on-box option because it drops
   before the TLS handshake, but it sees Bunny edge addresses unless the origin
   passes the real IP, so it is a blunt instrument here.

Whichever bouncer runs, it is enforcement of last resort, not the primary
control — the per-IP limits in `server/utils/ratelimit.ts` already apply to
every request regardless of whether CrowdSec has flagged anyone, and fail open
the same way this bouncer does on a Bunny or LAPI outage.

## The origin firewall — do this first

Everything above assumes `x-real-ip` is trustworthy, and it is trustworthy only
while the origin refuses connections that did not come from Bunny.
`NUXT_BEHIND_TRUSTED_PROXY=true` without this rule is **worse than leaving it
false**: it takes an attacker-supplied header as identity, so anyone who finds
the origin address gets a fresh rate-limit bucket per request and every policy
in `RATE_LIMITS` stops existing.

As deployed on the Netcup VPS, the lock is a **secret request header, not an IP
allowlist**: Bunny's edge sets `X-Origin-Key` (an Edge Rule), and both app
routers in `docker/compose.prod.yml` require it, so a request that reaches
Traefik without it gets a 404 (`documents/runbook_prod.deployment.md` §9). The
host firewall is `ufw` with `ufw-docker` and the self-healing Traefik route rule
(§4 and §13); SSH is the only other open port.

Verify from a host that is not Bunny:

```bash
curl -sk -m 5 -o /dev/null -w '%{http_code}\n' -H 'Host: <domain>' https://<origin-ip>/api/health   # must print 404
```

That test is what makes every other control in this directory real.
