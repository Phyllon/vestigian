/**
 * Mirrors `moderator.ts` with one deliberate difference: a signed-in
 * non-administrator gets **404**, not 403.
 *
 * 403 confirms that `/admin` exists and that somebody can reach it, which is
 * exactly what a curious contributor — or anyone who has just noticed the
 * route in a bundle — should not learn from asking. A 404 is indistinguishable
 * from a typo. This is concealment rather than protection and is worth
 * precisely nothing on its own; what protects the panel is `requireAdmin` on
 * every endpoint behind it, which answers an honest 403, because by the time
 * one of those is reached the caller is authenticated and a truthful error is
 * worth more than a coy one.
 *
 * An anonymous visitor is still sent to `/login`. Answering 404 there would
 * strand an administrator who simply has not signed in yet.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, isAdmin } = useSession()

  if (!loggedIn.value) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }

  if (!isAdmin.value) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
  }
})
