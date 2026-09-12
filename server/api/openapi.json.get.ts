import {
  bodyFromSchema,
  COMMON_RESPONSES,
  errorResponse,
  jsonResponse,
  paramsFromSchema,
  SESSION_SECURITY,
  TILE_PARAMS,
  TILE_RESPONSES,
} from '~~/server/utils/openapi'
import { querySchema as adminAccountsQuery } from './admin/accounts.get'
import {
  paramsSchema as adminAccountParams,
  querySchema as adminAccountQuery,
} from './admin/accounts/[id].get'
import { querySchema as adminActivityQuery } from './admin/activity.get'
import { querySchema as adminAuditQuery } from './admin/audit.get'
import { banSchema } from './admin/ban.post'
import { querySchema as adminImagesQuery } from './admin/images.get'
import { retractSchema } from './admin/retract.post'
import { revokeSessionsSchema } from './admin/sessions.post'
import { stepUpSchema } from './admin/step-up.post'
import { bodySchema as forgotPasswordSchema } from './auth/forgot-password.post'
import { credentialsSchema } from './auth/login.post'
import { registrationSchema } from './auth/register.post'
import { bodySchema as resetPasswordSchema } from './auth/reset-password.post'
import { changeEmailSchema } from './auth/change-email.post'
import { changePasswordSchema } from './auth/change-password.post'
import { bodySchema as verifySchema } from './auth/verify.post'
import { contributionSchema } from './contributions/index.post'
import { querySchema as geojsonQuerySchema } from './data/sites.geojson.get'
import { paramsSchema as imagePresetParams } from './images/[id]/[preset].get'
import { paramsSchema as limesSectorParams } from './limes/sectors/[slug].get'
import { querySchema as moderationQueueQuery } from './moderation/queue.get'
import { revertSchema } from './moderation/revert.post'
import { batchSchema } from './moderation/review-batch.post'
import { reviewSchema } from './moderation/review.post'
import { roleSchema } from './moderation/role.post'
import { trustSchema } from './moderation/trust.post'
import { bookmarkSchema } from './me/bookmarks.post'
import { paramsSchema as bookmarkDeleteParams } from './me/bookmarks/[siteId].delete'
import { querySchema as myContributionsQuery } from './me/contributions.get'
import { profileSchema } from './me/index.patch'
import { visitSchema } from './me/visits.post'
import { paramsSchema as visitDeleteParams } from './me/visits/[siteId].delete'
import {
  paramsSchema as enrichmentParams,
  querySchema as enrichmentQuery,
} from './sites/[id]/enrichment.get'
import { paramsSchema as imageDeleteParams } from './sites/[id]/images/[imageId].delete'
import {
  bodySchema as imagePatchBody,
  paramsSchema as imagePatchParams,
} from './sites/[id]/images/[imageId].patch'
import {
  bodySchema as imageOrderBody,
  paramsSchema as imageOrderParams,
} from './sites/[id]/images/order.post'
import { paramsSchema as siteIdParams } from './sites/[id].get'
import { paramsSchema as endorseDeleteParams } from './sites/[id]/endorse.delete'
import { paramsSchema as endorsePostParams } from './sites/[id]/endorse.post'
import { paramsSchema as siteRevisionsParams } from './sites/[id]/revisions.get'
import { querySchema as siteSearchQuery } from './sites/search.get'
import { paramsSchema as siteSlugParams } from './sites/slug/[slug].get'
import { paramsSchema as tracingIdParams } from './tracings/[id].get'
import { paramsSchema as tracingRevisionsParams } from './tracings/[id]/revisions.get'

