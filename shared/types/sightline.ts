import type { LonLat } from './site'

/**
 * The three heights a tower's guard platform is calculated at. No tower
 * survives to its original height, so the figure is a range with a middle, and
 * the interface shows all three rather than pretending to one.
 */
export const SIGHTLINE_VARIANTS = ['low', 'central', 'high'] as const

export type SightlineVariant = (typeof SIGHTLINE_VARIANTS)[number]

/** Eight points, clockwise from north — what a sentry would have said. */
export const COMPASS_POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const

export type CompassPoint = (typeof COMPASS_POINTS)[number]

export interface SightlineReach {
  metres: number
  /** Degrees clockwise from north. */
  bearing: number
}

export interface SightlineSector {
  compass: CompassPoint
  /** The middle of what the rays in this sector saw before something stood in the way. */
  medianMetres: number
  /** The shortest of them: where the view is narrowest inside the sector. */
  shortestMetres: number
}

/** One calculated view, from one assumed height. */
export interface TowerSightlineVariant {
  /** Eye height above the ground at the tower, metres. */
  eyeHeightMetres: number
  /**
   * Distance to the first thing that stood in the way along each ray, metres.
   * Ray 0 points north and they run clockwise, so index × 360 / length is the
   * bearing. A ray that saw all the way is the calculation radius.
   */
  unbrokenMetres: number[]
  /** Ground inside the radius seen without a break from the tower, in km². */
  unbrokenAreaSquareKm: number
  /** Ground inside the radius that is seen at all, including beyond a rise, in km². */
  visibleAreaSquareKm: number
  longestUnbroken: SightlineReach
  farthestVisible: SightlineReach
  sectors: SightlineSector[]
}

/**
 * Ground seen, cell by cell, in polar form: `columns` wedges of 360 / columns
 * degrees clockwise from north, each `binCount` bins deep of `binMetres`. One bit
 * per cell (1 = seen), bit `column * binCount + bin`, least significant first,
 * base64 — 4.5 KB for a ten-kilometre view in one-degree, hundred-metre cells.
 *
 * It carries what the unbroken outline cannot: the ground that comes back into
 * view beyond a rise. A tower on a rim has a short unbroken view and may still
 * see a whole valley side.
 */
export interface SeenGrid {
  columns: number
  binMetres: number
  binCount: number
  data: string
}

export interface TowerSightProfile {
  /** Metres from this tower, ascending. */
  distances: number[]
  /** The terrain between the two, with the earth's curvature added, metres. */
  terrain: number[]
  /** The straight line from eye to eye, metres. */
  sight: number[]
}

/** Another tower, and whether the two could see one another. */
export interface TowerNeighbourSight {
  id: number
  slug: string
  title: string
  position: LonLat
  distanceMetres: number
  /** Degrees clockwise from north, from this tower to that one. */
  bearing: number
  /** Whether the line is clear, at each assumed height. */
  isClear: Record<SightlineVariant, boolean>
  /**
   * At the middle height: how far the sight line clears the terrain at its
   * closest, in metres. Negative when it does not, and then it is how far the
   * terrain stands above the line.
   */
  minimumClearanceMetres: number
  /** At the middle height: where along the line the terrain is highest against it. */
  tightestAtMetres: number
  profile: TowerSightProfile
}

export interface TowerSightlines {
  siteId: number
  position: LonLat
  groundElevationMetres: number
  /** The frontier sector the tower stands on, for the text. */
  sector: { slug: string; name: string }
  /** Height of the guard platform, per variant; the eye is `eyeAbovePlatformMetres` above it. */
  platformMetres: Record<SightlineVariant, number>
  eyeAbovePlatformMetres: number
  /** What the target is taken to be: a standing person's height. */
  targetHeightMetres: number
  radiusMetres: number
  /** Fraction of the samples that had terrain under them. Below 1 means tiles were missing. */
  terrainCoverage: number
  /**
   * Whether the elevation tiles here are most likely a bare-earth survey. False
   * where the only open source is a surface model, in which case woodland and
   * buildings stand in the calculation as ground. A judgement from the country,
   * not a measurement of the tile.
   */
  isBareEarthLikely: boolean
  variants: Record<SightlineVariant, TowerSightlineVariant>
  /** Everything seen from the middle platform — the unbroken view and what lies beyond a rise. */
  viewGrid: SeenGrid
  /**
   * The same relation read the other way: where a person on the ground could see
   * the tower. By reciprocity this is a view from the tower's top at the person's
   * eye height, which is how it is calculated.
   */
  seenFrom: {
    /** Overall height of the tower, per variant: the platform and its roof. */
    towerMetres: Record<SightlineVariant, number>
    /** A person's eye above the ground, looking at the tower. */
    onlookerEyeMetres: number
    visibleAreaSquareKm: Record<SightlineVariant, number>
    farthestVisible: SightlineReach
    grid: SeenGrid
  }
  neighbours: TowerNeighbourSight[]
}

