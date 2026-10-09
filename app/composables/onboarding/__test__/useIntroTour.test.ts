import { describe, expect, it } from 'vitest'
import {
  INTRO_STEPS,
  clampStepIndex,
  resolveIntroSide,
  resolveIntroSteps,
  shouldAutoStartIntro,
} from '../useIntroTour'

describe('shouldAutoStartIntro', () => {
  it('offers the tour to a browser with no recorded answer', () => {
    expect(shouldAutoStartIntro({ recordedAnswer: null, hasStartedThisSession: false })).toBe(true)
  })

  it('never offers it again once an answer is recorded', () => {
    expect(shouldAutoStartIntro({ recordedAnswer: 'done', hasStartedThisSession: false })).toBe(
      false,
    )
  })

  it('offers it once per session when storage is blocked, not on every navigation', () => {
    expect(shouldAutoStartIntro({ recordedAnswer: null, hasStartedThisSession: true })).toBe(false)
  })
})

describe('resolveIntroSteps', () => {
  it('drops steps whose control is not on screen and keeps the welcome', () => {
    const present = new Set(['search', 'menu'])
    const ids = resolveIntroSteps(INTRO_STEPS, (target) => present.has(target)).map(
      (step) => step.id,
    )
    expect(ids).toEqual(['welcome', 'search', 'menu'])
  })

  it('keeps the declared order', () => {
    const ids = resolveIntroSteps(INTRO_STEPS, () => true).map((step) => step.id)
    expect(ids).toEqual(INTRO_STEPS.map((step) => step.id))
  })
})

describe('clampStepIndex', () => {
  it('holds at both ends', () => {
    expect(clampStepIndex(-1, 5)).toBe(0)
    expect(clampStepIndex(5, 5)).toBe(4)
  })

  it('survives an empty list', () => {
    expect(clampStepIndex(3, 0)).toBe(0)
  })
})

describe('resolveIntroSide', () => {
  it('opens above the control on a phone, where there is no room beside it', () => {
    expect(resolveIntroSide('left', false)).toBe('top')
  })

  it('keeps the declared side on a wide screen', () => {
    expect(resolveIntroSide('left', true)).toBe('left')
    expect(resolveIntroSide('bottom', false)).toBe('bottom')
  })

  it('defaults to below', () => {
    expect(resolveIntroSide(undefined, true)).toBe('bottom')
  })
})
