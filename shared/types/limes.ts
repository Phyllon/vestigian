import type { BoundingBox, LonLat } from './site'

/**
 * What a stretch of frontier physically was.
 *
 * The distinction is drawn because the map would otherwise assert a wall where
 * there was a river. 'barrier' is a built work — a rampart, a palisade, a
 * ditch — recorded as linework by AWMC. 'river' is a frontier the empire held
 * along a watercourse and garrisoned from its bank; nothing was built along
 * most of it. 'notional' is the rest: a line on the sheet where the sources
 * agree a border ran, with no single structure to point at.
 */
export type LimesSegmentKind = 'barrier' | 'river' | 'notional'

/**
 * The marks the frontier is drawn with — a deliberately smaller vocabulary
 * than either source uses, because a reader following a frontier needs to tell
 * a tower from a fort at a glance and does not need twenty-two Pleiades terms.
 */
export type LimesMark = 'watchtower' | 'fortlet' | 'fort' | 'fortress' | 'camp'

export interface LimesSector {
  id: number
  slug: string
  name: string
  latinName: string | null
  summary: string | null
  pleiadesId: string | null
  minYear: number | null
  maxYear: number | null
  lengthMetres: number
  bounds: BoundingBox
}

/**
 * One installation on a sector, with where it falls along it.
 *
 * `offsetMetres` is measured along the sector's path and is what makes the roll
 * an itinerary rather than a list. `distanceMetres` is how far off that path it
 * sits, and is shown because a fort 8 km behind the line is a different claim
 * from one on it.
 */
export interface LimesInstallation {
  id: number
  title: string
  mark: LimesMark | null
  position: LonLat
  offsetMetres: number
  distanceMetres: number
  /** A contributed record, addressable at `/site/{slug}`. Null for a reference. */
  slug: string | null
  /** A Pleiades place, addressable at `pleiades.stoa.org/places/{id}`. Null for a record. */
  pleiadesId: string | null
}

/**
 * The two halves of a sector's roll, kept apart all the way to the screen.
 *
 * `records` are this atlas's own contributed sites; `references` are Pleiades
 * places. They are never merged into one array, because they carry different
 * licences and different standards of evidence, and a reader is owed the
 * difference. Each half names its own attribution.
 */
export interface LimesRoll {
  records: LimesInstallation[]
  references: LimesInstallation[]
  recordsAttribution: string
  referencesAttribution: string
}

export interface LimesSectorDetail extends LimesSector {
  roll: LimesRoll
}