/** One level stretch of a line out from the tower: in view, or hidden from the platform. */
export interface RaySegment {
  fromMetres: number
  toMetres: number
  isSeen: boolean
}

/** A point on the ground along a ray, against the tower's feet and eyes. */
export interface RayLandmark {
  atMetres: number
  groundMetres: number
  /** Metres above (negative: below) the ground the tower stands on. */
  aboveTowerGroundMetres: number
  /** Metres above (negative: below) the sentry's eyes. */
  aboveEyeMetres: number
}

/** The longest stretch of a line the platform cannot see, and what casts it. */
export interface RayDeadGround {
  fromMetres: number
  toMetres: number
  /** The crest whose shadow it is: the steepest ground from the eyes before it begins. */
  crest: RayLandmark
  /** Where ground first comes back into view beyond it; null when it never does. */
  reappearsAt: RayLandmark | null
}

/**
 * The ground along one compass line out from the tower, against the eyes: what
 * is seen, what is hidden, and what does the hiding. Calculated at the middle
 * estimate.
 */
export interface TowerRaySection {
  siteId: number
  compass: CompassPoint
  bearing: number
  radiusMetres: number
  groundElevationMetres: number
  eyeElevationMetres: number
  /** Metres from the tower, one per sample. */
  distances: number[]
  /** Metres above sea level, one per sample. */
  ground: number[]
  segments: RaySegment[]
  /** The crest that ends the first unbroken stretch; null when nothing does. */
  firstBlock: RayLandmark | null
  /** The longest hidden stretch on the line; null when none is hidden. */
  deadGround: RayDeadGround | null
  /** The highest ground on the line, wherever it is. */
  highest: RayLandmark
  seenMetres: number
  /** Hidden length short of the farthest ground seen: the dead ground. */
  hiddenMetres: number
  farthestSeenMetres: number
}

export interface ElevationProfileStats {
  lengthMetres: number
  startMetres: number
  endMetres: number
  lowest: { metres: number; atMetres: number }
  highest: { metres: number; atMetres: number }
  /** Climbing and descending along the line, ignoring wobbles under the noise floor. */
  ascentMetres: number
  descentMetres: number
  /** The start-to-end slope as a percentage; negative runs downhill. */
  averageGradientPercent: number
  /** The steepest stretch of at least `gradientWindowMetres`, as a signed percentage. */
  steepestGradientPercent: number
  steepestAtMetres: number
  gradientWindowMetres: number
}

export interface ElevationProfile {
  tracingId: number
  /** Metres from the start of the line, one per sample. */
  distances: number[]
  /** Metres above sea level, one per sample. */
  elevations: number[]
  /** Longitude and latitude of each sample, so a cursor on the profile can be put on the map. */
  path: [number, number][]
  /** Sample indexes where a separate part of the line begins; empty for a single run. */
  breaks: number[]
  stats: ElevationProfileStats
  /** Fraction of the samples that had terrain under them. */
  terrainCoverage: number
}

/** A tower as the sector analysis sees it, and how it is linked. */
export interface SectorWatchTower {
  id: number
  slug: string
  title: string
  position: LonLat
  /** Other towers within sight range that it can see, at the middle estimate. */
  clearLinkCount: number
}

/** A stretch between two neighbouring towers that no chain of clear links crosses. */
export interface SectorWatchBreak {
  lengthMetres: number
  /** Where its middle lies, for a camera to fly to. */
  position: LonLat
  fromSiteId: number
  fromTitle: string
  toSiteId: number
  toTitle: string
}

/** A stretch of the line that lies within reach of a tower and that no tower overlooks. */
export interface SectorWatchBlind {
  lengthMetres: number
  position: LonLat
}

/**
 * How far apart two neighbouring towers stand against how far apart they could
 * have stood and still been in sight of each other, at each estimate of the
 * height. See `readSpanReach` in `shared/utils/tower-spacing.ts`.
 */
