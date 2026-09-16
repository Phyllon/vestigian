/**
 * The decision behind `server/middleware/security-defaults.ts`, pulled out as
 * a pure function so it has a construction test rather than depending on an
 * h3 event mock this project has no other pattern for — see that file for why
 * either header needs a default at all and why a plain routeRule couldn't
 * deliver them instead.
 */
export interface ResponseHeaderDefaults {
  /** `undefined` means "leave whatever is already there alone". */
  cacheControl: string | undefined
  crossOriginResourcePolicy: string
}

export const resolveResponseHeaderDefaults = (
  existingCacheControl: string | undefined,
): ResponseHeaderDefaults => ({
  cacheControl: existingCacheControl ? undefined : 'private, no-store',
  crossOriginResourcePolicy: 'same-origin',
})
