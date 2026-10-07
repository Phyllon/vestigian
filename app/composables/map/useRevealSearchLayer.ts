import type { ReferenceSearchLayer } from '#shared/types'

/**
 * A search result from a reference layer is only a name and a point, so picking
 * one is not enough to show it: if its overlay is off, the camera arrives at an
 * empty map. This switches the matching overlay on, the same switch the
 * overlay menu throws.
 */
export const useRevealSearchLayer = () => {
  const {
    setBattlesActive,
    setPortsActive,
    setCoinHoardsActive,
    setFeaturesActive,
    setReferenceOverlayActive,
    setTabulaPeutingerianaOverlayActive,
  } = useBasemapStyle()

  const reveal = new Map<ReferenceSearchLayer, () => void>([
    ['hillfort', () => setReferenceOverlayActive('hillforts', true)],
    ['monument', () => setReferenceOverlayActive('monuments', true)],
    ['mint', () => setReferenceOverlayActive('mints', true)],
    ['port', () => setPortsActive(true)],
    ['battle', () => setBattlesActive(true)],
    ['coin-hoard', () => setCoinHoardsActive(true)],
    ['feature', () => setFeaturesActive(true)],
    ['tabula-place', () => setTabulaPeutingerianaOverlayActive(true)],
  ])

  return (layer: ReferenceSearchLayer): void => reveal.get(layer)?.()
}
