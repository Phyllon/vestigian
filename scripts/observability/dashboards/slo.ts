import { Dashboard, STEPS } from './helpers'

/**
 * Service-level objectives, with the targets stated here and enforced by the
 * recording and burn-rate rules in `docker/observability/slo-rules.yml`.
 *
 * The window is 14 days, not the 28–30 a textbook SLO uses: Prometheus keeps 15
 * days of metrics (`.claude/rules/observability.md`), so a longer window would
 * silently be computed over less data than it claims.
 *
 * Objectives (a judgement — change them in both files):
 * - Availability: 99.5% of requests are not 5xx.
 * - Tile latency: 95% of tile responses finish within 250 ms.
 * - API latency:  95% of non-tile requests finish within 1 s.
 */
export const AVAILABILITY_TARGET = 0.995
export const TILE_LATENCY_TARGET = 0.95
export const API_LATENCY_TARGET = 0.95

const TILES = 'route="/api/tiles/:z/:x/:y"'
const NOT_TILES = 'route!~"/api/tiles/:z/:x/:y|/api/metrics|/api/health|/api/ready"'

const availability = (window: string): string =>
  `1 - (sum(increase(http_requests_total{status=~"5.."}[${window}])) or vector(0)) / clamp_min(sum(increase(http_requests_total[${window}])), 1)`

const withinSeconds = (selector: string, bucket: string, window: string): string =>
  `sum(increase(http_request_duration_seconds_bucket{${selector},le="${bucket}"}[${window}])) / clamp_min(sum(increase(http_request_duration_seconds_count{${selector}}[${window}])), 1)`

const budgetRemaining = (sli: string, target: number): string =>
  `1 - (1 - (${sli})) / ${(1 - target).toFixed(4)}`

export const buildSlo = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-slo',
    title: 'Vestigian — SLOs & error budget',
    description:
      'Availability and latency objectives over 14 days, error budget remaining and burn rate.',
    tags: ['slo'],
    from: 'now-14d',
  })
    .text(
      'Objectives',
      `**Availability** ${(AVAILABILITY_TARGET * 100).toFixed(1)}% of requests not 5xx · **Tile latency** ${(TILE_LATENCY_TARGET * 100).toFixed(0)}% within 250 ms · **API latency** ${(API_LATENCY_TARGET * 100).toFixed(0)}% within 1 s. Window: 14 days (Prometheus keeps 15). Budget = the share of requests allowed to miss the objective; "burn rate 1" spends it exactly over the window.`,
      { height: 3 },
    )
    .row('Availability')
    .stat('Availability (14d)', availability('14d'), {
      unit: 'percentunit',
      decimals: 3,
      min: 0.98,
      max: 1,
      thresholds: STEPS.lowerIsWorse(0.99, AVAILABILITY_TARGET),
      graph: false,
      width: 6,
    })
    .gauge('Error budget remaining', budgetRemaining(availability('14d'), AVAILABILITY_TARGET), {
      unit: 'percentunit',
      min: 0,
      max: 1,
      thresholds: STEPS.lowerIsWorse(0.25, 0.5),
      width: 6,
    })
    .stat(
      'Burn rate (1h)',
      `(1 - (${availability('1h')})) / ${(1 - AVAILABILITY_TARGET).toFixed(4)}`,
      {
        decimals: 2,
        thresholds: STEPS.higherIsWorse(2, 14.4),
        graph: true,
        description:
          '1 = on pace to spend the budget exactly over 14 days. 14.4 for an hour is the fast-burn page.',
        width: 6,
      },
    )
    .stat(
      'Burn rate (6h)',
      `(1 - (${availability('6h')})) / ${(1 - AVAILABILITY_TARGET).toFixed(4)}`,
      { decimals: 2, thresholds: STEPS.higherIsWorse(1, 6), graph: true, width: 6 },
    )
    .timeseries(
      'Availability, 1h windows',
      [
        { expr: availability('1h'), legend: 'availability' },
        { expr: `vector(${AVAILABILITY_TARGET})`, legend: 'objective' },
      ],
      { unit: 'percentunit', decimals: 3, min: 0.97, max: 1 },
    )
    .timeseries(
      '5xx by route',
      [
        {
          expr: 'sum by (route) (rate(http_requests_total{status=~"5.."}[$__rate_interval]))',
          legend: '{{route}}',
        },
      ],
      { unit: 'reqps', stacked: true },
    )
    .row('Tile latency')
    .stat('Within 250 ms (14d)', withinSeconds(TILES, '0.25', '14d'), {
      unit: 'percentunit',
      decimals: 2,
      min: 0.8,
      max: 1,
      thresholds: STEPS.lowerIsWorse(0.9, TILE_LATENCY_TARGET),
      graph: false,
      width: 6,
    })
    .gauge(
      'Tile latency budget remaining',
      budgetRemaining(withinSeconds(TILES, '0.25', '14d'), TILE_LATENCY_TARGET),
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: STEPS.lowerIsWorse(0.25, 0.5),
        width: 6,
      },
    )
    .timeseries(
      'Tiles within 250 ms, 1h windows',
      [
        { expr: withinSeconds(TILES, '0.25', '1h'), legend: 'within 250 ms' },
        { expr: `vector(${TILE_LATENCY_TARGET})`, legend: 'objective' },
      ],
      { unit: 'percentunit', min: 0.5, max: 1, width: 12 },
    )
    .row('API latency')
    .stat('Within 1 s (14d)', withinSeconds(NOT_TILES, '1', '14d'), {
      unit: 'percentunit',
      decimals: 2,
      min: 0.8,
      max: 1,
      thresholds: STEPS.lowerIsWorse(0.9, API_LATENCY_TARGET),
      graph: false,
      width: 6,
    })
    .gauge(
      'API latency budget remaining',
      budgetRemaining(withinSeconds(NOT_TILES, '1', '14d'), API_LATENCY_TARGET),
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: STEPS.lowerIsWorse(0.25, 0.5),
        width: 6,
      },
    )
    .timeseries(
      'Non-tile requests within 1 s, 1h windows',
      [
        { expr: withinSeconds(NOT_TILES, '1', '1h'), legend: 'within 1 s' },
        { expr: `vector(${API_LATENCY_TARGET})`, legend: 'objective' },
      ],
      { unit: 'percentunit', min: 0.5, max: 1, width: 12 },
    )
    .bargauge(
      'Slowest routes (p95)',
      [
        {
          expr: 'topk(10, histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{route!~"/api/metrics"}[$__range]))))',
          legend: '{{route}}',
        },
      ],
      { unit: 's', min: 0, thresholds: STEPS.higherIsWorse(0.5, 2) },
    )
    .build()
