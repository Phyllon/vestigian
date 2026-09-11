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
