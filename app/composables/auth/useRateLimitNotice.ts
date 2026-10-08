/**
 * Everything a form needs to react to a 429, in one place: start the countdown,
 * keep a fixed sentence for the alert and a live one for the button.
 *
 * The logic that can go wrong (reading the refusal, the wording, the clock) is
 * in `useRateLimitCooldown` and is tested there. This only joins it to
 * vue-i18n.
 */
export const useRateLimitNotice = () => {
  const { t } = useI18n()
  const cooldown = useRateLimitCooldown()

  /**
   * The wait as it stood when the limit was hit, fixed on purpose. The alert is
   * announced by a screen reader when it appears (`role="alert"`) and again for
   * every change to its text, so a number ticking inside it would be read out
   * every second. The live countdown belongs on the disabled button.
   */
  const lockedFor = ref('')

  const liveWait = computed(() => formatWait(cooldown.phrase.value, t))
  const waitingLabel = computed(() => t('rateLimit.waiting', { wait: liveWait.value }))

  /**
   * True when `error` was a rate-limit refusal, in which case the cooldown is
   * running and the caller should stop there instead of reporting a failure.
   */
  const handle = (error: unknown): boolean => {
    const failure = readRateLimitFailure(error)
    if (!failure) return false

    cooldown.start(failure.retryAfterSeconds)
    lockedFor.value = liveWait.value
    return true
  }

  return { isPaused: cooldown.isCoolingDown, lockedFor, waitingLabel, handle }
}
