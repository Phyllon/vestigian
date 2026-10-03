import { Dashboard, STEPS, ratio } from './helpers'

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
        description: 'Detection only: nothing applies these decisions until a bouncer exists.',
      },
    )
    .build()
