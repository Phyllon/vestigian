import type { ZodTypeAny } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

/**
 * Turns the zod schemas every route already validates against into the OpenAPI
 * document Nitro assembles from each route's `defineRouteMeta`.
 *
 * Deliberately thin: the schema is derived from the same `z.object(...)` a
 * handler calls `.parse` on, not retyped by hand next to it. A route whose
 * validation changes and whose documentation does not is worse than no
 * documentation, because it is wrong with confidence.
 *
 * Everything here returns `any`. Nitro's `NitroRouteMeta['openAPI']` is typed
 * against its own unexported OpenAPI 3.1 types, whose `SchemaObject.type` is a
 * literal union rather than `string` — there is no name to import and match
 * structurally, only `defineRouteMeta`'s inferred parameter type. `any` is the
 * honest type for "a JSON Schema fragment shaped however the input schema
 * shapes it", not a shortcut around one that exists.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJsonSchema = (schema: ZodTypeAny): any =>
  zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' })

/** A JSON request body, from the zod schema a handler already parses with. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bodyFromSchema = (schema: ZodTypeAny, description?: string): any => ({
  required: true,
  description,
  content: { 'application/json': { schema: toJsonSchema(schema) } },
})

/**
 * Query or path parameters, from a `z.object({...})` shape.
 *
 * `getValidatedQuery`/`getValidatedRouterParams` always validate a flat
 * object in this codebase, so the top-level `properties` map is exactly the
 * parameter list — no schema ever nests here.
 */
export const paramsFromSchema = (
  schema: ZodTypeAny,
  location: 'query' | 'path',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] => {
  const json = toJsonSchema(schema) as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const required = new Set(json.required ?? [])
  return Object.entries(json.properties ?? {}).map(([name, paramSchema]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.has(name),
    schema: paramSchema,
  }))
}

/** The shape every error response in this app actually returns (`createError`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const errorResponse = (description: string): any => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'integer' },
          statusMessage: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
})

/** Common error responses, added only where the route can actually produce them. */
export const COMMON_RESPONSES = {
  400: errorResponse('The request failed validation.'),
  401: errorResponse('No session, or the session has expired.'),
  403: errorResponse('Signed in, but not permitted to do this.'),
  404: errorResponse('Nothing at this id or slug.'),
  429: errorResponse('Rate limit exceeded for this route.'),
}

/** A JSON success response built from a TypeScript-only return type has no schema to derive from — described in words instead. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const jsonResponse = (description: string): any => ({
  description,
  content: { 'application/json': { schema: { type: 'object' } } },
})

/** The z/x/y path segments every tile route shares. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TILE_PARAMS: any[] = [
  { name: 'z', in: 'path', required: true, schema: { type: 'integer', minimum: 0, maximum: 18 } },
  { name: 'x', in: 'path', required: true, schema: { type: 'integer', minimum: 0 } },
  {
    name: 'y',
    in: 'path',
    required: true,
    description: 'Ends in ".mvt"; the extension is stripped before use.',
    schema: { type: 'string' },
  },
]

/** Binary tile responses share this shape across all three tile routes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TILE_RESPONSES: any = {
  200: {
    description: 'A Mapbox Vector Tile.',
    content: {
      'application/vnd.mapbox-vector-tile': { schema: { type: 'string', format: 'binary' } },
    },
  },
  204: { description: 'The tile has no features; nothing is returned.' },
  400: COMMON_RESPONSES[400],
  429: COMMON_RESPONSES[429],
}

/** The session cookie every authenticated route reads. Registered once, referenced by every protected route. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SESSION_SECURITY: any[] = [{ sessionCookie: [] }]
