/**
 * A small builder for Grafana dashboard JSON, so a dashboard reads as the list
 * of questions it answers rather than as 400 lines of `fieldConfig`.
 *
 * The files under `docker/observability/grafana/dashboards/` are **generated**
 * by `pnpm dashboards:build` from these modules, and are provisioned read-only
 * (`allowUiUpdates: false`). Edit here, rebuild, commit both.
 */

export interface DatasourceReference {
  type: 'prometheus' | 'loki' | 'tempo'
  uid: string
}

export const PROMETHEUS: DatasourceReference = { type: 'prometheus', uid: 'prometheus' }
export const LOKI: DatasourceReference = { type: 'loki', uid: 'loki' }
export const TEMPO: DatasourceReference = { type: 'tempo', uid: 'tempo' }

interface Target {
  expr: string
  legend?: string
  instant?: boolean
  format?: 'table' | 'heatmap' | 'time_series'
}

interface Threshold {
  value: number | null
  color: string
}

/** Colours are Grafana's named palette so they follow the theme. */
export const STEPS = {
  /** Green until `warn`, amber until `bad`, red above — for things where more is worse. */
  higherIsWorse: (warn: number, bad: number): Threshold[] => [
    { value: null, color: 'green' },
    { value: warn, color: 'orange' },
    { value: bad, color: 'red' },
  ],
  /** Red below `bad`, amber below `warn`, green above — for things where more is better. */
  lowerIsWorse: (bad: number, warn: number): Threshold[] => [
    { value: null, color: 'red' },
    { value: bad, color: 'orange' },
    { value: warn, color: 'green' },
  ],
  neutral: [{ value: null, color: 'blue' }] as Threshold[],
}

interface PanelOptions {
  width?: number
  height?: number
  unit?: string
  description?: string
  min?: number
  max?: number
  decimals?: number
  thresholds?: Threshold[]
  stacked?: boolean
  datasource?: DatasourceReference
  /** Per-series overrides, matched by the series' display name. */
  seriesColours?: Record<string, string>
  /** Table only: column display names keyed by the raw field name (`Value #A`, `source`, …). */
  renames?: Record<string, string>
}

export interface Panel {
  [key: string]: unknown
}

type Placement = { width: number; height: number }

export interface DashboardMeta {
  uid: string
  title: string
  description: string
  tags?: string[]
  from?: string
  variables?: unknown[]
}

interface PanelBlueprint {
  type: string
  title: string
  targets: Target[]
  options: PanelOptions
  defaults: Placement
}

export class Dashboard {
  private readonly panels: Panel[] = []
  private nextId = 1
  private cursorX = 0
  private cursorY = 0
  private rowHeight = 0

  constructor(private readonly meta: DashboardMeta) {}

  /** A collapsible-looking section header; starts a new line. */
  row(title: string): this {
    this.newLine()
    this.panels.push({
      id: this.nextId++,
      type: 'row',
      title,
      collapsed: false,
      gridPos: { x: 0, y: this.cursorY, w: 24, h: 1 },
      panels: [],
    })
    this.cursorY += 1
    return this
  }

  private newLine(): void {
    if (this.cursorX > 0) {
      this.cursorY += this.rowHeight
      this.cursorX = 0
      this.rowHeight = 0
    }
  }

  private place(size: Placement): { x: number; y: number; w: number; h: number } {
    if (this.cursorX + size.width > 24) this.newLine()
    const position = { x: this.cursorX, y: this.cursorY, w: size.width, h: size.height }
    this.cursorX += size.width
    this.rowHeight = Math.max(this.rowHeight, size.height)
    if (this.cursorX >= 24) this.newLine()
    return position
  }

