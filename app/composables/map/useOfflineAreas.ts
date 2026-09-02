import {
  MAX_ENUMERATED_TILES,
  TileCountExceededError,
  enumerateTiles,
  sampleTiles,
} from '#shared/utils/tiles'
import { cacheNameForArea } from '#shared/utils/offline-cache'
import type { BoundingBox, TileCoordinate } from '#shared/types'

/**
 * "Download this area for offline use" — the reader's own traces, the
 * antiquity sheet, the frontier, and (in production, where the basemap is a
 * PMTiles archive) a bounded slice of the modern basemap, stored in Cache
 * Storage under a name `service-worker/sw.ts` recognises on its own.
 *
 * This composable does the writing; the service worker only ever reads. See
 * its docstring for why that split matters — an offline area is a precise,
 * user-initiated fact, not something casual browsing can silently grow.
 *
 * Area metadata lives in `localStorage`, the one place in this app it is used
 * (`grep -rn localStorage app/` finds nothing else): it is small, browser-only,
 * and not the kind of state any other surface — another device, an export,
 * the server — needs to see. Cache Storage itself holds the actual tiles and
 * is the source of truth for whether they still exist; the metadata exists so
 * a management page can list what was downloaded without opening every cache.
 */

export type OfflineLayer = 'data' | 'antiquity' | 'limes' | 'basemap'

export interface OfflineArea {
  id: string
  name: string
  bbox: BoundingBox
  maxZoom: number
  includesBasemap: boolean
  tileCount: number
  byteSize: number
  createdAt: string
}

export interface LayerEstimate {
  layer: OfflineLayer
  tileCount: number
  estimatedBytes: number
}

export interface AreaEstimate {
  layers: LayerEstimate[]
  totalTiles: number
  totalEstimatedBytes: number
}

export interface QuotaCheck {
  /** `null` when `navigator.storage.estimate()` is unsupported — never blocks on that. */
  supported: boolean
  usage: number | null
  quota: number | null
  fits: boolean
}

const AREAS_STORAGE_KEY = 'vestigia-offline-areas'
const ESTIMATE_SAMPLE_SIZE = 20
/** A 20% margin: the estimate is a sample-based extrapolation, not a byte count. */
const QUOTA_SAFETY_FACTOR = 1.2

const tileUrl = (layer: OfflineLayer, tile: TileCoordinate): string => {
  const path = layer === 'data' ? '' : `${layer}/`
  return `/api/tiles/${path}${tile.z}/${tile.x}/${tile.y}.mvt`
}

const readAreas = (): OfflineArea[] => {
  try {
    const raw = localStorage.getItem(AREAS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as OfflineArea[]) : []
  } catch {
    // A private-browsing tab or a full storage quota can make localStorage
    // throw on read. An empty list is the safe answer either way — nothing
    // downloaded is indistinguishable from nothing readable, and the caller
    // needs no more than that to decide what to show.
    return []
  }
}

const writeAreas = (areas: OfflineArea[]): void => {
  try {
    localStorage.setItem(AREAS_STORAGE_KEY, JSON.stringify(areas))
  } catch {
    // Same reasoning as readAreas: a write that cannot land must not throw
    // through a download that otherwise succeeded. The cache itself is still
    // correct; only the management list will not know about it until reload.
  }
}

