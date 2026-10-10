import type { ReferenceSource, SpotSourceId } from '#shared/types'

/**
 * Who a reference mark's record comes from and on what terms, for the line at
 * the foot of its info box.
 *
 * The map's own credit line (`*_ATTRIBUTION` in `useBasemapStyle.ts`) states the
 * same facts as an HTML string with wording of its own, and the two have to
 * agree. `reference-sources.test.ts` pins them together — every name, address
 * and licence here has to appear in the credit it corresponds to — so a
 * licence changed in one place fails the build until it is changed in the
 * other.
 */
export const REFERENCE_SOURCES: Record<SpotSourceId, ReferenceSource> = {
  pleiades: { name: 'Pleiades', url: 'https://pleiades.stoa.org', licence: 'CC BY 3.0' },
  wikidata: { name: 'Wikidata', url: 'https://www.wikidata.org', licence: 'CC0 1.0' },
  'ancient-ports': {
    name: 'Catalogue of Ancient Ports',
    url: 'https://www.ancientportsantiques.com/the-catalogue/',
    licence: 'CC BY 4.0',
  },
  chrr: {
    name: 'Coin Hoards of the Roman Republic',
    url: 'https://numismatics.org/chrr/',
    licence: 'CC BY-NC-SA 4.0',
  },
  awmc: {
    name: 'Ancient World Mapping Center',
    url: 'https://github.com/AWMC/geodata',
    licence: 'ODbL 1.0',
  },
  edh: {
    name: 'Epigraphic Database Heidelberg',
    url: 'https://edh.ub.uni-heidelberg.de/',
    licence: 'CC BY-SA 4.0',
  },
  'attic-inscriptions': {
    name: 'Attic Inscriptions Online',
    url: 'https://www.atticinscriptions.com/',
    licence: 'CC BY-SA 3.0',
  },
  nomisma: { name: 'Nomisma.org', url: 'https://nomisma.org', licence: 'CC BY 3.0' },
  isicily: { name: 'I.Sicily', url: 'https://isicily.org', licence: 'CC BY 4.0' },
  'hillforts-atlas': {
    name: 'Atlas of Hillforts',
    url: 'https://doi.org/10.5284/1118744',
    licence: 'CC BY 4.0',
  },
}