export interface TowerSpacingPair {
  fromSiteId: number
  fromTitle: string
  toSiteId: number
  toTitle: string
  position: LonLat
  /** The distance the two towers actually stand apart. */
  lengthMetres: number
  /**
   * The farthest along the same line from the first tower that a tower of the
   * same height would still have been in sight, ground unbroken out to it.
   * Shorter than `lengthMetres` when the two cannot see each other.
   */
  reachMetres: Record<SightlineVariant, number>
  /** True where the reach ran to the end of the calculation, so it is "at least". */
  isReachCapped: Record<SightlineVariant, boolean>
  /** The middle estimate: could the two see each other at all? */
  isInSight: boolean
}

export interface TowerSpacingBin {
  /** Lower edge of the bin, as a ratio of actual spacing to reach; each bin is a tenth wide. */
  fromRatio: number
  count: number
}

/**
 * The spacing of a sector's towers read against the ground. A ratio of 1 is
 * towers standing as far apart as the ground allowed; 0.5 is half that. It says
 * how the posts sit against the relief — it does not say why they sit there.
 */
export interface TowerSpacingSummary {
  /** Neighbouring pairs (the chain's spanning edges within range). */
  pairCount: number
  /** Pairs read — the ones where the terrain under the line was available. */
  readCount: number
  /** Pairs left out: the terrain under the line was not available, or the two records are one post. */
  droppedCount: number
  /** False when too few pairs were read to say anything about the sector. */
  isReadable: boolean
  /** Median of actual spacing ÷ reach, at each estimate of the height. */
  medianRatio: Record<SightlineVariant, number>
  /** Pairs not in sight of each other at the middle estimate: spacing beyond the ground's allowance. */
  outOfSightCount: number
  /** Pairs whose reach ran to the end of the calculation at the middle estimate. */
  cappedCount: number
  /** Histogram of the middle-estimate ratio over the pairs in sight of each other; 1.0 falls in the last bin. */
  bins: TowerSpacingBin[]
  /** Pairs standing closest to their reach, then the farthest from it. */
  nearestToLimit: TowerSpacingPair[]
  farthestFromLimit: TowerSpacingPair[]
  /** Median actual spacing and median reach at the middle estimate, in metres. */
  medianLengthMetres: number
  medianReachMetres: number
}

/**
 * What the towers of one frontier sector, taken together, could see — worked
 * out ahead of time by `pnpm sightlines:build` because it needs a viewshed from
 * every tower and a sight line between every pair near enough to try.
 *
 * Two different questions, kept apart. **The chain**: could a signal pass from
 * tower to tower along the line? The towers are joined to their neighbours (a
 * spanning tree: each to its nearest, which is the line itself), and a stretch is
 * covered when its two ends are joined by clear links — directly, or round a
 * post in a hollow by a longer link. A break is a stretch nothing crosses.
 * **The watch**: is the ground — the frontier line itself, and the country
 * either side — overlooked by at least one tower, or by three?
 *
 * Both are about the towers *recorded*. A sector's line beyond the reach of any
 * recorded tower is not "blind"; it is unrecorded, and is left out of the shares.
 */
export interface SectorWatchSummary {
  sectorSlug: string
  modelVersion: number
  computedAt: string
  /** Towers after twin records (a timber and a stone phase of one post) are folded into one. */
  towerCount: number
  foldedRecordCount: number
  /** Towers left out because the terrain under them could not be read. */
  skippedTowerCount: number
  /** Metres of neighbour-to-neighbour stretches the chain shares are measured over. */
  chainLengthMetres: number
  meanSpacingMetres: number
  /** Pairs within `linkRangeMetres` that were tried. */
  pairCount: number
  linkRangeMetres: number
  /** Neighbouring towers farther apart than the range: gaps in the records, not tried. */
  recordGapCount: number
  /** Share of the chain length that clear links cross, at each estimate of the height. */
  chainCoverage: Record<SightlineVariant, number>
  chainBreaks: SectorWatchBreak[]
  /** Metres of the sector's line lying within reach of a tower: what the next shares are of. */
  lineLengthMetres: number
  /** Share of that line seen by at least one tower, and by three or more. */
  lineSeenShare: number
  lineWatchedShare: number
  blindStretches: SectorWatchBlind[]
  /** Absent on answers worked out before the spacing reading existed. */
  spacing?: TowerSpacingSummary
  overlookedAreaSquareKm: number
  watchedAreaSquareKm: number
  towers: SectorWatchTower[]
}
