import type { SiteCategory } from '../types'

/**
 * Pleiades feature types, read into the vocabulary this atlas already draws.
 *
 * Pleiades describes a place with a comma-separated list from a vocabulary of
 * several hundred terms — "settlement", "settlement, archaeological-site",
 * "unlocated, settlement", "temple-2". Nothing can draw that directly, so it is
 * collapsed once, at import, into the same nine categories the contributed
 * records use. AWMC does the same thing for their own viewer and calls the
 * result `AWMCI_icon`; this is that idea against Vestigia's marks rather than
 * theirs, so one key explains the whole map.
 *
 * **A null answer is an ordinary one.** Rivers, capes, mountains, peoples and
 * regions are in Pleiades and belong on the sheet, but they are not places with
 * a mark — they get their name and nothing else. Inventing a symbol for them
 * would be the map claiming a site where the source records a landscape.
 */
const PLEIADES_CATEGORIES: Record<string, SiteCategory> = {
  // Where people lived.
  settlement: 'settlement',
  'settlement-modern': 'settlement',
  city: 'settlement',
  town: 'settlement',
  village: 'settlement',
  vicus: 'settlement',
  polis: 'settlement',

  // Anything built to be held. `tower` is here rather than under building for
  // the same reason a watchtower is a fortification and not architecture.
  fort: 'fortification',
  fortification: 'fortification',
  tower: 'fortification',
  wall: 'fortification',
  gate: 'fortification',
  citadel: 'fortification',
  camp: 'fortification',
  acropolis: 'fortification',

  temple: 'sanctuary',
  sanctuary: 'sanctuary',
  church: 'sanctuary',
  shrine: 'sanctuary',
  altar: 'sanctuary',
  oracle: 'sanctuary',
  synagogue: 'sanctuary',
  monastery: 'sanctuary',

  cemetery: 'burial',
  tomb: 'burial',
  tumulus: 'burial',
  necropolis: 'burial',
  mausoleum: 'burial',
  'burial-chamber': 'burial',

  // Built to carry something — water, traffic, a boundary marker.
  bridge: 'infrastructure',
  station: 'infrastructure',
  road: 'infrastructure',
  aqueduct: 'infrastructure',
  canal: 'infrastructure',
  port: 'infrastructure',
  harbor: 'infrastructure',
  harbour: 'infrastructure',
  dam: 'infrastructure',
  well: 'infrastructure',
  cistern: 'infrastructure',
  fountain: 'infrastructure',
  milestone: 'infrastructure',
  lighthouse: 'infrastructure',

  villa: 'villa',
  estate: 'villa',
  farm: 'villa',
  farmstead: 'villa',

  mine: 'production',
  quarry: 'production',
  kiln: 'production',
  'production-site': 'production',
  workshop: 'production',
  saltworks: 'production',

  'archaeological-site': 'findspot',
  findspot: 'findspot',
  hoard: 'findspot',
  'find-spot': 'findspot',

  // Recorded, and nothing claimed beyond that. The urban amenities land here
  // because this atlas has no category for them and inventing one to hold a
  // bath house would say more about the vocabulary than about the place.
  theatre: 'other',
  theater: 'other',
  amphitheatre: 'other',
  bath: 'other',
  baths: 'other',
  forum: 'other',
  stadium: 'other',
  circus: 'other',
  'public-building': 'other',
  building: 'other',
  monument: 'other',
  arch: 'other',
}

/**
 * Pleiades distinguishes a second attested feature of the same kind on one
 * place with a numeric suffix — `temple-2`, `fort-2`, `mine-2`. It is the same
 * kind of thing and gets the same mark.
 */
const stripOrdinal = (term: string): string => term.replace(/-\d+$/, '')

/**
 * The first term that maps wins, which is what makes "unlocated, settlement"
 * a settlement and "settlement, archaeological-site" a settlement rather than a
 * findspot: Pleiades writes the defining type first and qualifies it after.
 */
export const resolvePlaceCategory = (featureTypes: string | null): SiteCategory | null => {
  if (!featureTypes) return null

  for (const term of featureTypes.split(',')) {
    const match = PLEIADES_CATEGORIES[stripOrdinal(term.trim().toLowerCase())]
    if (match) return match
  }

  return null
}

/**
 * Pleiades records how well it knows where a place is. 'precise' and 'rough'
 * are positions; 'unlocated' and 'related' are not — the first has no location
 * at all and the second borrows a neighbour's, so the representative point is a
 * filing convenience rather than a claim about the ground. Drawing either would
 * put a mark where the source says there is none.
 */
export const isLocatedPrecisely = (locationPrecision: string | null): boolean =>
  locationPrecision === 'precise' || locationPrecision === 'rough'
