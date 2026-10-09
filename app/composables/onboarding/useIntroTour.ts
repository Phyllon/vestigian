/**
 * The first-visit introduction to the map's controls.
 *
 * **What "a new user" means here — and what it deliberately does not.** It is a
 * *browser* with no recorded answer, never a person. Nothing identifies anyone:
 * no account lookup, no server call, no fingerprint, no counter. The only thing
 * ever stored is the fact that this browser's visitor finished or skipped the
 * tour, as one fixed string in `localStorage` (never a cookie, never sent to
 * us). That is the same class of storage as the language-notice dismissal, and
 * the same reasoning applies: §25(2) no. 2 TDDDG exempts storage a visitor's
 * own explicit choice (pressing "Skip" or "Done") asks for, so no consent
 * banner is needed — see `.claude/rules/gdpr-legal.md`.
 *
 * Consequences worth keeping:
 * - **Nothing is written until the visitor acts.** Closing the tab mid-tour
 *   shows it again next time; that is a feature, not a leak.
 * - **It is not tied to the account.** Signing in on a fresh browser shows it
 *   again. Persisting "has seen the tour" server-side would turn a UI nicety
 *   into profile data, and the replay entry in the menu covers the rare repeat.
 * - **Blocked storage degrades to once per page load**, not on every
 *   navigation (`hasStartedThisSession`), so a privacy-minded visitor is not
 *   nagged by a tour they can never mark as done.
 *
 * Read the stored answer from `onMounted` only, never inside a `useState`
 * factory: a factory runs during SSR, where `localStorage` does not exist, and
 * Nuxt then hydrates the client from whatever the server returned (the same
 * trap `LanguageNotice.vue` documents).
 */

export const INTRO_STORAGE_KEY = 'vestigian-intro-tour'

/** Stored verbatim; the value carries no information beyond "an answer exists". */
const RECORDED_ANSWER = 'done'

/**
 * Which side of the highlighted control the text box opens on.
 * `left` is the right-hand control column on a wide screen; there is no room
 * for it beside a 44px button on a phone, so it opens above instead.
 */
export type IntroSide = 'top' | 'bottom' | 'left'

export interface IntroStep {
  /** Keys the copy at `introTour.steps.<id>.{title,body,try}`. */
  id: string
  /** The `data-tour` value of the control to highlight; absent for the welcome. */
  target?: string
  side?: IntroSide
}

export const INTRO_STEPS: readonly IntroStep[] = [
  { id: 'welcome' },
  { id: 'search', target: 'search', side: 'bottom' },
  { id: 'overlays', target: 'overlays', side: 'bottom' },
  { id: 'period', target: 'period', side: 'bottom' },
  { id: 'basemap', target: 'basemap', side: 'bottom' },
  { id: 'legend', target: 'legend', side: 'top' },
  { id: 'featured', target: 'featured', side: 'left' },
  { id: 'density', target: 'density', side: 'left' },
  { id: 'offline', target: 'offline', side: 'left' },
  { id: 'geolocate', target: 'geolocate', side: 'left' },
  { id: 'contribute', target: 'contribute', side: 'left' },
  { id: 'menu', target: 'menu', side: 'bottom' },
]

/**
 * Steps whose control is not on screen are dropped rather than shown pointing
 * at nothing: "Add to the atlas" exists only when signed in, and the density
 * toggle only while sites are drawn. The welcome has no target and always stays.
 */
export const resolveIntroSteps = (
  steps: readonly IntroStep[],
  isTargetPresent: (target: string) => boolean,
): IntroStep[] => steps.filter((step) => step.target === undefined || isTargetPresent(step.target))

/** Clamped, so a stray key repeat can neither run off the end nor below zero. */
export const clampStepIndex = (index: number, stepCount: number): number =>
  Math.min(Math.max(index, 0), Math.max(stepCount - 1, 0))

export const resolveIntroSide = (side: IntroSide | undefined, isWide: boolean): IntroSide => {
  if (side === undefined) return 'bottom'
  if (side === 'left' && !isWide) return 'top'
  return side
}

interface AutoStartInput {
  /** What `localStorage` held; `null` when empty *or* unreadable. */
  recordedAnswer: string | null
  hasStartedThisSession: boolean
}

export const shouldAutoStartIntro = ({
  recordedAnswer,
  hasStartedThisSession,
}: AutoStartInput): boolean => recordedAnswer === null && !hasStartedThisSession

const readRecordedAnswer = (): string | null => {
  try {
    return localStorage.getItem(INTRO_STORAGE_KEY)
  } catch {
    return null
  }
}

const recordAnswer = (): void => {
  try {
    localStorage.setItem(INTRO_STORAGE_KEY, RECORDED_ANSWER)
  } catch {
    // Private browsing / storage blocked: the tour simply stays a once-per-load offer.
  }
}

export const useIntroTour = () => {
  const isOpen = useState('intro-tour-open', () => false)
  const hasStartedThisSession = useState('intro-tour-started', () => false)

  /** Also the replay path: it records nothing, so a replay never changes the answer. */
  const open = (): void => {
    hasStartedThisSession.value = true
    isOpen.value = true
  }

  /** Finishing and skipping are the same answer: either way, do not ask again. */
  const close = (): void => {
    isOpen.value = false
    recordAnswer()
  }

  /** Client-only — call from `onMounted`. */
  const openIfNew = (): void => {
    const recordedAnswer = readRecordedAnswer()
    if (
      shouldAutoStartIntro({ recordedAnswer, hasStartedThisSession: hasStartedThisSession.value })
    )
      open()
  }

  return { isOpen, open, close, openIfNew }
}
