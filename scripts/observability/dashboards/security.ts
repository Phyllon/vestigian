import { Dashboard, LOKI, STEPS, ratio } from './helpers'

/**
 * Abuse and access. The rate limiter fails open by design, so the first panel
 * is the one that says whether any of the others can be believed.
 */
export const buildSecurity = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-security',
    title: 'Vestigian — security & abuse',
    description:
      'Sign-in outcomes, rate-limit decisions, refused requests, privileged actions and the audit trail.',
    tags: ['security'],
  })
    .row('Is protection actually on?')
    .stat(
      'Rate limiter FAILED OPEN (1h)',
      'sum(increase(rate_limit_decisions_total{outcome="failed_open"}[1h])) or vector(0)',
      {
        thresholds: STEPS.higherIsWorse(1, 1),
        graph: false,
        description: 'Non-zero: Valkey was unreachable and every limit was absent for that time.',
        width: 6,
      },
    )
    .stat('Valkey up', 'redis_up', {
      graph: false,
      thresholds: STEPS.lowerIsWorse(1, 1),
      min: 0,
      max: 1,
      width: 6,
    })
    .stat(
      'Requests refused (429), 1h',
      'sum(increase(http_requests_total{status="429"}[1h])) or vector(0)',
      { graph: false, width: 6 },
    )
    .stat(
      'Share of requests rate-limited',
      ratio(
        'sum(rate(rate_limit_decisions_total{outcome="blocked"}[$__rate_interval]))',
        'sum(rate(rate_limit_decisions_total[$__rate_interval]))',
      ),
      { unit: 'percentunit', min: 0, max: 1, width: 6 },
    )
    .row('Detection and edge enforcement (CrowdSec → Bunny)')
    .stat('CrowdSec reachable', 'max(up{job="crowdsec"}) or vector(0)', {
      graph: false,
      thresholds: STEPS.lowerIsWorse(1, 1),
      min: 0,
      max: 1,
      width: 4,
      description: 'Zero: Prometheus cannot scrape CrowdSec, so nothing below is current.',
    })
    .stat(
      'Bouncer heartbeat (30 min)',
      'sum(count_over_time({service="bunny-bouncer"} |= "reconciled with Bunny" [30m])) or vector(0)',
      {
        datasource: LOKI,
        graph: false,
        thresholds: STEPS.lowerIsWorse(1, 1),
        width: 4,
        description:
          'The bouncer reconciles with Bunny every 10 minutes and logs it. Zero: it is stopped or stuck, and bans are no longer reaching the edge.',
      },
    )
    .stat(
      'Entries on Bunny (cap 100)',
      'max(last_over_time({service="bunny-bouncer"} |= "reconciled with Bunny" | json | unwrap blockedOnBunny [30m]))',
      {
        datasource: LOKI,
        graph: true,
        min: 0,
        max: 100,
        thresholds: STEPS.higherIsWorse(70, 95),
        width: 4,
        description:
          'Bunny refuses the 101st blocked IP. Past the cap, bans are logged as not enforced at the edge.',
      },
    )
    .stat(
      'Standing local bans',
      'sum(cs_active_decisions{origin=~"crowdsec|cscli"}) or vector(0)',
      {
        graph: true,
        width: 4,
        description: 'Decisions this deployment made itself: the only ones mirrored to Bunny.',
      },
    )
    .stat(
      'Community decisions held',
      'sum(cs_active_decisions{origin!~"crowdsec|cscli"}) or vector(0)',
      {
        graph: false,
        width: 4,
        description: 'Downloaded from CrowdSec; deliberately not mirrored (Bunny holds 100).',
      },
    )
    .stat('Alerts raised (24h)', 'sum(increase(cs_alerts[24h])) or vector(0)', {
      graph: false,
      width: 4,
    })
    .timeseries(
      'Standing bans by origin',
      [
        {
          expr: 'sum by (origin, action) (cs_active_decisions)',
          legend: '{{origin}} · {{action}}',
        },
      ],
      {
        stacked: true,
        description: 'Falls as bans expire; a staircase up is an attack in progress.',
      },
    )
    .bargauge(
      'Alerts by scenario in range',
      [
        {
          expr: 'sort_desc(sum by (reason) (increase(cs_alerts[$__range])))',
          legend: '{{reason}}',
        },
      ],
      {
        min: 0,
        description:
          'Which detection fires: a local scenario (vestigian/…) or a hub one (Traefik, AppSec).',
      },
    )
    .lokiTimeseries(
      'What the bouncer did at the edge',
      [
        {
          expr: 'sum(count_over_time({service="bunny-bouncer"} |= "blocked at Bunny" [$__interval]))',
          legend: 'blocked',
        },
        {
          expr: 'sum(count_over_time({service="bunny-bouncer"} |= "unblocked at Bunny" [$__interval]))',
          legend: 'unblocked (ban expired)',
        },
        {
          expr: 'sum(count_over_time({service="bunny-bouncer"} |= "list is full" [$__interval]))',
          legend: 'list full, not enforced',
        },
        {
          expr: 'sum(count_over_time({service="bunny-bouncer"} |= "refused one address" [$__interval]))',
          legend: 'Bunny refused an address',
        },
        {
          expr: 'sum(count_over_time({service="bunny-bouncer"} |= "cycle failed" [$__interval]))',
          legend: 'cycle failed (Bunny/LAPI error)',
        },
      ],
      {
        seriesColours: {
          blocked: 'red',
          'unblocked (ban expired)': 'green',
          'list full, not enforced': 'orange',
          'Bunny refused an address': 'orange',
          'cycle failed (Bunny/LAPI error)': 'dark-red',
        },
      },
    )
    .row('Sign-in and accounts')
    .timeseries(
      'Sign-in outcomes',
      [
        {
          expr: 'sum by (outcome) (increase(auth_events_total{event="login"}[$__rate_interval]))',
          legend: '{{outcome}}',
        },
      ],
      {
        stacked: true,
        seriesColours: {
          accepted: 'green',
          rejected: 'orange',
          blocked: 'red',
          unverified: 'blue',
        },
      },
    )
    .timeseries(
      'Sign-in failure ratio',
      [
        {
          expr: ratio(
            'sum(increase(auth_events_total{event="login",outcome=~"rejected|blocked"}[$__rate_interval]))',
            'sum(increase(auth_events_total{event="login"}[$__rate_interval]))',
          ),
          legend: 'failed / attempts',
        },
      ],
      {
        unit: 'percentunit',
        max: 1,
        description:
          'A sustained jump with a flat attempt count is credential stuffing; a jump in attempts too is a brute-force run.',
      },
    )
    .timeseries(
      'Registrations',
      [
        {
          expr: 'sum(increase(auth_events_total{event="register",outcome="accepted"}[$__rate_interval]))',
          legend: 'accepted',
        },
        {
          expr: 'sum(increase(rate_limit_decisions_total{policy="register",outcome="blocked"}[$__rate_interval]))',
          legend: 'rate-limited',
        },
        {
          expr: 'sum(increase(rate_limit_decisions_total{policy="challenge",outcome="blocked"}[$__rate_interval]))',
          legend: 'challenge refused',
        },
      ],
      {
        description:
          'Four sign-ups an hour per address is the limit; ALTCHA + honeypot sit before it.',
      },
    )
    .timeseries(
      'Lockouts: people who hit a limit',
      [
        {
          expr: 'sum(increase(rate_limit_decisions_total{policy="login",outcome="blocked"}[$__rate_interval]))',
          legend: 'sign-in (8 per 15 min)',
        },
        {
          expr: 'sum(increase(rate_limit_decisions_total{policy="twoFactorVerify",outcome="blocked"}[$__rate_interval]))',
          legend: 'second factor',
        },
        {
          expr: 'sum(increase(rate_limit_decisions_total{policy="adminStepUp",outcome="blocked"}[$__rate_interval]))',
          legend: 'admin step-up',
        },
      ],
      {
        description:
          'Each is a 429 shown to someone. A real person mistyping looks like one or two; a run of them is a script.',
      },
    )
    .timeseries('Second factor and password recovery', [
      {
        expr: 'sum(increase(rate_limit_decisions_total{policy="twoFactorVerify",outcome="blocked"}[$__rate_interval]))',
        legend: '2FA attempts blocked',
      },
      {
        expr: 'sum(increase(auth_events_total{event="password-reset-request"}[$__rate_interval]))',
        legend: 'reset requested',
      },
      {
        expr: 'sum(increase(auth_events_total{event="password-reset"}[$__rate_interval]))',
        legend: 'password reset',
      },
      {
        expr: 'sum(increase(rate_limit_decisions_total{policy="passwordReset",outcome="blocked"}[$__rate_interval]))',
        legend: 'reset rate-limited',
      },
    ])
    .row('Rate limiting')
    .timeseries(
      'Decisions by policy',
      [
        {
          expr: 'sum by (policy, outcome) (rate(rate_limit_decisions_total[$__rate_interval]))',
          legend: '{{policy}} · {{outcome}}',
        },
      ],
      { unit: 'reqps' },
    )
    .timeseries(
      'Scraping pressure (blocked)',
      [
        {
          expr: 'sum by (policy) (increase(rate_limit_decisions_total{policy=~"record|recordDaily|search|tiles|enrichment|expensive",outcome="blocked"}[$__rate_interval]))',
          legend: '{{policy}}',
        },
      ],
      {
        stacked: true,
        description:
          'recordDaily is the cap that makes full-database enumeration take weeks; any hit there is somebody walking the ids.',
      },
    )
    .bargauge(
      'Blocked by policy in range',
      [
        {
          expr: 'sort_desc(sum by (policy) (increase(rate_limit_decisions_total{outcome="blocked"}[$__range])))',
          legend: '{{policy}}',
        },
      ],
      { min: 0, thresholds: STEPS.higherIsWorse(50, 500) },
    )
    .timeseries(
      'Refused and failed requests',
      [
        {
          expr: 'sum by (status) (rate(http_requests_total{status=~"401|403|404|429"}[$__rate_interval]))',
          legend: '{{status}}',
        },
      ],
      {
        unit: 'reqps',
        stacked: true,
        description: 'A 404 burst across `unmatched` is a scanner looking for admin panels.',
      },
    )
    .bargauge(
      'Where the 401 / 403 / 429 land',
      [
        {
          expr: 'topk(10, sum by (route) (increase(http_requests_total{status=~"401|403|429"}[$__range])))',
          legend: '{{route}}',
        },
      ],
      { min: 0 },
    )
    .row('Privileged actions')
    .timeseries(
      'Admin step-up confirmations',
      [
        {
          expr: 'sum by (outcome) (increase(auth_events_total{event="step-up"}[$__rate_interval]))',
          legend: '{{outcome}}',
        },
      ],
      {
        seriesColours: { accepted: 'green', rejected: 'red' },
        description: 'Rejected here is somebody holding an admin session without the password.',
      },
    )
    .timeseries(
      'Bans, role changes and session revocations',
      [
        {
          expr: 'sum by (action) (increase(moderation_actions_total{action=~"ban|unban|role|retract|sessions-revoked|trust|revert"}[$__rate_interval]))',
          legend: '{{action}}',
        },
      ],
      { stacked: true },
    )
    .stat('Blocked accounts', 'atlas_accounts{state="banned"}', { graph: true, width: 6 })
    .stat('Accounts with trust revoked', 'atlas_accounts{state="trust_revoked"}', {
      graph: true,
      width: 6,
    })
    .stat('Admins', 'atlas_accounts_by_role{role="admin"}', {
      graph: false,
      width: 6,
      description: 'Should only ever change when someone edits the database by hand.',
    })
    .stat('Moderators', 'atlas_accounts_by_role{role="moderator"}', { graph: false, width: 6 })
    .row('Audit trail and attack detection (logs)')
    .logs(
      'Audit events',
      '{service="app", audit!=""} | json | line_format "{{.audit}} · {{.msg}}"',
      { height: 9, description: 'Governance and authentication events, newest first.' },
    )
    .logs(
      'Refused requests (401, 403, 429)',
      '{service="app"} | json | status=~"401|403|429" | line_format "{{.status}} {{.method}} {{.route}} ({{.durationMs}} ms)"',
      { height: 9 },
    )
    .logs(
      'CrowdSec decisions and alerts',
      '{service=~"crowdsec.*"} |~ "(?i)decision|alert|ban|scenario"',
      {
        height: 8,
        description: 'Detection. Enforcement at the Bunny edge is the bouncer, in the next panel.',
      },
    )
    .logs(
      'Bunny bouncer',
      '{service="bunny-bouncer"} | json | line_format "{{.level}} {{.msg}} {{.ip}}{{.pattern}} {{.origin}} {{.scenario}} {{.duration}} {{.message}}"',
      {
        height: 9,
        description:
          'Every ban received and every IP added to or removed from the Bunny blocked list, with the reason when something is refused.',
      },
    )
    .build()
