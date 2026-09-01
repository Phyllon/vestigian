import { describe, expect, it } from 'vitest'
import { buildFieldKitGpx } from '../gpx'
import type { NotebookPlace } from '../notebook'

const place = (overrides: Partial<NotebookPlace> = {}): NotebookPlace => ({
  siteId: 1,
  slug: 'castellum-hoge-woerd',
  title: 'Castellum Hoge Woerd',
  category: 'fortification',
  countryCode: 'NL',
  modernPlace: 'Utrecht',
  latitude: 52.077_3,
  longitude: 5.036_1,
  visited: true,
  visitedOn: '2026-05-14',
  note: null,
  bookmarked: false,
  ...overrides,
})

const kit = (places: NotebookPlace[], authorName = 'Tester'): string =>
  buildFieldKitGpx({ places, authorName, generatedAt: new Date('2026-06-01T09:00:00.000Z') })

describe('buildFieldKitGpx', () => {
  it('writes a waypoint per place with coordinates in lat/lon order', () => {
    const gpx = kit([place()])
    expect(gpx).toContain('<wpt lat="52.077300" lon="5.036100">')
    expect(gpx).toContain('<name>Castellum Hoge Woerd</name>')
  })

  it('still produces a valid document with nothing in it', () => {
    const gpx = kit([])
    expect(gpx).toContain('<gpx')
    expect(gpx).toContain('</gpx>')
    expect(gpx).not.toContain('<wpt')
  })

  /**
   * The one failure this file exists to prevent. An unescaped `&` in an
   * imported title makes the whole document unparseable, and a GPS reports
   * that as "no waypoints" rather than as an error — so it looks like the
   * export silently produced nothing.
   */
  it('escapes XML in titles, notes and the author name', () => {
    const gpx = kit(
      [place({ title: 'Baths & Basilica', note: '<script>alert(1)</script> gate is 2m > tall' })],
      'Ada & Co',
    )
    expect(gpx).toContain('<name>Baths &amp; Basilica</name>')
    expect(gpx).toContain('&lt;script&gt;')
    expect(gpx).toContain('2m &gt; tall')
    expect(gpx).toContain('Ada &amp; Co')
    // No raw markup survived anywhere in the document.
    expect(gpx).not.toContain('<script>')
    expect(gpx).not.toMatch(/&(?!amp;|lt;|gt;)/)
  })

  it('distinguishes visited from to-visit by symbol', () => {
    expect(kit([place({ visited: true })])).toContain('<sym>Flag, Green</sym>')
    expect(kit([place({ visited: false, visitedOn: null })])).toContain('<sym>Flag, Blue</sym>')
  })

  it('describes an undated visit without inventing a date', () => {
    const gpx = kit([place({ visitedOn: null, modernPlace: null })])
    expect(gpx).toContain('<desc>Visited</desc>')
  })

  it('joins the date, the modern place and the note into one description', () => {
    const gpx = kit([place({ note: 'North gate still standing' })])
    expect(gpx).toContain('<desc>Visited 2026-05-14 — Utrecht — North gate still standing</desc>')
  })
})
