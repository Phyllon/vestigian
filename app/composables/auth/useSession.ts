import type { SessionUser } from '#shared/types'

/**
 * Thin wrapper over nuxt-auth-utils so components never reach into the session
 * shape directly and the trust rules are stated once on the client too.
 */
export const useSession = () => {
  const { loggedIn, user, clear, fetch: refresh } = useUserSession()

  const currentUser = computed<SessionUser | null>(() => (user.value as SessionUser) ?? null)

  const isModerator = computed(
    () => currentUser.value?.role === 'moderator' || currentUser.value?.role === 'admin',
  )

  const editsGoLiveImmediately = computed(
    () => isModerator.value || (currentUser.value?.trustLevel ?? 0) >= 1,
  )

  const contributionsUntilTrusted = computed(() => {
    if (!currentUser.value || editsGoLiveImmediately.value) return 0
    return Math.max(2 - currentUser.value.approvedContributions, 0)
  })

  const signOut = async (): Promise<void> => {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await clear()
    await navigateTo('/')
  }

  return {
    loggedIn,
    currentUser,
    isModerator,
    editsGoLiveImmediately,
    contributionsUntilTrusted,
    refresh,
    signOut,
  }
}
