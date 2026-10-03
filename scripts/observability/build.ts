/**
 * Writes the dashboard JSON that Grafana provisions from.
 *
 *   pnpm dashboards:build
 *
 * The JSON under `docker/observability/grafana/dashboards/` is a build
 * artefact of the modules in `scripts/observability/dashboards/`. It is
 * committed because Grafana reads it straight off disk, but it is edited here:
 * a hand edit to the JSON is overwritten by the next build.
 *
 * `overview.json` is the one dashboard that predates the generator and is still
 * hand-written; it is left alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { buildCommunity } from './dashboards/community'
import { buildData } from './dashboards/data'
import { buildInfrastructure } from './dashboards/infrastructure'
import { buildLogs } from './dashboards/logs'
import { buildMap } from './dashboards/map'
import { buildSecurity } from './dashboards/security'
import { buildSlo } from './dashboards/slo'

const here = dirname(fileURLToPath(import.meta.url))
const outputDirectory = resolve(here, '../../docker/observability/grafana/dashboards')

const dashboards: Record<string, () => Record<string, unknown>> = {
  infrastructure: buildInfrastructure,
  map: buildMap,
  community: buildCommunity,
  security: buildSecurity,
  logs: buildLogs,
  slo: buildSlo,
  data: buildData,
}

mkdirSync(outputDirectory, { recursive: true })

for (const [name, build] of Object.entries(dashboards)) {
  const dashboard = build()
  const path = resolve(outputDirectory, `${name}.json`)
  // Formatted with the repo's own Prettier config, so the committed files are
  // byte-identical to what `pnpm format` would leave and a rebuild never shows
  // up as a formatting diff.
  const options = (await resolveConfig(path)) ?? {}
  writeFileSync(path, await format(JSON.stringify(dashboard), { ...options, filepath: path }))
  const panels = (dashboard.panels as { type: string }[]).filter((p) => p.type !== 'row').length
  console.log(`${name}.json — ${panels} panels`)
}
