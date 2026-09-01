import type { NotebookPlace } from './notebook'

/**
 * The field kit: a notebook's places as GPX 1.1, for a handheld GPS, OsmAnd,
 * Organic Maps or a car.
 *
 * This exists because of what the project actually is. An atlas of sites
 * "recorded by the people who visit them" is used in two places — at a desk,
 * and standing in a field with no signal — and the app covers only the first.
 * Offline tiles are listed under "Not built" and are a large piece of work;
 * a waypoint file is small, works in every device already in someone's pocket,
 * and is the 90% of that need.
 *
 * Written by hand rather than through a library. The GPX that a waypoint list
 * needs is about forty lines of XML with one escaping rule, and every
 * maintained Node GPX package is a *parser* with generation bolted on. The
 * escaping is the part that matters and it is the part that is tested.
 */

/**
 * XML text escaping.
 *
 * Site titles and the visitor's own notes go into element text, and both are
 * free text this project did not write — an imported vici.org title contains
 * ampersands, and a note contains whatever its author typed. Unescaped, a
 * single `&` makes the whole file unparseable, which a GPS reports as "no
 * waypoints" rather than as an error. `<` and `&` are the two that must be
 * escaped in text content; `>` is escaped as well because a literal `]]>`
 * sequence is invalid, and it costs nothing.
 */
const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Coordinates at six decimals — about 11 cm, well past what a handheld resolves. */
const formatCoordinate = (value: number): string => value.toFixed(6)

export interface FieldKitInput {
  places: NotebookPlace[]
  /** Appears in the file's metadata so a device shows whose kit it is. */
  authorName: string
  generatedAt: Date
}

export const buildFieldKitGpx = (input: FieldKitInput): string => {
  const waypoints = input.places.map((place) => {
    /**
     * `sym` is what a device draws. GPX has no registered vocabulary — the
     * names below are Garmin's, which every consumer device and OsmAnd
     * understand, and an unknown one degrades to a default pin rather than
     * failing. "Flag, Blue" for somewhere still to go, "Flag, Green" for
     * somewhere already stood on: the distinction is the whole point of
     * carrying the file.
     */
    const symbol = place.visited ? 'Flag, Green' : 'Flag, Blue'

    const description = [
      place.visited ? `Visited${place.visitedOn ? ` ${place.visitedOn}` : ''}` : 'To visit',
      place.modernPlace,
      place.note,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' — ')

    return [
      `  <wpt lat="${formatCoordinate(place.latitude)}" lon="${formatCoordinate(place.longitude)}">`,
      `    <name>${escapeXml(place.title)}</name>`,
      `    <desc>${escapeXml(description)}</desc>`,
      `    <sym>${symbol}</sym>`,
      `    <type>${escapeXml(place.category)}</type>`,
      `  </wpt>`,
    ].join('\n')
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Vestigia" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    '    <name>Vestigia field kit</name>',
    `    <desc>${escapeXml(`${input.places.length} places from the notebook of ${input.authorName}.`)}</desc>`,
    `    <time>${input.generatedAt.toISOString()}</time>`,
    '  </metadata>',
    ...waypoints,
    '</gpx>',
    '',
  ].join('\n')
}
