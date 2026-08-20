export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useSession()

  if (!loggedIn.value) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }
})
