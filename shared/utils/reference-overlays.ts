/**
 * The overlays that share one tile endpoint (`/api/tiles/reference/:layer`):
 * Itiner-e Roman roads, Nomisma mints, the Wikidata monuments, I.Sicily
 * inscriptions, the Atlas of Hillforts and the road audit (a calculated reading
 * of Itiner-e against the atlas's other records). One list, read by both the server (which validates the path
 * segment against it) and the interface (which keeps one switch per entry), so
 * a layer cannot exist on one side only.
 */
export const REFERENCE_OVERLAY_IDS = [
  'roman-roads',
  'mints',
  'monuments',
  'isicily',
  'hillforts',
  'road-audit',
] as const

export type ReferenceOverlayId = (typeof REFERENCE_OVERLAY_IDS)[number]

export const isReferenceOverlayId = (value: string): value is ReferenceOverlayId =>
  (REFERENCE_OVERLAY_IDS as readonly string[]).includes(value)

/**
 * The kinds a monument can be (`antiquity_monument_kind`). Shared because the map
 * draws a mark per kind and the popup names it — one list, so a kind cannot be
 * added to the database and be left without an icon or a name.
 */
export const MONUMENT_KINDS = [
  'theatre',
  'amphitheatre',
  'villa',
  'aqueduct',
  'bridge',
  'temple',
  'fort',
  'bath',
  'forum',
  'mithraeum',
] as const

export type MonumentKind = (typeof MONUMENT_KINDS)[number]
