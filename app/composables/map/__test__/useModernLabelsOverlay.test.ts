import { describe, expect, it } from 'vitest'
import type { SymbolLayerSpecification } from 'maplibre-gl'
import type { BasemapSource } from '#shared/types'
import { resolveModernSchema } from '../useBasemapStyle'
import {
  MODERN_LABELS_OVERLAY_LAYER_ID,
  MODERN_LABELS_OVERLAY_SOURCE_ID,
  buildModernLabelsOverlayLayer,
} from '../useModernLabelsOverlay'

const source = (provider: BasemapSource['provider']): BasemapSource => ({
  provider,
  pmtilesUrl: '',
  terrainUrl: '',
  antiquityDareUrl: '',
  satelliteUrl: '',
  atlasTilesUrl: 'http://localhost:3000/api/tiles/antiquity',
  limesTilesUrl: 'http://localhost:3000/api/tiles/limes',
  empireExtentTilesUrl: 'http://localhost:3000/api/tiles/antiquity-empire',
  battleTilesUrl: 'http://localhost:3000/api/tiles/antiquity-battles',
  portTilesUrl: 'http://localhost:3000/api/tiles/antiquity-ports',
  routeTilesUrl: 'http://localhost:3000/api/tiles/antiquity-routes',
  featureTilesUrl: 'http://localhost:3000/api/tiles/antiquity-features',
  coinHoardTilesUrl: 'http://localhost:3000/api/tiles/antiquity-coin-hoards',
  inscriptionTilesUrl: 'http://localhost:3000/api/tiles/inscriptions',
  atticInscriptionTilesUrl: 'http://localhost:3000/api/tiles/attic-inscriptions',
  glyphsUrl: '/fonts/{fontstack}/{range}.pbf',
})

const openFreemapSchema = resolveModernSchema(source('openfreemap'))
const pmtilesSchema = resolveModernSchema(source('pmtiles'))

describe('buildModernLabelsOverlayLayer', () => {
  it('carries an id and source distinct from the base style’s own place-labels layer', () => {
    // `vestigian`/`satellite` bake a layer with id `place-labels` reading
    // source `basemap` directly into `currentStyle` — sharing either id here
    // would let this overlay's own `detach` race `setStyle`'s diff over the
    // same MapLibre object the instant a reader switches from an antiquity
    // view to one of those two with the toggle still on. See the docstring
    // in `useModernLabelsOverlay.ts`.
    const layer = buildModernLabelsOverlayLayer(openFreemapSchema, 1)
    expect(layer.id).toBe(MODERN_LABELS_OVERLAY_LAYER_ID)
    expect(layer.source).toBe(MODERN_LABELS_OVERLAY_SOURCE_ID)
    expect(layer.id).not.toBe('place-labels')
    expect(layer.source).not.toBe('basemap')
  })

  it('reads the schema-correct source-layer name for whichever provider is active', () => {
    const openFreemap = buildModernLabelsOverlayLayer(openFreemapSchema, 1)
    expect((openFreemap as SymbolLayerSpecification)['source-layer']).toBe('place')

    const pmtiles = buildModernLabelsOverlayLayer(pmtilesSchema, 1)
    expect((pmtiles as SymbolLayerSpecification)['source-layer']).toBe('places')
  })

  it('draws at whatever opacity it is asked for', () => {
    const layer = buildModernLabelsOverlayLayer(openFreemapSchema, 1) as SymbolLayerSpecification
    expect(layer.paint?.['text-opacity']).toBeCloseTo(1)
  })
})
