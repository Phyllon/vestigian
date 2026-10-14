/**
 * What a Tabula Peutingeriana leg states, set beside what the map can say of
 * it. The only comparison available without a road network is the straight
 * line between the leg's two places — which the leg's own geometry already is
 * (`tabula_peutingeriana_roads.geom` is an endpoint pair, not a course). A
 * road cannot be shorter than that line, so a stated distance well under it
 * says that the figure or one of the two locations is off; a stated distance
 * over it is the ordinary case and says nothing about either.
 *
 * Not a verdict on the manuscript: the places are Talbert's and the
 * compiler's georeferencing, and a Roman mile is itself only known to a few
 * metres. Measuring against the Itiner-e road network is a separate step
 * (`documents/cross-data-feature-plan.md`, B2).
 */

/** The mile the comparison states. Estimates run 1,470–1,485 m; the spread is far below the noise in the locations. */
export const ROMAN_MILE_METRES = 1480

/**
 * A stated figure is called shorter than the line only when it falls more than
 * this share under it, so a rounded figure or a place located a little off does
 * not read as an error.
 */
export const SHORTER_THAN_LINE_TOLERANCE = 0.1

export type TabulaLegReading = 'shorter-than-line' | 'at-or-over-line'

export interface TabulaLegMeasure {
  statedMetres: number
  straightLineMetres: number
  /** Stated distance divided by the straight line; 1.2 reads "a fifth longer". */
  statedOverLine: number
  reading: TabulaLegReading
}

export const romanMilesToMetres = (miles: number): number => miles * ROMAN_MILE_METRES

export interface TabulaLegMeasureInput {
  /** `null` for the leg that carries no figure on the manuscript. */
  statedRomanMiles: number | null
  straightLineMetres: number
}

/** `null` when there is nothing to compare: no stated figure, or two places on the same point. */
export const measureTabulaLeg = (input: TabulaLegMeasureInput): TabulaLegMeasure | null => {
  const { statedRomanMiles, straightLineMetres } = input
  if (statedRomanMiles === null || statedRomanMiles <= 0) return null
  if (!Number.isFinite(straightLineMetres) || straightLineMetres <= 0) return null

  const statedMetres = romanMilesToMetres(statedRomanMiles)
  const statedOverLine = statedMetres / straightLineMetres
  const reading: TabulaLegReading =
    statedOverLine < 1 - SHORTER_THAN_LINE_TOLERANCE ? 'shorter-than-line' : 'at-or-over-line'

  return { statedMetres, straightLineMetres, statedOverLine, reading }
}
