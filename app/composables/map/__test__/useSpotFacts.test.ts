import { describe, expect, it } from 'vitest'
import de from '../../../../i18n/locales/de.json'
import en from '../../../../i18n/locales/en.json'
import es from '../../../../i18n/locales/es.json'
import fr from '../../../../i18n/locales/fr.json'
import it_ from '../../../../i18n/locales/it.json'
import nl from '../../../../i18n/locales/nl.json'
import type { SpotContext, SpotSourceId } from '#shared/types'
import { REFERENCE_SOURCES } from '#shared/utils/reference-sources'
import { buildSpotBodyHtml, buildSpotFactsHtml } from '../useSpotFacts'

/** English, resolved from the real catalogue — a key that does not exist throws rather than echoing. */
const translate = (key: string, params: Record<string, unknown> = {}): string => {
  const message = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)
  if (typeof message !== 'string') throw new Error(`missing i18n key ${key}`)
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
}

const countryName = (code: string | null): string | null =>
  ({ CH: 'Switzerland', GB: 'United Kingdom' })[code ?? ''] ?? null

const context = (overrides: Partial<SpotContext> = {}): SpotContext => ({
  nearestTown: { name: 'Frauenfeld', distanceMetres: 144 },
  countryCode: 'CH',
  elevationMetres: 417.7,
  extentSpans: [[-58, 409]],
  ...overrides,
})

const bodyRequest = (overrides: Partial<Parameters<typeof buildSpotBodyHtml>[0]> = {}) => ({
  context: context(),
  zoom: 12,
  latitude: 47.5565,
  periodYear: null,
  locale: 'en',
  t: translate,
  countryName,
  ...overrides,
})

const factsRequest = (overrides: Partial<Parameters<typeof buildSpotFactsHtml>[0]> = {}) => ({
  position: [8.8985, 47.5565] as [number, number],
  zoom: 12,
  sourceId: 'hillforts-atlas' as SpotSourceId,
  distanceMetres: null,
  locale: 'en',
  t: translate,
  ...overrides,
})

