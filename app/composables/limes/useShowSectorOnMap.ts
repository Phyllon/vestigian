import type { LimesSector } from '#shared/types'
import { cameraForSectorBounds } from '#shared/utils/sector-camera'

interface ShowSectorOnMapRequest {
  sector: LimesSector
  /** A fixed zoom, for a caller (the features page) that curates its own framing. */
  zoom?: number
}

/**
 * Takes a reader from a page with no map of its own to a frontier sector on
 * the map: "Follow the limes" on, the sector's sheet open, the camera over it.
 *
 * Shared by the sector page's button and the features page's example, which
 * did these four steps itself first. The switches and the focus request are
 * `useState`, so they survive the client-side navigation — which is why this
 * goes through `navigateTo` and never a plain link (see `useMapFocus`).
 */
export const useShowSectorOnMap = () => {
  const { setLimesActive } = useBasemapStyle()
  const { selectSector } = useLimes()
  const { requestFocus } = useMapFocus()

  const showSectorOnMap = async ({ sector, zoom }: ShowSectorOnMapRequest): Promise<void> => {
    const camera = cameraForSectorBounds(sector.bounds)
    const targetZoom = zoom ?? camera.zoom
    const { lat, lon } = camera.center

    setLimesActive(true)
    selectSector(sector.slug)
    // A curated zoom wins; otherwise the map fits the sector to what its panel
    // leaves visible, exactly as a tap in the panel's own list does.
    requestFocus({
      center: { lat, lon },
      zoom: targetZoom,
      ...(zoom === undefined ? { bounds: sector.bounds } : {}),
    })

    await navigateTo(`/#map=${targetZoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`)
  }

  return { showSectorOnMap }
}