  private base(blueprint: PanelBlueprint): Panel {
    const { type, title, targets, options, defaults } = blueprint
    const datasource = options.datasource ?? PROMETHEUS
    const gridPos = this.place({
      width: options.width ?? defaults.width,
      height: options.height ?? defaults.height,
    })

    return {
      id: this.nextId++,
      type,
      title,
      ...(options.description ? { description: options.description } : {}),
      gridPos,
      datasource,
      targets: targets.map((target, index) => ({
        refId: String.fromCharCode(65 + index),
        datasource,
        expr: target.expr,
        ...(target.legend ? { legendFormat: target.legend } : {}),
        ...(target.instant ? { instant: true, range: false } : {}),
        ...(target.format ? { format: target.format } : {}),
      })),
      fieldConfig: {
        defaults: {
          ...(options.unit ? { unit: options.unit } : {}),
          ...(options.min !== undefined ? { min: options.min } : {}),
          ...(options.max !== undefined ? { max: options.max } : {}),
          ...(options.decimals !== undefined ? { decimals: options.decimals } : {}),
          ...(options.thresholds
            ? { thresholds: { mode: 'absolute', steps: options.thresholds } }
            : {}),
        },
        overrides: Object.entries(options.seriesColours ?? {}).map(([name, colour]) => ({
          matcher: { id: 'byName', options: name },
          properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: colour } }],
        })),
      },
    }
  }

  private add(panel: Panel): this {
    this.panels.push(panel)
    return this
  }

  timeseries(title: string, targets: Target[], options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'timeseries',
      title,
      targets,
      options,
      defaults: { width: 12, height: 8 },
    })
    const fieldConfig = panel.fieldConfig as { defaults: Record<string, unknown> }
    fieldConfig.defaults.custom = {
      drawStyle: 'line',
      lineWidth: 1,
      fillOpacity: options.stacked ? 25 : 8,
      showPoints: 'never',
      spanNulls: true,
      stacking: { mode: options.stacked ? 'normal' : 'none', group: 'A' },
    }
    panel.options = {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' },
    }
    return this.add(panel)
  }

  stat(title: string, expr: string, options: PanelOptions & { graph?: boolean } = {}): this {
    const panel = this.base({
      type: 'stat',
      title,
      targets: [{ expr, legend: title }],
      options,
      defaults: {
        width: 4,
        height: 5,
      },
    })
    panel.options = {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: options.thresholds ? 'background' : 'value',
      graphMode: options.graph === false ? 'none' : 'area',
      textMode: 'auto',
      justifyMode: 'center',
    }
    return this.add(panel)
  }

  gauge(title: string, expr: string, options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'gauge',
      title,
      targets: [{ expr, legend: title }],
      options,
      defaults: {
        width: 4,
        height: 6,
      },
    })
    panel.options = {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      showThresholdLabels: false,
      showThresholdMarkers: true,
    }
    return this.add(panel)
  }

  /** Horizontal bars, one per series — for "which N is biggest" at the current instant. */
  bargauge(title: string, targets: Target[], options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'bargauge',
      title,
      targets: targets.map((target) => ({ ...target, instant: true })),
      options,
      defaults: { width: 12, height: 8 },
    })
    panel.options = {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      orientation: 'horizontal',
      displayMode: 'gradient',
      showUnfilled: true,
      valueMode: 'color',
    }
    return this.add(panel)
  }

  piechart(title: string, targets: Target[], options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'piechart',
      title,
      targets: targets.map((target) => ({ ...target, instant: true })),
      options,
      defaults: { width: 8, height: 8 },
    })
    panel.options = {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      pieType: 'donut',
      displayLabels: ['percent'],
      legend: {
        displayMode: 'table',
        placement: 'right',
        showLegend: true,
        values: ['value', 'percent'],
      },
      tooltip: { mode: 'single' },
    }
    return this.add(panel)
  }

  /** A histogram over time. Expects a `_bucket` series summed `by (le)`. */
  heatmap(title: string, expr: string, options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'heatmap',
      title,
      targets: [{ expr, format: 'heatmap', legend: '{{le}}' }],
      options,
      defaults: { width: 12, height: 8 },
    })
    panel.options = {
      calculate: false,
      cellGap: 1,
      color: { mode: 'scheme', scheme: 'Oranges', fill: 'dark-orange', scale: 'exponential' },
      yAxis: { unit: options.unit ?? 's' },
      legend: { show: true },
      tooltip: { mode: 'single', yHistogram: true },
      rowsFrame: { layout: 'auto' },
    }
    return this.add(panel)
  }

  table(title: string, targets: Target[], options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'table',
      title,
      targets: targets.map((target) => ({ ...target, instant: true, format: 'table' as const })),
      options,
      defaults: { width: 12, height: 8 },
    })
    panel.options = { showHeader: true, cellHeight: 'sm' }
    panel.transformations = [
      { id: 'merge', options: {} },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, __name__: true, job: true, instance: true },
          renameByName: options.renames ?? {},
        },
      },
    ]
    return this.add(panel)
  }

  /** A Loki log stream. */
  logs(title: string, expr: string, options: PanelOptions = {}): this {
    const panel = this.base({
      type: 'logs',
      title,
      targets: [{ expr }],
      options: { ...options, datasource: LOKI },
      defaults: { width: 24, height: 10 },
    })
    panel.options = {
      showTime: true,
      wrapLogMessage: true,
      prettifyLogMessage: false,
      enableLogDetails: true,
      sortOrder: 'Descending',
      dedupStrategy: 'none',
    }
    return this.add(panel)
  }

  /** A Loki metric query drawn as a graph (log volume, error counts). */
  lokiTimeseries(title: string, targets: Target[], options: PanelOptions = {}): this {
    return this.timeseries(title, targets, { ...options, datasource: LOKI })
  }

  /** A Tempo TraceQL search, rendered as a table of traces. */
  traces(title: string, query: string, options: PanelOptions = {}): this {
    const gridPos = this.place({ width: options.width ?? 24, height: options.height ?? 9 })
    return this.add({
      id: this.nextId++,
      type: 'table',
      title,
      ...(options.description ? { description: options.description } : {}),
      gridPos,
      datasource: TEMPO,
      targets: [
        {
          refId: 'A',
          datasource: TEMPO,
          queryType: 'traceql',
          query,
          limit: 20,
          tableType: 'traces',
        },
      ],
      fieldConfig: { defaults: {}, overrides: [] },
      options: { showHeader: true },
    })
  }

  text(title: string, markdown: string, options: PanelOptions = {}): this {
    const gridPos = this.place({ width: options.width ?? 24, height: options.height ?? 4 })
    return this.add({
      id: this.nextId++,
      type: 'text',
      title,
      gridPos,
      options: { mode: 'markdown', content: markdown },
    })
  }

  build(): Record<string, unknown> {
    return {
      uid: this.meta.uid,
      title: this.meta.title,
      description: this.meta.description,
      tags: ['vestigian', ...(this.meta.tags ?? [])],
      timezone: 'browser',
      schemaVersion: 39,
      version: 1,
      refresh: '30s',
      time: { from: this.meta.from ?? 'now-6h', to: 'now' },
      graphTooltip: 1,
      editable: false,
      // Every dashboard carrying the shared tag links to the rest, so the set
      // reads as one product rather than eight unrelated pages.
      links: [
        {
          type: 'dashboards',
          title: 'Vestigian',
          tags: ['vestigian'],
          asDropdown: true,
          includeVars: false,
          keepTime: true,
          icon: 'external link',
        },
      ],
      templating: { list: this.meta.variables ?? [] },
      annotations: { list: [] },
      panels: this.panels,
    }
  }
}

/** `histogram_quantile` over a `_bucket` series, grouped by the given labels. */
interface QuantileScope {
  /** Labels to keep, besides `le`. */
  by?: string[]
  /** A label selector such as `{route="/api/x"}`, braces included. */
  selector?: string
}

export const quantile = (q: number, metric: string, scope: QuantileScope = {}): string => {
  const grouping = ['le', ...(scope.by ?? [])].join(', ')
  return `histogram_quantile(${q}, sum by (${grouping}) (rate(${metric}_bucket${scope.selector ?? ''}[$__rate_interval])))`
}

/** A ratio that reads as "nothing" rather than as a gap when the denominator is empty. */
export const ratio = (numerator: string, denominator: string): string =>
  `(${numerator} or vector(0)) / clamp_min(${denominator}, 0.001)`