/**
 * `/api/openapi.json` — assembled here rather than served straight from
 * Nitro's own generator, because that generator only knows what
 * `defineRouteMeta` can express as a build-time object literal.
 *
 * `defineRouteMeta`'s argument is parsed as an AST at build time
 * (`nitropack/dist/rollup/index.mjs`, `astToObject`), and it only understands
 * object/array literals of literals. A function call — `zodToJsonSchema(...)`
 * — or a reference to an imported constant returns `undefined` there and is
 * dropped with no build error. That is fine for `tags`, `summary` and
 * `description`, which every route's `defineRouteMeta` still declares as
 * literals; it cannot be true for parameters and request bodies, which have to
 * be derived from the same zod schema each handler actually validates against
 * or they will quietly drift from it. This route has no such restriction — it
 * is a normal handler, computed once per request and cached by the route rule
 * below — so the schema-shaped detail lives here instead.
 *
 * The base document (paths, methods, tags, summary, description — everything
 * `defineRouteMeta` *can* express) still comes from Nitro's own generator, at
 * `NUXT_PUBLIC_SITE_URL` + the internal route configured as
 * `nitro.openAPI.route` in `nuxt.config.ts`. This route fetches it and merges
 * in `parameters` / `requestBody` / `responses` / `security` by path and
 * method, so the two halves of one route's documentation cannot disagree about
 * which route they describe.
 */
