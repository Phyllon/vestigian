import { evaluateTrust, hasAtLeastRole, TRUST_THRESHOLD } from '#shared/utils/authorization'
import type { SessionUser } from '#shared/types'

/**
 * Thin wrapper over nuxt-auth-utils so components never reach into the session
 * shape directly.
 *
 * The rules themselves are imported, not restated: this file used to carry its
 * own spelling of "is at least a moderator" and its own transcription of
 * `evaluateTrust`, complete with the threshold as a bare `2`.
 *
 * Everything here reflects the session cookie, which is sealed at login and
 * never refreshed — so a promotion or a suspension shows up in this UI only
 * after the next sign-in. That is cosmetic by design: it decides which controls
 * a page offers, while the server re-reads role and trust from the database
 * before acting on any of them.
 */
export const useSession = () => {
  const { loggedIn, user, clear, fetch: refresh } = useUserSession()

  const currentUser = computed<SessionUser | null>(() => (user.value as SessionUser) ?? null)

  const isModerator = computed(
    () => currentUser.value !== null && hasAtLeastRole(currentUser.value.role, 'moderator'),
  )

  const isAdmin = computed(
    () => currentUser.value !== null && hasAtLeastRole(currentUser.value.role, 'admin'),
  )

  const editsGoLiveImmediately = computed(
    () => currentUser.value !== null && evaluateTrust(currentUser.value).autoApprove,
  )

  const contributionsUntilTrusted = computed(() => {
    if (!currentUser.value || editsGoLiveImmediately.value) return 0
    return Math.max(TRUST_THRESHOLD - currentUser.value.approvedContributions, 0)
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
    isAdmin,
    editsGoLiveImmediately,
    contributionsUntilTrusted,
    refresh,
    signOut,
  }
}
