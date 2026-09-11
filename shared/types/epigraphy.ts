/**
 * Mirrored EDH inscriptions (`server/database/schema/epigraphy.ts`,
 * `scripts/import/12-edh-inscriptions.ts`) — imported reference material,
 * never a contributed record, and carrying no slug of its own: `edhId`
 * ('HD000001') is the natural, stable identifier and what `/inscriptions/*`
 * routes on.
 */
export interface InscriptionEditionToken {
  text: string
  abbr?: string
  expansion?: string
}

export interface InscriptionEditionLine {
  line: number
  tokens: InscriptionEditionToken[]
}

export interface InscriptionPosition {
  lon: number
  lat: number
}

export interface InscriptionSummary {
  edhId: string
  title: string
  inscriptionType: string | null
  objectType: string | null
  material: string | null
  decorated: boolean
  notBefore: number | null
  notAfter: number | null
  textLanguage: string | null
  position: InscriptionPosition | null
}

/**
 * A photograph EDH holds of this inscription — metadata only, never mirrored
 * bytes. Every one of the 43,199 real `image_metadata` records carries the
 * Europeana rights code `rr-f` ("Rights Reserved – Free Access", checked
 * against Europeana's own page for it: browsing only, not reproduction),
 * not an open licence, so this is a link-out card, not a gallery image.
 */
export interface InscriptionPhoto {
  edhPhotoId: string
  rightsHolder: string | null
  sourceUrl: string
}

export interface InscriptionDetail extends InscriptionSummary {
  decorationNote: string | null
  heightCm: number | null
  widthCm: number | null
  depthCm: number | null
  letterHeightCm: string | null
  originPlaceName: string | null
  provinceName: string | null
  datingMethod: string | null
  findModernPlace: string | null
  findModernCountryCode: string | null
  textDiplomatic: string | null
  textEdition: InscriptionEditionLine[] | null
  commentary: string | null
  bibliography: string[] | null
  sourceUrl: string
  licence: string
  /** Capped — some inscriptions carry over a hundred photograph records. */
  photos: InscriptionPhoto[]
  photoCount: number
  /** The Roman state(s) whose mapped extent covers this inscription's own
   *  dating range (`findEmpireStatesForDating`) — empty when undated or when
   *  the range falls outside the period scrubber's 509 BCE–476 CE coverage. */
  empireStates: string[]
  /**
   * `title`/`commentary` only — never the carved text itself, which is a
   * primary source, not prose. `language` is what they're actually in after
   * translation, if any; equal to `originalLanguage` ('de', EDH's own
   * scholarly metadata language) when nothing was translated.
   */
  language: string
  originalLanguage: string
  isMachineTranslated: boolean
}

/** One row of `GET /api/sites/:id/inscriptions` or `.../tracings/:id/inscriptions`. */
export interface NearbyInscription {
  edhId: string
  title: string
  inscriptionType: string | null
  distanceMetres: number
}

/** A frequency-ranked entry in the formulary — an abbreviation and its
 *  expansion, and how many mirrored inscriptions carry it. */
export interface InscriptionFormulaEntry {
  abbr: string
  expansion: string | null
  count: number
  exampleEdhId: string
}

/**
 * Attic Inscriptions Online (`server/database/schema/epigraphy.ts`,
 * `scripts/import/20-attic-inscriptions.ts`) — a second, smaller corpus,
 * genuinely separate from the EDH mirror above: Classical/Hellenistic
 * Athenian decrees, not Roman-imperial epigraphy. `aioKey` ('AIO_5') is the
 * natural identifier, what `/inscriptions/attic/*` routes on.
 */
export interface AtticTranslationSegment {
  type: 'text' | 'break' | 'lineNumber' | 'place' | 'gloss' | 'note'
  text?: string
  pleiadesId?: string
  number?: number
}

export interface AtticFootnote {
  number: number
  text: string
}

export interface AtticPlaceRef {
  text: string
  pleiadesId: string | null
}

export interface AtticFindspot extends AtticPlaceRef {
  label: string | null
}

export interface AtticImageCredit {
  collection: string
  url: string
}

export interface AtticReference {
  source: string
  reference: string
  externalLinks: string[]
  isTranslationSource?: boolean
}

export interface AtticInscriptionSummary {
  aioKey: string
  title: string
  primarySource: string | null
  dateText: string | null
  notBefore: number | null
  notAfter: number | null
  monumentType: string | null
  inscriptionType: string | null
  position: InscriptionPosition | null
}

export interface AtticInscriptionDetail extends AtticInscriptionSummary {
  translators: string[] | null
  translationEdition: AtticTranslationSegment[] | null
  footnotes: AtticFootnote[] | null
  originalLocation: AtticPlaceRef | null
  findspots: AtticFindspot[] | null
  imageCredits: AtticImageCredit[] | null
  references: AtticReference[] | null
  sourceUrl: string
  licence: string
}

/** One row of `GET /api/sites/:id/attic-inscriptions` or
 *  `.../tracings/:id/attic-inscriptions` — the same cross-referencing
 *  synergy the EDH corpus already gets, reused for the second corpus. */
export interface NearbyAtticInscription {
  aioKey: string
  title: string
  monumentType: string | null
  distanceMetres: number
}
