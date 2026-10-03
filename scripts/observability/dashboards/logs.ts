import { Dashboard, LOKI, STEPS } from './helpers'

/**
 * Loki and Tempo, which collect everything and were displayed nowhere.
 * `route`, `status` and `durationMs` are fields inside the JSON line, not
 * labels — a label per field would multiply Loki's streams by their
 * cardinality — so every query here parses with `| json`.
 */
const APP = '{service="app"}'

export const buildLogs = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-logs',
    title: 'Vestigian — logs & traces',
    description: 'Application logs, errors, slow requests and the slowest traces.',
    tags: ['logs', 'traces'],
    from: 'now-3h',
  })
    .row('Log volume')
    .stat(
      'Errors (range)',
      `sum(count_over_time({service="app", level=~"error|fatal"}[$__range]))`,
      {
        datasource: LOKI,
        thresholds: STEPS.higherIsWorse(1, 25),
        graph: false,
        width: 4,
      },
    )
    .stat('Warnings (range)', `sum(count_over_time({service="app", level="warn"}[$__range]))`, {
      datasource: LOKI,
      graph: false,
      width: 4,
    })
    .lokiTimeseries(
      'Log lines by level',
      [{ expr: `sum by (level) (count_over_time(${APP}[$__interval]))`, legend: '{{level}}' }],
      {
        stacked: true,
        width: 16,
        seriesColours: {
          error: 'red',
          fatal: 'dark-red',
          warn: 'orange',
          info: 'blue',
          debug: 'purple',
        },
      },
    )
    .lokiTimeseries(
      'Log lines by service',
      [
        {
          expr: 'sum by (service) (count_over_time({job="docker"}[$__interval]))',
          legend: '{{service}}',
        },
      ],
      { stacked: true },
    )
    .lokiTimeseries(
      'Requests by status class',
      [
        {
          expr: `sum by (status) (count_over_time(${APP} | json | route!="" | status=~"[2345].." [$__interval]))`,
          legend: '{{status}}',
        },
      ],
      { description: 'From the access log; tile requests are logged at debug and are not here.' },
    )
    .row('Errors')
    .logs('Errors and fatals', '{service="app", level=~"error|fatal"}', { height: 10 })
    .lokiTimeseries(
      'Most frequent error messages',
      [
        {
          expr: `topk(10, sum by (msg) (count_over_time({service="app", level=~"error|fatal"} | json [$__range])))`,
          legend: '{{msg}}',
        },
      ],
      { width: 12 },
    )
    .logs('Warnings', '{service="app", level="warn"}', { height: 10, width: 12 })
    .logs(
      'Other containers: errors',
      '{job="docker", service!="app"} |~ "(?i)error|fatal|panic|exception"',
      {
        height: 9,
        description:
          'Postgres, Valkey, imgproxy, Traefik, Alloy and the rest — plain text, not Pino.',
      },
    )
    .row('Slow requests')
    .logs(
      'Slower than 1 s',
      `${APP} | json | durationMs > 1000 | line_format "{{.durationMs}} ms · {{.status}} {{.method}} {{.route}}"`,
      { height: 9 },
    )
    .lokiTimeseries(
      'Slow requests per route',
      [
        {
          expr: `sum by (route) (count_over_time(${APP} | json | durationMs > 1000 [$__interval]))`,
          legend: '{{route}}',
        },
      ],
      { stacked: true },
    )
    .lokiTimeseries(
      'Largest responses',
      [
        {
          expr: `topk(8, max by (route) (max_over_time(${APP} | json | bytes != "" | unwrap bytes [$__interval])))`,
          legend: '{{route}}',
        },
      ],
      {
        unit: 'bytes',
        description:
          'Largest single body per route; tiles are debug-logged so this is mostly JSON and exports.',
      },
    )
    .row('Traces')
    .traces(
      'Slowest requests (> 500 ms)',
      '{ resource.service.name = "vestigian" && duration > 500ms }',
      {
        description:
          'Click a row to open the span tree; `postgis.render_tile` children show where the time went.',
      },
    )
    .traces(
      'PostGIS tile renders (> 250 ms)',
      '{ name = "postgis.render_tile" && duration > 250ms }',
      {
        height: 8,
      },
    )
    .traces('Failed requests', '{ resource.service.name = "vestigian" && status = error }', {
      height: 8,
    })
    .build()
