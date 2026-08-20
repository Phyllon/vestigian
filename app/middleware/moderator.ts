export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, isModerator } = useSession()

  if (!loggedIn.value) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }

  if (!isModerator.value) {
    throw createError({ statusCode: 403, statusMessage: 'Moderator access required.' })
  }
})
