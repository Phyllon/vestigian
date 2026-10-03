/**
 * Routes whose requests must leave no personal data in this application's own
 * logs: no address, no user agent.
 *
 * The access log (`server/plugins/observability.ts`) otherwise records both for
 * every request, for 30 days, for abuse handling. These routes exist to receive
 * anonymous measurements, so for them that record is dropped at the source —
 * the request is still counted (route, method, status, duration) in the metrics.
 *
 * Matched on the route **pattern**, the same label the metrics use.
 */
const ANONYMOUS_ROUTES: ReadonlySet<string> = new Set(['/api/vitals'])

export const isAnonymousRoute = (route: string): boolean => ANONYMOUS_ROUTES.has(route)

export interface Requester {
  ip: string
  userAgent: string | undefined
}

/**
 * What the access log may say about who made a request. For an anonymous route
 * the resolver is **never called**: the address is not read, let alone written.
 */
export const describeRequester = (route: string, resolve: () => Requester): Partial<Requester> =>
  isAnonymousRoute(route) ? {} : resolve()
