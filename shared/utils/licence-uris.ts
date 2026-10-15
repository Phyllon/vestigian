/**
 * Licence codes and labels onto the URL that identifies each licence.
 *
 * Both spellings in use are accepted — the database's SPDX-style codes
 * (`CC-BY-SA-3.0`, `sites.licence`) and the human labels the importers record
 * for a source (`CC BY 4.0`, `OGL v3`) — so one feed can name a licence the same
 * way whichever table the row came from. An RDF consumer follows the URL; a
 * label it cannot resolve is carried as plain text instead of being guessed at.
 *
 * `OGL` with no version is deliberately absent: the Open Government Licence has
 * had three versions and a bare label does not say which one applies.
 */
const OGL_V3 = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'

const LICENCES: Readonly<Record<string, { label: string; uri: string }>> = {
  'ODbL-1.0': { label: 'ODbL 1.0', uri: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  'CC0-1.0': { label: 'CC0 1.0', uri: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'CC-BY-3.0': { label: 'CC BY 3.0', uri: 'https://creativecommons.org/licenses/by/3.0/' },
  'CC-BY-4.0': { label: 'CC BY 4.0', uri: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC-BY-SA-3.0': { label: 'CC BY-SA 3.0', uri: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  'CC-BY-SA-4.0': { label: 'CC BY-SA 4.0', uri: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'CC-BY-NC-3.0': { label: 'CC BY-NC 3.0', uri: 'https://creativecommons.org/licenses/by-nc/3.0/' },
  // The licences image credits carry (vici.org's table, `scripts/import/vici-licences.ts`);
  // each URL was requested and answered 200 on 15 Oct 2026. Ported (jurisdiction) licences
  // keep their jurisdiction in the link, because the legal text differs.
  'CC-BY-2.0': { label: 'CC BY 2.0', uri: 'https://creativecommons.org/licenses/by/2.0/' },
  'CC-BY-2.5': { label: 'CC BY 2.5', uri: 'https://creativecommons.org/licenses/by/2.5/' },
  'CC-BY-2.5-IT': { label: 'CC BY 2.5 IT', uri: 'https://creativecommons.org/licenses/by/2.5/it/' },
  'CC-BY-SA-2.0': { label: 'CC BY-SA 2.0', uri: 'https://creativecommons.org/licenses/by-sa/2.0/' },
  'CC-BY-SA-2.0-DE': {
    label: 'CC BY-SA 2.0 DE',
    uri: 'https://creativecommons.org/licenses/by-sa/2.0/de/',
  },
  'CC-BY-SA-2.0-FR': {
    label: 'CC BY-SA 2.0 FR',
    uri: 'https://creativecommons.org/licenses/by-sa/2.0/fr/',
  },
  'CC-BY-SA-2.5': { label: 'CC BY-SA 2.5', uri: 'https://creativecommons.org/licenses/by-sa/2.5/' },
  'CC-BY-SA-3.0-DE': {
    label: 'CC BY-SA 3.0 DE',
    uri: 'https://creativecommons.org/licenses/by-sa/3.0/de/',
  },
  'CC-BY-SA-3.0-ES': {
    label: 'CC BY-SA 3.0 ES',
    uri: 'https://creativecommons.org/licenses/by-sa/3.0/es/',
  },
  'CC-BY-NC-SA-4.0': {
    label: 'CC BY-NC-SA 4.0',
    uri: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  },
  'CC-BY-NC-ND-4.0': {
    label: 'CC BY-NC-ND 4.0',
    uri: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  },
  'GFDL-1.3': { label: 'GFDL 1.3', uri: 'https://www.gnu.org/licenses/fdl-1.3.html' },
  'FAL-1.3': { label: 'FAL 1.3', uri: 'https://artlibre.org/licence/lal/en/' },
  'OGL-3.0': { label: 'OGL v3', uri: OGL_V3 },
  'OGL-v3': { label: 'OGL v3', uri: OGL_V3 },
}

const lookup = (codeOrLabel: string) => LICENCES[codeOrLabel.trim().replace(/\s+/g, '-')]

export const licenceUri = (codeOrLabel: string): string | null => lookup(codeOrLabel)?.uri ?? null

/** The conventional spelling of a known licence; anything else is returned as given. */
export const licenceLabel = (codeOrLabel: string): string =>
  lookup(codeOrLabel)?.label ?? codeOrLabel