const OPERATION_OVERRIDES: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Partial<Record<'get' | 'post' | 'patch' | 'delete', Record<string, any>>>
> = {
  '/api/auth/challenge': {
    get: {
      responses: { 200: jsonResponse('A signed ALTCHA challenge.'), 429: COMMON_RESPONSES[429] },
    },
  },
  '/api/auth/forgot-password': {
    post: {
      requestBody: bodyFromSchema(forgotPasswordSchema),
      responses: {
        200: jsonResponse('Always the same body: { status: "sent" }.'),
        400: COMMON_RESPONSES[400],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/login': {
    post: {
      requestBody: bodyFromSchema(credentialsSchema),
      responses: {
        200: jsonResponse('{ user: SessionUser }'),
        400: COMMON_RESPONSES[400],
        401: errorResponse('Email and password do not match.'),
        403: errorResponse('Credentials are correct, but the email address is not verified yet.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/logout': {
    post: {
      responses: { 200: jsonResponse('{ status: "signed-out" }'), 429: COMMON_RESPONSES[429] },
    },
  },
  '/api/auth/account': {
    delete: {
      security: SESSION_SECURITY,
      responses: {
        200: jsonResponse('{ status: "deleted" }'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/change-email': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(changeEmailSchema),
      responses: {
        200: jsonResponse(
          '{ status: "pending-confirmation" } — nothing is written until confirmed.',
        ),
        400: errorResponse('That is already the address on the account.'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('The current password did not match.'),
        409: errorResponse('That address is already in use.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/change-password': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(changePasswordSchema),
      responses: {
        200: jsonResponse('{ status: "changed" }'),
        400: COMMON_RESPONSES[400],
        401: COMMON_RESPONSES[401],
        403: errorResponse('The current password did not match.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/export': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: jsonResponse(
          'Account fields plus the caller’s own sites, tracings, images, revisions, visits, bookmarks and endorsements.',
        ),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/register': {
    post: {
      requestBody: bodyFromSchema(registrationSchema),
      responses: {
        200: jsonResponse('{ status: "pending-verification" }'),
        400: COMMON_RESPONSES[400],
        409: errorResponse('That email or display name is already registered.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/reset-password': {
    post: {
      requestBody: bodyFromSchema(resetPasswordSchema),
      responses: {
        200: jsonResponse('{ status: "reset" }'),
        400: errorResponse('The link is expired or no longer valid.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/auth/verify': {
    post: {
      requestBody: bodyFromSchema(verifySchema),
      responses: {
        200: jsonResponse('{ status: "verified" | "address-changed" }'),
        400: errorResponse('The link is expired, already used, or not valid.'),
        409: errorResponse('The new address was claimed by another account in the meantime.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/contributions': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(
        contributionSchema,
        'A site or tracing draft, discriminated on "kind". Include entityId to edit an existing record.',
      ),
      responses: {
        200: jsonResponse(
          '{ revisionId, entityId, status: "approved" | "pending", changeCount, message }',
        ),
        400: errorResponse('Validation failed, or an edit changed nothing.'),
        401: COMMON_RESPONSES[401],
        404: errorResponse('entityId was given but names a record that no longer exists.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/contributions/images': {
    post: {
      security: SESSION_SECURITY,
      requestBody: {
        required: true,
        description: 'multipart/form-data.',
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file', 'siteId', 'licence'],
              properties: {
                file: { type: 'string', format: 'binary' },
                siteId: { type: 'string', description: 'Numeric site id, as a form field.' },
                caption: { type: 'string', maxLength: 500 },
                licence: { type: 'string', description: 'e.g. CC-BY-SA-4.0, CC0-1.0, UNKNOWN.' },
                attribution: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      responses: {
        200: jsonResponse('{ imageId, status: "approved" | "pending", message }'),
        400: errorResponse('Missing fields, an unpublishable licence, or an unreadable image.'),
        401: COMMON_RESPONSES[401],
        404: errorResponse('No approved site at that id.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/data/sites.geojson': {
    get: {
      parameters: paramsFromSchema(geojsonQuerySchema, 'query'),
      responses: {
        200: {
          description: 'A GeoJSON FeatureCollection.',
          content: { 'application/geo+json': { schema: { type: 'object' } } },
        },
        400: COMMON_RESPONSES[400],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/health': {
    get: { responses: { 200: jsonResponse('{ status: "ok", uptime: number }') } },
  },
  '/api/images/{id}/{preset}': {
    get: {
      parameters: paramsFromSchema(imagePresetParams, 'path'),
      responses: {
        302: { description: 'Redirects to the signed imgproxy URL for the requested preset.' },
        404: errorResponse('No published image at that id, or the licence forbids publication.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/limes/sectors': {
    get: { responses: { 200: jsonResponse('LimesSector[]'), 429: COMMON_RESPONSES[429] } },
  },
  '/api/limes/sectors/{slug}': {
    get: {
      parameters: paramsFromSchema(limesSectorParams, 'path'),
      responses: {
        200: jsonResponse('LimesSectorDetail, including roll.records and roll.references.'),
        404: errorResponse('No such stretch of frontier.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: jsonResponse('{ account, trust, contributions, notebook }'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
    patch: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(profileSchema, 'Only the fields present are written.'),
      responses: {
        200: jsonResponse('The profile fields as they now stand.'),
        400: COMMON_RESPONSES[400],
        401: COMMON_RESPONSES[401],
        409: errorResponse('That display name is already taken.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/bookmarks': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: jsonResponse('The caller’s to-visit list, newest first.'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(bookmarkSchema),
      responses: {
        200: jsonResponse('{ siteId, status: "saved" } — idempotent.'),
        401: COMMON_RESPONSES[401],
        404: errorResponse('No published site at that id.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/bookmarks/{siteId}': {
    delete: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(bookmarkDeleteParams, 'path'),
      responses: {
        200: jsonResponse('{ siteId, status: "removed" } — idempotent.'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/contributions': {
    get: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(myContributionsQuery, 'query'),
      responses: {
        200: jsonResponse('{ items: [...], nextCursor: number | null } — newest first.'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/field-kit.gpx': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: {
          description: 'A GPX 1.1 waypoint file, as an attachment.',
          content: { 'application/gpx+xml': { schema: { type: 'string' } } },
        },
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/map.geojson': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: {
          description: 'A GeoJSON FeatureCollection of the caller’s visits and to-visit list.',
          content: { 'application/geo+json': { schema: { type: 'object' } } },
        },
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/visits': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: jsonResponse('The caller’s visit log, dated entries first.'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(visitSchema, 'The date and the note are both optional.'),
      responses: {
        200: jsonResponse('{ siteId, visitedOn } — upserted.'),
        400: COMMON_RESPONSES[400],
        401: COMMON_RESPONSES[401],
        404: errorResponse('No published site at that id.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/me/visits/{siteId}': {
    delete: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(visitDeleteParams, 'path'),
      responses: {
        200: jsonResponse('{ siteId, status: "removed" }'),
        401: COMMON_RESPONSES[401],
        404: errorResponse('No visit recorded for that site.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/metrics': {
    get: {
      responses: {
        200: {
          description: 'Prometheus text exposition format.',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/moderation/queue': {
    get: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(moderationQueueQuery, 'query'),
      responses: {
        200: jsonResponse('{ items: [...], nextCursor: number | null }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/moderation/revert': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(revertSchema),
      responses: {
        200: jsonResponse('{ revisionId, revertedRevisionId, status: "reverted" }'),
        400: errorResponse(
          'That revision created the record; there is no earlier state to restore.',
        ),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        404: errorResponse('No published revision with that id.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/moderation/review-batch': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(batchSchema),
      responses: {
        200: jsonResponse('{ outcomes: BatchOutcome[], succeeded, skipped }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/moderation/review': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(reviewSchema),
      responses: {
        200: jsonResponse('{ revisionId, status: "approved" | "rejected" }'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('You cannot review your own contribution.'),
        404: errorResponse('Revision not found.'),
        409: errorResponse('This revision has already been reviewed.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/moderation/role': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(roleSchema),
      responses: {
        200: jsonResponse('{ userId, role }'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('Refused by checkRoleChange.'),
        404: errorResponse('No such account.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/moderation/trust': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(trustSchema),
      responses: {
        200: jsonResponse('{ userId, trustRevoked }'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('Trust applies to contributors only.'),
        404: errorResponse('No such account.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/activity': {
    get: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(adminActivityQuery, 'query'),
      responses: {
        200: jsonResponse('{ items: [...], nextCursor: number | null }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/accounts': {
    get: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(adminAccountsQuery, 'query'),
      responses: {
        200: jsonResponse('{ accounts: [...] }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/accounts/{id}': {
    get: {
      security: SESSION_SECURITY,
      parameters: [
        ...paramsFromSchema(adminAccountParams, 'path'),
        ...paramsFromSchema(adminAccountQuery, 'query'),
      ],
      responses: {
        200: jsonResponse('{ account, counts, createdSites, history, auditTrail, ... }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        404: errorResponse('No such account.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/audit': {
    get: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(adminAuditQuery, 'query'),
      responses: {
        200: jsonResponse('{ entries: [...], nextCursor: number | null }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/images': {
    get: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(adminImagesQuery, 'query'),
      responses: {
        200: jsonResponse('{ images: [...] }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/system': {
    get: {
      security: SESSION_SECURITY,
      responses: {
        200: jsonResponse('{ status, checks, dataVersion, attention, counters }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/step-up': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(stepUpSchema),
      responses: {
        200: jsonResponse('{ status: "confirmed", expiresInSeconds }'),
        400: errorResponse('Enter a code from your authenticator app.'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('Wrong password, or wrong code.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/ban': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(banSchema),
      responses: {
        200: jsonResponse('{ userId, blocked, bannedAt }'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('Refused by checkBan — never against another administrator.'),
        404: errorResponse('No such account.'),
        409: errorResponse('That account is already in the requested state.'),
        428: errorResponse('Confirm your password before making this change.'),
        429: COMMON_RESPONSES[429],
        503: errorResponse('Re-authentication could not be checked; the action is refused.'),
      },
    },
  },
  '/api/admin/retract': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(retractSchema),
      responses: {
        200: jsonResponse('{ userId, applied, summary, outcomes?, untouched }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        404: errorResponse('No such account.'),
        428: errorResponse('Confirm your password before applying this.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/admin/sessions': {
    post: {
      security: SESSION_SECURITY,
      requestBody: bodyFromSchema(revokeSessionsSchema),
      responses: {
        200: jsonResponse('{ userId, sessionsValidFrom }'),
        401: COMMON_RESPONSES[401],
        403: COMMON_RESPONSES[403],
        404: errorResponse('No such account.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/ready': {
    get: {
      responses: {
        200: jsonResponse('{ status: "ready", checks: { database: true, cache: true } }'),
        503: jsonResponse('{ status: "degraded", checks: {...} }'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/search': {
    get: {
      parameters: paramsFromSchema(siteSearchQuery, 'query'),
      responses: {
        200: jsonResponse('SiteSummary[], ranked by trigram similarity.'),
        400: COMMON_RESPONSES[400],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/slug/{slug}': {
    get: {
      parameters: paramsFromSchema(siteSlugParams, 'path'),
      responses: {
        200: jsonResponse('The full site record.'),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/{id}': {
    get: {
      parameters: paramsFromSchema(siteIdParams, 'path'),
      responses: {
        200: jsonResponse(
          'The full site record: summary, description, images, external ids, endorsementCount, endorsedByMe.',
        ),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/{id}/endorse': {
    post: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(endorsePostParams, 'path'),
      responses: {
        200: jsonResponse('{ siteId, count, endorsedByMe: true }'),
        401: COMMON_RESPONSES[401],
        404: errorResponse('No published site at that id.'),
        429: COMMON_RESPONSES[429],
      },
    },
    delete: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(endorseDeleteParams, 'path'),
      responses: {
        200: jsonResponse('{ siteId, count, endorsedByMe: false }'),
        401: COMMON_RESPONSES[401],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/{id}/enrichment': {
    get: {
      parameters: [
        ...paramsFromSchema(enrichmentParams, 'path'),
        ...paramsFromSchema(enrichmentQuery, 'query'),
      ],
      responses: {
        200: jsonResponse('SiteEnrichment, or null.'),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/{id}/images/order': {
    post: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(imageOrderParams, 'path'),
      requestBody: bodyFromSchema(imageOrderBody),
      responses: {
        200: jsonResponse('{ order: number[] } — the full new sequence of image ids.'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('That photograph belongs to someone else.'),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/{id}/images/{imageId}': {
    delete: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(imageDeleteParams, 'path'),
      responses: {
        200: jsonResponse('{ imageId, status: "withdrawn" }'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('That photograph belongs to someone else.'),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
    patch: {
      security: SESSION_SECURITY,
      parameters: paramsFromSchema(imagePatchParams, 'path'),
      requestBody: bodyFromSchema(imagePatchBody, 'Only the fields present are changed.'),
      responses: {
        200: jsonResponse('{ imageId, status: "updated" | "unchanged" }'),
        400: errorResponse('The chosen licence would hide the image from publication.'),
        401: COMMON_RESPONSES[401],
        403: errorResponse('That photograph belongs to someone else.'),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/sites/{id}/revisions': {
    get: {
      parameters: paramsFromSchema(siteRevisionsParams, 'path'),
      responses: {
        200: jsonResponse('Up to 100 revisions, newest first, each with a computed diff.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/tiles/{z}/{x}/{y}': { get: { parameters: TILE_PARAMS, responses: TILE_RESPONSES } },
  '/api/tiles/basemap/{z}/{x}/{y}': {
    get: {
      parameters: TILE_PARAMS,
      responses: {
        ...TILE_RESPONSES,
        404: errorResponse('No offline basemap is configured for this deployment.'),
      },
    },
  },
  '/api/tiles/antiquity/{z}/{x}/{y}': {
    get: { parameters: TILE_PARAMS, responses: TILE_RESPONSES },
  },
  '/api/tiles/limes/{z}/{x}/{y}': { get: { parameters: TILE_PARAMS, responses: TILE_RESPONSES } },
  '/api/tracings/{id}': {
    get: {
      parameters: paramsFromSchema(tracingIdParams, 'path'),
      responses: {
        200: jsonResponse('Title, category, GeoJSON geometry, computed length, licence.'),
        404: COMMON_RESPONSES[404],
        429: COMMON_RESPONSES[429],
      },
    },
  },
  '/api/tracings/{id}/revisions': {
    get: {
      parameters: paramsFromSchema(tracingRevisionsParams, 'path'),
      responses: {
        200: jsonResponse('Up to 100 revisions, newest first, each with a computed diff.'),
        429: COMMON_RESPONSES[429],
      },
    },
  },
}

interface OpenApiDocument {
  openapi: string
  info: Record<string, unknown>
  servers?: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paths: Record<string, Record<string, any>>
  components?: Record<string, unknown>
}

export default defineEventHandler(async (event): Promise<OpenApiDocument> => {
  // Dev only. A machine-readable map of every route, parameter and response
  // shape is a development convenience, not something to leave reachable on
  // the public internet — see the note in nuxt.config.ts, which independently
  // disables the base document this route fetches, in production. Refused
  // before that fetch even runs, rather than relying on the base document's
  // own absence to fail this route indirectly.
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, message: 'Not found.' })
  }

  // A relative path, deliberately with no baseURL. Nitro's server-side $fetch
  // resolves a same-origin relative call against its own request handler
  // rather than opening a real socket, so this costs one in-process function
  // call and depends on no runtime config being correct.
  const base = await $fetch<OpenApiDocument>('/_nitro-base-openapi.json')

  for (const [path, methods] of Object.entries(OPERATION_OVERRIDES)) {
    const operations = base.paths[path]
    if (!operations) continue // A path this file no longer matches an actual route for.

    for (const [method, override] of Object.entries(methods)) {
      if (operations[method]) Object.assign(operations[method], override)
    }
  }

  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return base
})
