/**
 * Reference plates for a column's reliefs — mirrored (Trajan's Column, from
 * Wikimedia Commons) or IIIF-served live (the Column of Marcus Aurelius,
 * from Heidelberg University Library) via `/columns`. Not a `SiteSummary`:
 * these are imported reference material, never a contributed record, and
 * carry no slug — there is no per-plate page, only the gallery.
 */
export type ColumnReliefMonument = 'trajans-column'

export interface ColumnReliefPlateSummary {
  id: number
  monument: ColumnReliefMonument
  sceneNumber: number | null
  title: string
  /** Commons' own scene caption for the file, where it has one. */
  description: string | null
  licence: string
  attribution: string | null
  width: number
  height: number
}
