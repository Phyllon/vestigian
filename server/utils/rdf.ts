import {
  DataFactory,
  Writer,
  type BlankNode,
  type NamedNode,
  type Quad,
  type Quad_Object,
} from 'n3'
import { licenceUri } from '#shared/utils/licence-uris'
import { toIsoYear, type FeatureClass, type LinkRelation } from '#shared/utils/linkedPlaces'

/**
 * Turtle for the reuse feeds, built with `n3` (the rdf.js writer) rather than by
 * concatenating strings: quoting, escaping and prefixing are exactly the parts a
 * hand-rolled serialiser gets subtly wrong, and a malformed graph is refused by
 * the consumer long after anybody is watching.
 *
 * **Standard vocabularies only; this project mints no terms.** A predicate in a
 * namespace nobody publishes would be a claim about a vocabulary that does not
 * exist. Where no standard term fits (a road's `certain` flag, a hoard's count),
 * the value rides as a schema.org `PropertyValue` — verbose, and honest.
 *
 * Geometry is GeoSPARQL `geo:asWKT`. WKT without a CRS IRI is CRS84, so
 * longitude comes first, as in the GeoJSON feeds.
 */

const { namedNode, literal, blankNode, quad } = DataFactory

// These are identifiers, not endpoints: the W3C and Dublin Core namespaces are `http://` IRIs and
// changing the scheme would name a different vocabulary.
/* eslint-disable sonarjs/no-clear-text-protocols */
const NAMESPACES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dcterms: 'http://purl.org/dc/terms/',
  dcat: 'http://www.w3.org/ns/dcat#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  geo: 'http://www.opengis.net/ont/geosparql#',
  gn: 'http://www.geonames.org/ontology#',
  schema: 'https://schema.org/',
} as const
/* eslint-enable sonarjs/no-clear-text-protocols */

type Prefix = keyof typeof NAMESPACES

const term = (prefix: Prefix, local: string): NamedNode => namedNode(NAMESPACES[prefix] + local)

const RELATION_PREDICATE: Record<LinkRelation, NamedNode> = {
  closeMatch: term('skos', 'closeMatch'),
  exactMatch: term('skos', 'exactMatch'),
  primaryTopicOf: term('foaf', 'isPrimaryTopicOf'),
  seeAlso: term('rdfs', 'seeAlso'),
}

export type RdfExtraValue = string | number | boolean | null

export interface RdfLink {
  relation: LinkRelation
  url: string
}

export interface RdfFeature {
  /** The record's own URI. `null` where the source has no stable key — a blank node, honestly. */
  iri: string | null
  label: string | null
  /** Free-text kind (`road`, `bridge`, `settlement`…), as a plain literal. */
  kind: string | null
  description: string | null
  /** A GeoNames feature class, written as `gn:featureClass gn:S`. */
  featureClass: FeatureClass | null
  period: { from: number | null; to: number | null } | null
  /** WKT, longitude first. */
  wkt: string
  /** A licence code or label; a URL when one is known, a `dcterms:rights` literal when not. */
  licence: string | null
  attribution: string | null
  source: { name: string; url: string | null } | null
  links: readonly RdfLink[]
  extra: Readonly<Record<string, RdfExtraValue>>
}

export interface RdfDataset {
  /** Names the dataset; also the target of every feature's `dcterms:isPartOf`. */
  iri: string
  title: string
  credit: string
  /** Licence codes or labels the dataset as a whole is offered under. */
  licences: readonly string[]
  /** Free-text terms that do not fit a licence URL (`descriptions CC BY-SA, metadata CC0`). */
  rights: string | null
  /** What was altered on the way in — ODbL §4.6(b). */
  alterations: string | null
  features: readonly RdfFeature[]
}

const typedLiteral = (value: string, prefix: Prefix, local: string): Quad_Object =>
  literal(value, term(prefix, local))

const extraValue = (value: string | number | boolean): Quad_Object => {
  if (typeof value === 'boolean') return typedLiteral(String(value), 'xsd', 'boolean')
  if (typeof value === 'number') {
    return typedLiteral(String(value), 'xsd', Number.isInteger(value) ? 'integer' : 'decimal')
  }
  return literal(value)
}

const licenceQuads = (subject: NamedNode | BlankNode, licence: string): Quad[] => {
  const uri = licenceUri(licence)
  return uri
    ? [quad(subject, term('dcterms', 'license'), namedNode(uri))]
    : [quad(subject, term('dcterms', 'rights'), literal(licence))]
}

/** A source is a URL when it has one, and its name as text when it does not. */
const sourceObject = (source: RdfFeature['source']): Quad_Object | null => {
  if (!source) return null
  return source.url ? namedNode(source.url) : literal(source.name)
}

