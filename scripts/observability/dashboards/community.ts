import { Dashboard, STEPS } from './helpers'

/**
 * The people and the work queue. Everything from `atlas_*` is an aggregate
 * count taken on scrape (`server/utils/catalogue-metrics.ts`) — no row, name or
 * address is ever in these series.
 */
export const buildCommunity = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-community',
    title: 'Vestigian — community & moderation',
    description:
      'Contribution flow, the moderation backlog, accounts and trust, photographs and mail.',
    tags: ['community'],
    from: 'now-7d',
  })
    .row('Moderation backlog')
    .stat('Revisions waiting', 'atlas_revisions{status="pending"}', {
      graph: true,
      thresholds: STEPS.higherIsWorse(10, 50),
    })
    .stat('Oldest revision waiting', 'atlas_revisions_oldest_pending_seconds', {
      unit: 's',
      thresholds: STEPS.higherIsWorse(86_400, 259_200),
      description:
        'A contributor is waiting on this. Over three days is a moderator-capacity problem.',
    })
    .stat('Photographs waiting', 'atlas_images{status="pending"}', {
      thresholds: STEPS.higherIsWorse(25, 100),
    })
    .stat('Oldest photograph waiting', 'atlas_images_oldest_pending_seconds', {
      unit: 's',
      thresholds: STEPS.higherIsWorse(86_400, 259_200),
    })
    .stat('Tracings waiting', 'atlas_tracings{status="pending"}', {
      thresholds: STEPS.higherIsWorse(10, 50),
    })
    .stat(
      'Approval rate (7d)',
      'sum(increase(moderation_actions_total{action="approved"}[7d])) / clamp_min(sum(increase(moderation_actions_total{action=~"approved|rejected"}[7d])), 1)',
      { unit: 'percentunit', min: 0, max: 1, graph: false },
    )
    .timeseries('Queue length over time', [
      { expr: 'atlas_revisions{status="pending"}', legend: 'revisions' },
      { expr: 'atlas_images{status="pending"}', legend: 'photographs' },
      { expr: 'atlas_tracings{status="pending"}', legend: 'tracings' },
    ])
    .timeseries(
      'Age of the oldest item waiting',
      [
        { expr: 'atlas_revisions_oldest_pending_seconds', legend: 'revision' },
        { expr: 'atlas_images_oldest_pending_seconds', legend: 'photograph' },
      ],
      { unit: 's' },
    )
    .timeseries(
      'Moderator actions',
      [
        {
          expr: 'sum by (action) (increase(moderation_actions_total[$__rate_interval]))',
          legend: '{{action}}',
        },
      ],
      { stacked: true },
    )
    .timeseries(
      'Decisions: approved vs rejected',
      [
        {
          expr: 'sum(increase(moderation_actions_total{action="approved"}[$__rate_interval]))',
          legend: 'approved',
        },
        {
          expr: 'sum(increase(moderation_actions_total{action="rejected"}[$__rate_interval]))',
          legend: 'rejected',
        },
      ],
      { seriesColours: { approved: 'green', rejected: 'red' } },
    )
    .row('Contributions')
    .timeseries(
      'Revisions submitted',
      [
        {
          expr: 'sum by (kind, status) (increase(contribution_revisions_total[$__rate_interval]))',
          legend: '{{kind}} · {{status}}',
        },
      ],
      {
        stacked: true,
        description: '`approved` published immediately (trusted); `pending` went to the queue.',
      },
    )
    .stat(
      'Published without review (7d)',
      'sum(increase(contribution_revisions_total{status="approved"}[7d])) / clamp_min(sum(increase(contribution_revisions_total[7d])), 1)',
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        graph: false,
        description:
          'The share trust is earning. Drift sampling looks at a fraction of these after the fact.',
        width: 6,
      },
    )
    .stat('Revisions (7d)', 'sum(increase(contribution_revisions_total[7d]))', {
      graph: false,
      width: 6,
    })
    .timeseries(
      'Revisions by status (all time)',
      [{ expr: 'atlas_revisions', legend: '{{status}}' }],
      { stacked: true },
    )
    .timeseries(
      'Photograph uploads',
      [
        {
          expr: 'sum by (outcome) (increase(upload_events_total[$__rate_interval]))',
          legend: '{{outcome}}',
        },
      ],
      {
        stacked: true,
        description:
          'Refusals are the uploader hitting a rule: format, size, licence, or a corrupt file.',
      },
    )
    .stat('Endorsements', 'atlas_endorsements', { graph: true, width: 6 })
    .row('Accounts and trust')
    .stat('Accounts', 'atlas_accounts{state="total"}', { width: 4 })
    .stat(
      'Email verified',
      'atlas_accounts{state="verified"} / clamp_min(atlas_accounts{state="total"}, 1)',
      { unit: 'percentunit', min: 0, max: 1, width: 4, graph: false },
    )
    .stat('Trusted (publish directly)', 'atlas_accounts{state="trusted"}', { width: 4 })
    .stat(
      'Two-factor adoption',
      'atlas_accounts{state="two_factor"} / clamp_min(atlas_accounts{state="total"}, 1)',
      { unit: 'percentunit', min: 0, max: 1, width: 4, graph: false },
    )
    .stat('Blocked accounts', 'atlas_accounts{state="banned"}', { width: 4, graph: false })
    .stat('Trust revoked', 'atlas_accounts{state="trust_revoked"}', { width: 4, graph: false })
    .timeseries('Accounts over time', [
      { expr: 'atlas_accounts{state="total"}', legend: 'total' },
      { expr: 'atlas_accounts{state="verified"}', legend: 'verified' },
      { expr: 'atlas_accounts{state="trusted"}', legend: 'trusted' },
    ])
    .timeseries('Active accounts', [
      { expr: 'atlas_accounts{state="active_1d"}', legend: 'last day' },
      { expr: 'atlas_accounts{state="active_7d"}', legend: 'last 7 days' },
      { expr: 'atlas_accounts{state="active_30d"}', legend: 'last 30 days' },
    ])
    .timeseries('Sign-ups and verification', [
      {
        expr: 'sum(increase(auth_events_total{event="register",outcome="accepted"}[$__rate_interval]))',
        legend: 'registered',
      },
      {
        expr: 'sum(increase(auth_events_total{event="email-verify",outcome="accepted"}[$__rate_interval]))',
        legend: 'verified',
      },
      {
        expr: 'sum(increase(auth_events_total{event="login",outcome="accepted"}[$__rate_interval]))',
        legend: 'signed in',
      },
    ])
    .piechart('Accounts by role', [{ expr: 'atlas_accounts_by_role', legend: '{{role}}' }], {
      width: 6,
    })
    .row('Photographs and licences')
    .piechart(
      'Published photographs by licence',
      [{ expr: 'atlas_images_published_by_licence', legend: '{{licence}}' }],
      { width: 8 },
    )
    .piechart('Photographs by status', [{ expr: 'atlas_images', legend: '{{status}}' }], {
      width: 8,
    })
    .stat('Published photographs', 'atlas_images{status="approved"}', { graph: true, width: 8 })
    .row('Mail')
    .timeseries(
      'Mail by purpose and outcome',
      [
        {
          expr: 'sum by (purpose, outcome) (increase(mail_deliveries_total[$__rate_interval]))',
          legend: '{{purpose}} · {{outcome}}',
        },
      ],
      { stacked: true },
    )
    .stat('Mail failures (7d)', 'sum(increase(mail_deliveries_total{outcome="failed"}[7d]))', {
      thresholds: STEPS.higherIsWorse(1, 10),
      graph: false,
      description:
        'A failed verification or reset mail is a person who cannot get in. Delivery never throws, so this is the only signal.',
      width: 6,
    })
    .stat(
      'Mail not configured (7d)',
      'sum(increase(mail_deliveries_total{outcome="unconfigured"}[7d]))',
      { graph: false, thresholds: STEPS.higherIsWorse(1, 1), width: 6 },
    )
    .build()