export const useOfflineAreas = () => {
  const config = useRuntimeConfig()
  /**
   * Always starts empty, even on the client — `useState`'s factory runs once,
   * during SSR, where `import.meta.client` is false; Nuxt then serialises
   * *that* result into the payload and hydrates the client from it rather
   * than re-invoking the factory. A conditional inside the factory to read
   * `localStorage` "on the client" therefore never actually ran on the
   * client — it read `[]` on the server and the client inherited that `[]`
   * forever, which is why a freshly downloaded area failed to appear after a
   * full navigation to `/offline` in testing. `refresh()` below is the real
   * client-side read, and callers that display this list call it themselves.
   */
  const areas = useState<OfflineArea[]>('offline-areas', () => [])
  const refresh = (): void => {
    if (import.meta.client) areas.value = readAreas()
  }

  const isBasemapDownloadable = computed(() => config.public.basemap.provider === 'pmtiles')

  const layersFor = (includeBasemap: boolean): OfflineLayer[] => {
    const layers: OfflineLayer[] = ['data', 'antiquity', 'limes']
    if (includeBasemap && isBasemapDownloadable.value) layers.push('basemap')
    return layers
  }

  /**
   * Real numbers, not guessed ones: fetches a small, evenly-spread sample of
   * the actual tiles this download would fetch — the same URLs, so there is
   * nothing for the estimate to disagree with the download about — and
   * extrapolates from their measured size. Twenty tiles per layer is enough to
   * average out the empty-ocean-tile skew without costing more than a
   * fraction of a second per layer.
   */
  const estimate = async (
    bbox: BoundingBox,
    maxZoom: number,
    includeBasemap: boolean,
  ): Promise<AreaEstimate> => {
    const layers: LayerEstimate[] = []

    for (const layer of layersFor(includeBasemap)) {
      const tiles = enumerateTiles(bbox, 0, maxZoom)
      const sample = sampleTiles(tiles, ESTIMATE_SAMPLE_SIZE)

      const sizes = await Promise.all(
        sample.map(async (tile) => {
          const response = await fetch(tileUrl(layer, tile))
          if (!response.ok && response.status !== 204) return 0
          const body = await response.arrayBuffer()
          return body.byteLength
        }),
      )

      const meanBytes = sizes.length ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length : 0
      layers.push({ layer, tileCount: tiles.length, estimatedBytes: meanBytes * tiles.length })
    }

    return {
      layers,
      totalTiles: layers.reduce((sum, entry) => sum + entry.tileCount, 0),
      totalEstimatedBytes: layers.reduce((sum, entry) => sum + entry.estimatedBytes, 0),
    }
  }

  const checkQuota = async (estimatedBytes: number): Promise<QuotaCheck> => {
    if (!navigator.storage?.estimate) {
      return { supported: false, usage: null, quota: null, fits: true }
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const remaining = quota - usage
    return { supported: true, usage, quota, fits: remaining > estimatedBytes * QUOTA_SAFETY_FACTOR }
  }

  interface DownloadInput {
    name: string
    bbox: BoundingBox
    maxZoom: number
    includeBasemap: boolean
  }

  interface DownloadProgress {
    tilesDone: number
    tilesTotal: number
    bytesDone: number
  }

  /**
   * Fetches every tile in the area, layer by layer, writing each into one
   * named cache as it arrives — so a download interrupted partway through
   * still leaves a genuinely usable, if incomplete, area behind rather than
   * nothing at all. `onProgress` is called after every tile; UI code is
   * expected to throttle its own rendering rather than this loop slowing down
   * to accommodate it.
   */
  const download = async (
    input: DownloadInput,
    onProgress?: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<OfflineArea> => {
    const layers = layersFor(input.includeBasemap)
    const tilesByLayer = layers.map((layer) => ({
      layer,
      tiles: enumerateTiles(input.bbox, 0, input.maxZoom),
    }))
    const tilesTotal = tilesByLayer.reduce((sum, entry) => sum + entry.tiles.length, 0)

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const cache = await caches.open(cacheNameForArea(id))

    let tilesDone = 0
    let bytesDone = 0

    for (const { layer, tiles } of tilesByLayer) {
      for (const tile of tiles) {
        if (signal?.aborted) throw new DOMException('Download cancelled.', 'AbortError')

        const url = tileUrl(layer, tile)
        const response = await fetch(url, { signal })
        if (response.ok || response.status === 204) {
          const measured = response.clone()
          await cache.put(url, response)
          bytesDone += (await measured.blob()).size
        }

        tilesDone++
        onProgress?.({ tilesDone, tilesTotal, bytesDone })
      }
    }

    const area: OfflineArea = {
      id,
      name: input.name,
      bbox: input.bbox,
      maxZoom: input.maxZoom,
      includesBasemap: layers.includes('basemap'),
      tileCount: tilesTotal,
      byteSize: bytesDone,
      createdAt: new Date().toISOString(),
    }

    /**
     * Read fresh from storage rather than appending to `areas.value`: this
     * composable's state does not auto-populate on the client (see the note
     * on `refresh` above), so a caller that never happened to call `refresh`
     * first — the map's download panel is exactly this caller — would still
     * have `areas.value === []` here. Building on that would both miss
     * showing the new area to anyone who *had* loaded the list and, far
     * worse, overwrite `localStorage` with a single-entry list, discarding
     * every area downloaded in an earlier session.
     */
    const updated = [...readAreas(), area]
    writeAreas(updated)
    areas.value = updated

    return area
  }

  const remove = async (id: string): Promise<void> => {
    await caches.delete(cacheNameForArea(id))
    const updated = readAreas().filter((area) => area.id !== id)
    writeAreas(updated)
    areas.value = updated
  }

  const totalBytes = computed(() => areas.value.reduce((sum, area) => sum + area.byteSize, 0))

  return {
    areas,
    refresh,
    totalBytes,
    isBasemapDownloadable,
    estimate,
    checkQuota,
    download,
    remove,
  }
}

export { MAX_ENUMERATED_TILES, TileCountExceededError }
