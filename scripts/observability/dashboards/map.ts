import { Dashboard, STEPS, quantile, ratio } from './helpers'

/** The hot path: tiles, and the three things a reader does on the map besides panning it. */
const TILES = 'route="/api/tiles/:z/:x/:y"'

export const buildMap = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-map',
    title: 'Vestigian — map & tiles',
    description:
      'Tile cache and render cost by zoom, the clustered vs every-site modes, search, featured sites and photographs.',
    tags: ['map'],
  })
    .row('Tiles')
    .stat('Tiles / s', 'sum(rate(tile_requests_total[$__rate_interval]))', {
      unit: 'reqps',
      decimals: 1,
    })
    .stat(
      'Cache hit rate',
      ratio(
        'sum(rate(tile_requests_total{cache="hit"}[$__rate_interval]))',
        'sum(rate(tile_requests_total[$__rate_interval]))',
      ),
      { unit: 'percentunit', min: 0, max: 1, thresholds: STEPS.lowerIsWorse(0.5, 0.85) },
    )
    .stat(
      'Every-site mode share',
      ratio(
        'sum(rate(tile_requests_total{mode="every"}[$__rate_interval]))',
        'sum(rate(tile_requests_total[$__rate_interval]))',
      ),
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        description: 'How much of the tile traffic is readers who switched off clustering.',
      },
    )
    .stat('Render p95 (misses)', quantile(0.95, 'tile_render_duration_seconds'), {
      unit: 's',
      thresholds: STEPS.higherIsWorse(0.25, 1),
    })
    .stat(
      'Mean tile size',
      'sum(rate(tile_response_bytes_sum[$__rate_interval])) / clamp_min(sum(rate(tile_response_bytes_count[$__rate_interval])), 0.001)',
      { unit: 'bytes' },
    )
    .stat('Tile bandwidth', 'sum(rate(tile_response_bytes_sum[$__rate_interval]))', { unit: 'Bps' })
    .timeseries(
      'Tiles per second by zoom',
      [
        {
          expr: 'sum by (zoom) (rate(tile_requests_total[$__rate_interval]))',
          legend: 'z{{zoom}}',
        },
      ],
      { unit: 'reqps', stacked: true },
    )
    .timeseries(
      'Cache hit rate by zoom',
      [
        {
          expr: 'sum by (zoom) (rate(tile_requests_total{cache="hit"}[$__rate_interval])) / sum by (zoom) (rate(tile_requests_total[$__rate_interval]))',
          legend: 'z{{zoom}}',
        },
      ],
      {
        unit: 'percentunit',
        max: 1,
        description:
          'A low zoom that never hits means its tiles are invalidated faster than they are re-requested.',
      },
    )
    .timeseries(
      'Clustered vs every-site',
      [
        {
          expr: 'sum by (mode) (rate(tile_requests_total[$__rate_interval]))',
          legend: '{{mode}}',
        },
      ],
      { unit: 'reqps', stacked: true },
    )
    .timeseries(
      'Cache misses by zoom',
      [
        {
          expr: 'sum by (zoom) (rate(tile_requests_total{cache="miss"}[$__rate_interval]))',
          legend: 'z{{zoom}}',
        },
      ],
      { unit: 'reqps', stacked: true, description: 'Every miss is a PostGIS aggregate.' },
    )
    .timeseries(
      'Render time (PostGIS, misses)',
      [
        {
          expr: quantile(0.5, 'tile_render_duration_seconds', { by: ['strategy'] }),
          legend: 'p50 {{strategy}}',
        },
        {
          expr: quantile(0.95, 'tile_render_duration_seconds', { by: ['strategy'] }),
          legend: 'p95 {{strategy}}',
        },
        {
          expr: quantile(0.99, 'tile_render_duration_seconds', { by: ['strategy'] }),
          legend: 'p99 {{strategy}}',
        },
      ],
      { unit: 's' },
    )
    .heatmap(
      'Render time distribution',
      'sum by (le) (increase(tile_render_duration_seconds_bucket[$__rate_interval]))',
    )
    .timeseries(
      'Response size p50 / p95 by zoom',
      [
        { expr: quantile(0.5, 'tile_response_bytes', { by: ['zoom'] }), legend: 'p50 z{{zoom}}' },
        { expr: quantile(0.95, 'tile_response_bytes', { by: ['zoom'] }), legend: 'p95 z{{zoom}}' },
      ],
      {
        unit: 'bytes',
        description: 'The every-site mode at zoom 2–4 is the heavy case; this is where it shows.',
      },
    )
    .timeseries(
      'Bytes served by zoom',
      [
        {
          expr: 'sum by (zoom) (rate(tile_response_bytes_sum[$__rate_interval]))',
          legend: 'z{{zoom}}',
        },
      ],
      { unit: 'Bps', stacked: true },
    )
    .timeseries(
      'Tile latency as served (p50 / p95 / p99)',
      [
        {
          expr: quantile(0.5, 'http_request_duration_seconds', { selector: `{${TILES}}` }),
          legend: 'p50',
        },
        {
          expr: quantile(0.95, 'http_request_duration_seconds', { selector: `{${TILES}}` }),
          legend: 'p95',
        },
        {
          expr: quantile(0.99, 'http_request_duration_seconds', { selector: `{${TILES}}` }),
          legend: 'p99',
        },
      ],
      {
        unit: 's',
        description: 'Includes the cache read and the network write, not just PostGIS.',
      },
    )
    .timeseries(
      'Tile responses by status',
      [
        {
          expr: `sum by (status) (rate(http_requests_total{${TILES}}[$__rate_interval]))`,
          legend: '{{status}}',
        },
      ],
      { unit: 'reqps', stacked: true },
    )
    .row('Search and featured sites')
    .stat('Searches / min', 'sum(rate(search_requests_total[$__rate_interval])) * 60', {
      decimals: 1,
    })
    .stat(
      'Searches with no result',
      ratio(
        'sum(rate(search_requests_total{outcome="empty"}[$__rate_interval]))',
        'sum(rate(search_requests_total[$__rate_interval]))',
      ),
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        description:
          'Per source — a site search that finds nothing is normal while a place search does.',
      },
    )
    .stat('Featured lookups / min', 'sum(rate(featured_requests_total[$__rate_interval])) * 60', {
      decimals: 1,
    })
    .stat(
      'Featured: empty',
      ratio(
        'sum(rate(featured_requests_total{outcome="empty"}[$__rate_interval]))',
        'sum(rate(featured_requests_total[$__rate_interval]))',
      ),
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        description:
          'High means readers are panning to areas with no photographed, described site.',
      },
    )
    .timeseries(
      'Search requests by source',
      [
        {
          expr: 'sum by (source, outcome) (rate(search_requests_total[$__rate_interval]))',
          legend: '{{source}} · {{outcome}}',
        },
      ],
      { unit: 'reqps' },
    )
    .timeseries(
      'Search latency p95',
      [
        {
          expr: quantile(0.95, 'http_request_duration_seconds', {
            by: ['route'],
            selector: '{route=~"/api/(sites|places|atlas/places)/search"}',
          }),
          legend: '{{route}}',
        },
      ],
      { unit: 's' },
    )
    .timeseries(
      'Featured lookups',
      [
        {
          expr: 'sum by (outcome) (rate(featured_requests_total[$__rate_interval]))',
          legend: '{{outcome}}',
        },
      ],
      { unit: 'reqps', stacked: true },
    )
    .timeseries(
      'Featured latency p95',
      [
        {
          expr: quantile(0.95, 'http_request_duration_seconds', {
            selector: '{route="/api/sites/featured"}',
          }),
          legend: 'p95',
        },
      ],
      { unit: 's' },
    )
    .row('Photographs')
    .timeseries(
      'Image requests by preset',
      [
        {
          expr: 'sum by (preset, outcome) (rate(image_requests_total[$__rate_interval]))',
          legend: '{{preset}} · {{outcome}}',
        },
      ],
      { unit: 'reqps' },
    )
    .timeseries(
      'Image requests that found nothing',
      [
        {
          expr: ratio(
            'sum(rate(image_requests_total{outcome="not_found"}[$__rate_interval]))',
            'sum(rate(image_requests_total[$__rate_interval]))',
          ),
          legend: 'not found',
        },
      ],
      {
        unit: 'percentunit',
        max: 1,
        description: 'Withdrawn or never-published images still referenced by an open page.',
      },
    )
    .piechart(
      'Preset mix',
      [
        {
          expr: 'sum by (preset) (increase(image_requests_total[$__range]))',
          legend: '{{preset}}',
        },
      ],
      { width: 8 },
    )
    .timeseries(
      'Image redirect latency p95',
      [
        {
          expr: quantile(0.95, 'http_request_duration_seconds', {
            selector: '{route="/api/images/:id/:preset"}',
          }),
          legend: 'p95',
        },
      ],
      { unit: 's', width: 8 },
    )
    .timeseries(
      'Upload outcomes',
      [
        {
          expr: 'sum by (outcome) (increase(upload_events_total[$__rate_interval]))',
          legend: '{{outcome}}',
        },
      ],
      { stacked: true, width: 8 },
    )
    .row('Reader experience (browser-reported)')
    .text(
      'About these numbers',
      "Anonymous timings sent by visitors' browsers (`POST /api/vitals`), skipped under Do Not Track / Global Privacy Control. `map-load` is navigation start → MapLibre `load`; `map-idle` → first moment every visible tile is drawn. Nothing identifies a visitor.",
      { height: 3 },
    )
    .stat('LCP p75', quantile(0.75, 'web_vital_duration_seconds', { selector: '{name="LCP"}' }), {
      unit: 's',
      thresholds: STEPS.higherIsWorse(2.5, 4),
      width: 4,
      graph: false,
    })
    .stat('INP p75', quantile(0.75, 'web_vital_duration_seconds', { selector: '{name="INP"}' }), {
      unit: 's',
      thresholds: STEPS.higherIsWorse(0.2, 0.5),
      width: 4,
      graph: false,
    })
    .stat(
      'CLS p75',
      'histogram_quantile(0.75, sum by (le) (rate(web_vital_layout_shift_bucket[$__rate_interval])))',
      { decimals: 3, thresholds: STEPS.higherIsWorse(0.1, 0.25), width: 4, graph: false },
    )
    .stat(
      'Map load p75',
      quantile(0.75, 'web_vital_duration_seconds', { selector: '{name="map-load"}' }),
      {
        unit: 's',
        thresholds: STEPS.higherIsWorse(3, 6),
        width: 4,
        graph: false,
      },
    )
    .stat(
      'Map idle p75',
      quantile(0.75, 'web_vital_duration_seconds', { selector: '{name="map-idle"}' }),
      {
        unit: 's',
        thresholds: STEPS.higherIsWorse(5, 10),
        width: 4,
        graph: false,
      },
    )
    .stat('Page loads reported', 'sum(increase(web_vital_ratings_total{name="TTFB"}[$__range]))', {
      width: 4,
      graph: false,
    })
    .timeseries(
      'Core timings p75',
      [
        {
          expr: quantile(0.75, 'web_vital_duration_seconds', {
            by: ['name'],
            selector: '{name=~"LCP|FCP|TTFB|INP"}',
          }),
          legend: '{{name}}',
        },
      ],
      { unit: 's' },
    )
    .timeseries(
      'Map timings p75 by device',
      [
        {
          expr: quantile(0.75, 'web_vital_duration_seconds', {
            by: ['name', 'device'],
            selector: '{name=~"map-load|map-idle"}',
          }),
          legend: '{{name}} · {{device}}',
        },
      ],
      { unit: 's', description: 'Phones are the design target; compare compact against wide.' },
    )
    .timeseries(
      'LCP p75: phone vs desktop',
      [
        {
          expr: quantile(0.75, 'web_vital_duration_seconds', {
            by: ['device'],
            selector: '{name="LCP"}',
          }),
          legend: '{{device}}',
        },
      ],
      { unit: 's' },
    )
    .heatmap(
      'LCP distribution',
      'sum by (le) (increase(web_vital_duration_seconds_bucket{name="LCP"}[$__rate_interval]))',
    )
    .bargauge(
      'Share rated "good"',
      [
        {
          expr: 'sum by (name) (increase(web_vital_ratings_total{rating="good"}[$__range])) / sum by (name) (increase(web_vital_ratings_total[$__range]))',
          legend: '{{name}}',
        },
      ],
      { unit: 'percentunit', min: 0, max: 1, thresholds: STEPS.lowerIsWorse(0.5, 0.75) },
    )
    .timeseries(
      'Ratings over time',
      [
        {
          expr: 'sum by (rating) (increase(web_vital_ratings_total[$__rate_interval]))',
          legend: '{{rating}}',
        },
      ],
      {
        stacked: true,
        seriesColours: { good: 'green', 'needs-improvement': 'orange', poor: 'red' },
      },
    )
    .build()
