import { Dashboard, STEPS, quantile, ratio } from './helpers'

/** What the atlas holds, how complete it is, and whether its upstream data is fresh. */
export const buildData = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-data',
    title: 'Vestigian — data & import health',
    description:
      'Catalogue size and completeness, import freshness and the upstream services that enrich it.',
    tags: ['data'],
    from: 'now-30d',
  })
    .row('Catalogue')
    .stat('Published sites', 'atlas_sites{status="approved"}', { width: 4 })
    .stat('Published tracings', 'atlas_tracings{status="approved"}', { width: 4 })
    .stat('Published photographs', 'atlas_images{status="approved"}', { width: 4 })
    .stat(
      'Sites with a photograph',
      '1 - atlas_sites_missing{gap="photograph"} / clamp_min(atlas_sites{status="approved"}, 1)',
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        width: 4,
        description: 'The cold-start gap: most records have never been photographed.',
      },
    )
    .stat(
      'Sites with a description',
      '1 - atlas_sites_missing{gap="description"} / clamp_min(atlas_sites{status="approved"}, 1)',
      { unit: 'percentunit', min: 0, max: 1, width: 4 },
    )
    .stat(
      'Sites with a period',
      '1 - atlas_sites_missing{gap="period"} / clamp_min(atlas_sites{status="approved"}, 1)',
      { unit: 'percentunit', min: 0, max: 1, width: 4 },
    )
    .timeseries('Catalogue growth', [
      { expr: 'atlas_sites{status="approved"}', legend: 'sites' },
      { expr: 'atlas_tracings{status="approved"}', legend: 'tracings' },
      { expr: 'atlas_images{status="approved"}', legend: 'photographs' },
    ])
    .timeseries(
      'Completeness over time',
      [
        {
          expr: '1 - atlas_sites_missing{gap="photograph"} / clamp_min(atlas_sites{status="approved"}, 1)',
          legend: 'photograph',
        },
        {
          expr: '1 - atlas_sites_missing{gap="description"} / clamp_min(atlas_sites{status="approved"}, 1)',
          legend: 'description',
        },
        {
          expr: '1 - atlas_sites_missing{gap="period"} / clamp_min(atlas_sites{status="approved"}, 1)',
          legend: 'period',
        },
      ],
      {
        unit: 'percentunit',
        max: 1,
        description: 'The line that moves when contributors are doing their job.',
      },
    )
    .bargauge('Sites still missing…', [{ expr: 'atlas_sites_missing', legend: '{{gap}}' }], {
      min: 0,
      description: 'Absolute counts; the nearby page ranks work from exactly this.',
    })
    .piechart(
      'Published sites by category',
      [{ expr: 'atlas_sites_by_category', legend: '{{category}}' }],
      { width: 12 },
    )
    .row('Imports')
    .table(
      'Newest import run per source',
      [
        { expr: '(time() - atlas_import_last_run_timestamp_seconds) / 86400' },
        { expr: 'atlas_import_last_row_count' },
      ],
      {
        width: 12,
        decimals: 1,
        renames: { 'Value #A': 'days ago', 'Value #B': 'rows written', source: 'source' },
        description:
          'Age of the last successful run and the rows it wrote. Recorded by `scripts/import/guard.ts`; an empty table means nothing has been recorded yet.',
      },
    )
    .bargauge(
      'Days since last import',
      [
        {
          expr: '(time() - atlas_import_last_run_timestamp_seconds) / 86400',
          legend: '{{source}}',
        },
      ],
      { unit: 'd', min: 0, thresholds: STEPS.higherIsWorse(60, 180), width: 12 },
    )
    .timeseries(
      'Rows written by the last import, per source',
      [{ expr: 'atlas_import_last_row_count', legend: '{{source}}' }],
      {
        description:
          'A source that suddenly shrinks is what the upstream-delta guard exists to refuse.',
      },
    )
    .row('Enrichment and translation upstreams')
    .timeseries(
      'Enrichment outcomes by source',
      [
        {
          expr: 'sum by (source, outcome) (increase(enrichment_requests_total[$__rate_interval]))',
          legend: '{{source}} · {{outcome}}',
        },
      ],
      { stacked: true },
    )
    .bargauge(
      'Enrichment success rate (range)',
      [
        {
          expr: ratio(
            'sum by (source) (increase(enrichment_requests_total{outcome=~"ok|hit|found|cached"}[$__range]))',
            'sum by (source) (increase(enrichment_requests_total[$__range]))',
          ),
          legend: '{{source}}',
        },
      ],
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        description:
          '"No article" is an outcome too, so a low rate is not automatically a fault — compare against `refused` and `error`.',
      },
    )
    .timeseries(
      'Translation outcomes',
      [
        {
          expr: 'sum by (outcome) (increase(translation_requests_total[$__rate_interval]))',
          legend: '{{outcome}}',
        },
      ],
      { stacked: true },
    )
    .timeseries(
      'Enrichment endpoint latency p95',
      [
        {
          expr: quantile(0.95, 'http_request_duration_seconds', {
            selector: '{route=~"/api/sites/:id/enrichment"}',
          }),
          legend: 'p95',
        },
      ],
      { unit: 's' },
    )
    .build()
