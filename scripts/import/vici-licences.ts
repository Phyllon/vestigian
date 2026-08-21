/**
 * vici.org's licenses table, verified against the October 2023 dump and
 * resolved to the spellings the application uses. Shared by the record import
 * and the image mirror so a licence can never mean two things in one pipeline.
 *
 * Two rows in the dump carry typos — 'CC BT 2.5 IT' and 'CC BY-NC-DD 4.0' —
 * read here as the licences they plainly mean. Id 15 does not exist.
 */
export const LICENCE_BY_ID: Record<number, string> = {
  1: 'CC0-1.0',
  2: 'CC0-1.0',
  3: 'CC-BY-3.0',
  4: 'CC-BY-SA-3.0',
  5: 'ARR',
  6: 'CC-BY-SA-2.0-DE',
  7: 'CC-BY-2.0',
  8: 'CC-BY-SA-2.0',
  9: 'GFDL-1.3',
  10: 'CC-BY-SA-2.0-FR',
  11: 'CC-BY-SA-2.5',
  12: 'CC-BY-2.5',
  13: 'CC-BY-2.5-IT',
  14: 'FAL-1.3',
  16: 'CC-BY-SA-3.0-ES',
  17: 'CC-BY-SA-3.0-DE',
  18: 'CC-BY-SA-4.0',
  19: 'CC-BY-4.0',
  20: 'CC-BY-NC-SA-4.0',
  21: 'CC-BY-NC-ND-4.0',
}

export const UNKNOWN_LICENCE = 'UNKNOWN'

/**
 * An id with no entry becomes UNKNOWN rather than the default licence. The
 * whole point of the column is that a wrong licence is worse than no licence.
 */
export const resolveLicence = (licenceId: number | null | undefined): string =>
  licenceId === null || licenceId === undefined
    ? UNKNOWN_LICENCE
    : (LICENCE_BY_ID[licenceId] ?? UNKNOWN_LICENCE)

export const isPublishableLicence = (licence: string): boolean =>
  licence !== UNKNOWN_LICENCE && licence !== 'ARR'