const periodQuads = (
  subject: NamedNode | BlankNode,
  period: NonNullable<RdfFeature['period']>,
  nextBlankNode: () => BlankNode,
): Quad[] => {
  if (period.from === null && period.to === null) return []

  const node = nextBlankNode()
  const quads: Quad[] = [
    quad(subject, term('dcterms', 'temporal'), node),
    quad(node, term('rdf', 'type'), term('dcterms', 'PeriodOfTime')),
  ]
  if (period.from !== null) {
    quads.push(
      quad(node, term('dcat', 'startDate'), typedLiteral(toIsoYear(period.from), 'xsd', 'gYear')),
    )
  }
  if (period.to !== null) {
    quads.push(
      quad(node, term('dcat', 'endDate'), typedLiteral(toIsoYear(period.to), 'xsd', 'gYear')),
    )
  }
  return quads
}

const extraQuads = (
  subject: NamedNode | BlankNode,
  extra: RdfFeature['extra'],
  nextBlankNode: () => BlankNode,
): Quad[] =>
  Object.entries(extra).flatMap(([name, value]) => {
    if (value === null) return []

    const property = nextBlankNode()
    return [
      quad(subject, term('schema', 'additionalProperty'), property),
      quad(property, term('rdf', 'type'), term('schema', 'PropertyValue')),
      quad(property, term('schema', 'name'), literal(name)),
      quad(property, term('schema', 'value'), extraValue(value)),
    ]
  })

const featureQuads = (
  feature: RdfFeature,
  datasetIri: NamedNode,
  nextBlankNode: () => BlankNode,
): Quad[] => {
  const subject = feature.iri ? namedNode(feature.iri) : nextBlankNode()
  const geometry = nextBlankNode()
  const quads: Quad[] = [
    quad(subject, term('rdf', 'type'), term('geo', 'Feature')),
    quad(subject, term('dcterms', 'isPartOf'), datasetIri),
    quad(subject, term('geo', 'hasGeometry'), geometry),
    quad(geometry, term('rdf', 'type'), term('geo', 'Geometry')),
    quad(geometry, term('geo', 'asWKT'), typedLiteral(feature.wkt, 'geo', 'wktLiteral')),
  ]

  // Each optional statement is written only when the record has the fact.
  const optional: [NamedNode, Quad_Object | null][] = [
    [term('rdfs', 'label'), feature.label ? literal(feature.label) : null],
    [term('dcterms', 'type'), feature.kind ? literal(feature.kind) : null],
    [
      term('dcterms', 'description'),
      feature.description ? literal(feature.description, 'en') : null,
    ],
    [
      term('gn', 'featureClass'),
      feature.featureClass ? namedNode(NAMESPACES.gn + feature.featureClass) : null,
    ],
    [
      term('dcterms', 'bibliographicCitation'),
      feature.attribution ? literal(feature.attribution) : null,
    ],
    [term('dcterms', 'source'), sourceObject(feature.source)],
  ]
  for (const [predicate, object] of optional) {
    if (object) quads.push(quad(subject, predicate, object))
  }

  if (feature.period) quads.push(...periodQuads(subject, feature.period, nextBlankNode))
  if (feature.licence) quads.push(...licenceQuads(subject, feature.licence))
  for (const link of feature.links) {
    quads.push(quad(subject, RELATION_PREDICATE[link.relation], namedNode(link.url)))
  }
  quads.push(...extraQuads(subject, feature.extra, nextBlankNode))

  return quads
}

const datasetQuads = (dataset: RdfDataset): Quad[] => {
  const subject = namedNode(dataset.iri)
  const quads: Quad[] = [
    quad(subject, term('rdf', 'type'), term('dcat', 'Dataset')),
    quad(subject, term('dcterms', 'title'), literal(dataset.title)),
    quad(subject, term('dcterms', 'bibliographicCitation'), literal(dataset.credit)),
  ]

  for (const licence of dataset.licences) quads.push(...licenceQuads(subject, licence))
  if (dataset.rights) quads.push(quad(subject, term('dcterms', 'rights'), literal(dataset.rights)))
  if (dataset.alterations) {
    quads.push(quad(subject, term('dcterms', 'provenance'), literal(dataset.alterations)))
  }

  return quads
}

export const serialiseTurtle = (dataset: RdfDataset): Promise<string> => {
  const datasetNode = namedNode(dataset.iri)
  const writer = new Writer({ prefixes: NAMESPACES, format: 'text/turtle' })

  writer.addQuads(datasetQuads(dataset))
  // Labelled per document: the factory's own counter is process-wide, so its labels
  // would climb with every request this server has ever answered.
  let blankNodeCount = 0
  const nextBlankNode = (): BlankNode => blankNode(`b${blankNodeCount++}`)

  for (const feature of dataset.features) {
    writer.addQuads(featureQuads(feature, datasetNode, nextBlankNode))
  }

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