describe('the facts that need no network', () => {
  it('states the coordinate, latitude first', () => {
    expect(buildSpotFactsHtml(factsRequest())).toContain('47.5565, 8.8985')
  })

  it('states fewer decimals where the tapped coordinate is rougher', () => {
    const html = buildSpotFactsHtml(factsRequest({ zoom: 6 }))
    expect(html).toContain('47.56, 8.9')
    expect(html).not.toContain('47.5565')
  })

  it('credits the record’s source with its link and licence', () => {
    const html = buildSpotFactsHtml(factsRequest({ sourceId: 'hillforts-atlas' }))
    expect(html).toContain('href="https://doi.org/10.5284/1118744"')
    expect(html).toContain('Atlas of Hillforts')
    // Non-breaking spaces: the licence name must not wrap across two lines.
    expect(html).toContain('CC\u00a0BY\u00a04.0')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it.each(Object.keys(REFERENCE_SOURCES) as SpotSourceId[])(
    'renders a source line for %s',
    (id) => {
      const html = buildSpotFactsHtml(factsRequest({ sourceId: id }))
      expect(html).toContain(REFERENCE_SOURCES[id].name.replace('&', '&amp;'))
      expect(html).not.toContain('undefined')
    },
  )

  it('omits the distance until there is a usable fix', () => {
    expect(buildSpotFactsHtml(factsRequest())).not.toContain('from you')
    expect(buildSpotFactsHtml(factsRequest({ distanceMetres: 3400 }))).toContain('3.4 km from you')
  })

  it('leaves the derived rows to a collapsed disclosure the browser fills in later', () => {
    const html = buildSpotFactsHtml(factsRequest())
    expect(html).toContain('<details data-spot-details')
    expect(html).not.toContain('<details data-spot-details open')
    expect(html).toContain('data-spot-body')
    expect(html).toContain('About this spot')
  })

  it('escapes anything a translation could smuggle in', () => {
    const html = buildSpotFactsHtml(
      factsRequest({
        t: (key) => (key === 'spotFacts.summary' ? '<img src=x onerror=alert(1)>' : 'x'),
      }),
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('&#60;img')
  })
})

describe('the derived rows', () => {
  it('names the town, how far it is, and the country', () => {
    expect(buildSpotBodyHtml(bodyRequest())).toContain('Near Frauenfeld (140 m), Switzerland')
  })

  it('names only the country when no town is close enough', () => {
    const html = buildSpotBodyHtml(bodyRequest({ context: context({ nearestTown: null }) }))
    expect(html).toContain('Country: Switzerland')
    expect(html).not.toContain('Near')
  })

  it('says nothing about place at sea', () => {
    const html = buildSpotBodyHtml(
      bodyRequest({ context: context({ nearestTown: null, countryCode: null }) }),
    )
    expect(html).not.toContain('Near')
    expect(html).not.toContain('Country')
  })

  it('rounds elevation to what the tapped coordinate supports', () => {
    expect(buildSpotBodyHtml(bodyRequest({ zoom: 12 }))).toContain('Elevation about 420 m')
    expect(
      buildSpotBodyHtml(bodyRequest({ zoom: 5, context: context({ elevationMetres: 417.7 }) })),
    ).toContain('Elevation about 400 m')
  })

  it('writes a negative elevation as one', () => {
    expect(
      buildSpotBodyHtml(bodyRequest({ context: context({ elevationMetres: -208 }) })),
    ).toContain('Elevation about -210 m')
  })

  it('omits elevation outside the terrain archive', () => {
    expect(
      buildSpotBodyHtml(bodyRequest({ context: context({ elevationMetres: null }) })),
    ).not.toContain('Elevation')
  })

  it('answers inside or outside for the year the scrubber is on', () => {
    expect(buildSpotBodyHtml(bodyRequest({ periodYear: 117 }))).toContain(
      'Inside the Roman state’s recorded extent in AD 117',
    )
    expect(buildSpotBodyHtml(bodyRequest({ periodYear: 476 }))).toContain(
      'Outside the Roman state’s recorded extent in AD 476',
    )
  })

  it('gives the whole span when the scrubber is off', () => {
    expect(buildSpotBodyHtml(bodyRequest({ periodYear: null }))).toContain(
      'recorded extent: 58 BC – AD 409',
    )
  })

  it('says so when the state never reached the spot', () => {
    expect(buildSpotBodyHtml(bodyRequest({ context: context({ extentSpans: [] }) }))).toContain(
      'in every period',
    )
  })

  it('does not call a failed extent lookup "never inside"', () => {
    const html = buildSpotBodyHtml(bodyRequest({ context: context({ extentSpans: null }) }))
    expect(html).not.toContain('recorded extent')
    expect(html).not.toContain('OpenHistoricalMap')
  })

  it('credits the datasets behind the rows it shows', () => {
    const html = buildSpotBodyHtml(bodyRequest())
    for (const name of ['GeoNames', 'Natural Earth', 'Mapterhorn', 'OpenHistoricalMap']) {
      expect(html).toContain(name)
    }
    expect(html).toContain('CC\u00a0BY\u00a04.0')
  })

  it('shows nothing — not even a credit — when there is nothing to show', () => {
    const html = buildSpotBodyHtml(
      bodyRequest({
        context: {
          nearestTown: null,
          countryCode: null,
          elevationMetres: null,
          extentSpans: null,
        },
      }),
    )
    expect(html).toBe('')
  })

  it('escapes a town name', () => {
    const html = buildSpotBodyHtml(
      bodyRequest({ context: context({ nearestTown: { name: '<b>x</b>', distanceMetres: 10 } }) }),
    )
    expect(html).not.toContain('<b>')
  })
})

describe('the translations of the block', () => {
  const placeholders = (message: string): string[] =>
    [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()

  const catalogues = { de, fr, es, it: it_, nl }

  it.each(Object.entries(catalogues))(
    '%s has every key the English block has, with the same placeholders',
    (_, catalogue) => {
      const english = en.spotFacts as Record<string, string>
      const other = (catalogue as { spotFacts?: Record<string, string> }).spotFacts
      expect(other).toBeDefined()
      expect(Object.keys(other!).sort()).toEqual(Object.keys(english).sort())
      for (const [key, message] of Object.entries(english)) {
        expect(placeholders(other![key]!)).toEqual(placeholders(message))
      }
    },
  )
})
