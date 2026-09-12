/**
 * The client half of `requireStepUp`.
 *
 * A privileged endpoint answers **428** when this session holds no
 * re-authentication grant. Every caller then has the same three-part job —
 * recognise the 428, collect the password (and a code, if the account has two
 * factors), retry the original request — and writing that out in the ban
 * button, the role selector and the retraction confirmation would be three
 * chances to forget the retry and leave an administrator staring at a form
 * that silently did nothing.
 *
 * So `runPrivileged` takes the action as a thunk and owns the loop: run it,
 * and if the answer is 428, park the thunk, raise the dialog, and run it again
 * once the dialog reports success. The action is therefore written once, in
 * the component, exactly as if step-up did not exist.
 */
export const ADMIN_STEP_UP_STATUS = 428

/**
 * The `useFetch` key the station's attention strip is fetched under. A section
 * that changes something calls `refreshNuxtData(ADMIN_SYSTEM_KEY)`; the
 * alternative was an event emitted up through a `<component :is>` the shell
 * deliberately passes nothing through.
 */
export const ADMIN_SYSTEM_KEY = 'admin-system'

/** Whether a caught `$fetch` rejection is the server asking for a password. */
export const isStepUpRequired = (error: unknown): boolean =>
  (error as { statusCode?: number; status?: number })?.statusCode === ADMIN_STEP_UP_STATUS ||
  (error as { status?: number })?.status === ADMIN_STEP_UP_STATUS

export const useAdminStepUp = () => {
  const isDialogOpen = ref(false)
  const isConfirming = ref(false)
  const error = ref<string | null>(null)

  /**
   * The action waiting on a password. Held rather than re-derived, so the
   * retry is the same call with the same arguments — an administrator who
   * confirms a block should not have to press the button a second time and
   * wonder whether the first press did something.
   */
  const pending = ref<(() => Promise<unknown>) | null>(null)

  const runPrivileged = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action()
    } catch (caught) {
      if (!isStepUpRequired(caught)) throw caught

      pending.value = action as () => Promise<unknown>
      error.value = null
      isDialogOpen.value = true
      return undefined
    }
  }

  interface Confirmation {
    currentPassword: string
    code?: string
  }

  const confirm = async (credentials: Confirmation): Promise<boolean> => {
    isConfirming.value = true
    error.value = null

    try {
      await $fetch('/api/admin/step-up', { method: 'POST', body: credentials })
    } catch (caught) {
      error.value =
        (caught as { data?: { message?: string } }).data?.message ?? 'That did not work.'
      return false
    } finally {
      isConfirming.value = false
    }

    isDialogOpen.value = false

    /**
     * The grant is spent by the action it authorises, so the retry has to
     * happen here rather than being left to the caller — and a failure in the
     * retried action is the caller's to report, not the dialog's, which is why
     * it is rethrown rather than folded into `error`.
     */
    const action = pending.value
    pending.value = null
    if (action) await action()

    return true
  }

  const cancel = (): void => {
    isDialogOpen.value = false
    pending.value = null
    error.value = null
  }

  return { isDialogOpen, isConfirming, error, runPrivileged, confirm, cancel }
}
