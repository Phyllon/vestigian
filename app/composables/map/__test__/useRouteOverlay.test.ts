import { describe, expect, it } from 'vitest'
import { ROUTE_LAYER_ID, buildRouteLayer, buildRoutePopupHtml } from '../useRouteOverlay'

const t = (key: string): string => {
  const labels: Record<string, string> = {
    'routePopup.road': 'Road',
    'routePopup.coastal': 'Coastal route',
    'routePopup.ferry': 'Ferry crossing',
  }
  return labels[key] ?? key
}

describe('buildRouteLayer', () => {
  it('draws one line layer in a single hue', () => {
    const layer = buildRouteLayer()
    expect(layer.id).toBe(ROUTE_LAYER_ID)
    expect(layer.type).toBe('line')
    expect(layer.paint?.['line-color']).toBe('#8c8271')
  })

  it('reads the routes source layer, not atlas or limes', () => {
    const layer = buildRouteLayer()
    expect(layer.source).toBe('routes')
    expect(layer['source-layer']).toBe('routes')
  })

  it('varies dash pattern by route type rather than adding a second hue', () => {
    const layer = buildRouteLayer()
    const expression = layer.paint?.['line-dasharray']
    expect(expression).toContain('road')
    expect(expression).toContain('ferry')
  })
})

describe('buildRoutePopupHtml', () => {
  it('names the route kind', () => {
    const html = buildRoutePopupHtml(
      { route_type: 'road', source_title: null, target_title: null },
      t,
    )
    expect(html).toBe('<strong>Road</strong>')
  })

  it('shows both endpoints only when both are known', () => {
    const withEndpoints = buildRoutePopupHtml(
      { route_type: 'coastal', source_title: 'Ostia', target_title: 'Puteoli' },
      t,
    )
    expect(withEndpoints).toContain('Ostia → Puteoli')

    const withoutEndpoints = buildRoutePopupHtml(
      { route_type: 'ferry', source_title: null, target_title: null },
      t,
    )
    expect(withoutEndpoints).not.toContain('→')
  })

  it('escapes an endpoint title before it reaches setHTML', () => {
    const html = buildRoutePopupHtml(
      { route_type: 'road', source_title: '<script>alert(1)</script>', target_title: 'Rome' },
      t,
    )
    expect(html).not.toContain('<script>')
  })
})
