import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MAXIMUM_LENGTH,
  PASSWORD_MINIMUM_LENGTH,
  checkPasswordRules,
  isPasswordAcceptable,
  passwordSchema,
} from '../password'

const acceptable = 'Vindolanda!42'

describe('password rules', () => {
  it('accepts a password meeting every rule', () => {
    expect(isPasswordAcceptable(acceptable)).toBe(true)
    expect(checkPasswordRules(acceptable).every((rule) => rule.isMet)).toBe(true)
  })

  it('rejects one that is too short, too long, or missing a class of character', () => {
    expect(isPasswordAcceptable('Short!1')).toBe(false)
    expect(isPasswordAcceptable(`A!${'a'.repeat(PASSWORD_MAXIMUM_LENGTH)}`)).toBe(false)
    expect(isPasswordAcceptable('vindolanda!42')).toBe(false)
    expect(isPasswordAcceptable('Vindolanda4242')).toBe(false)
  })

  it('reports every rule on every keystroke, met or not', () => {
    const states = checkPasswordRules('V')
    expect(states.map((rule) => rule.id)).toEqual(['length', 'capital', 'special'])
    expect(states.map((rule) => rule.isMet)).toEqual([false, true, false])
  })

  it('counts a letter outside ASCII as a capital and an accent as neither', () => {
    expect(isPasswordAcceptable('Ärchäologie!1')).toBe(true)
    expect(checkPasswordRules('ärchäologie!1').find((r) => r.id === 'capital')?.isMet).toBe(false)
  })

  /**
   * The whole reason the rules and the schema are generated from one list: a
   * form that permits what the endpoint refuses is a dead end the reader
   * cannot diagnose, and one that refuses what the endpoint permits is a
   * policy that only appears to exist.
   */
  it('agrees with the schema the server enforces', () => {
    const samples = [
      acceptable,
      'short',
      'nocapital!123',
      'NoSpecial12345',
      'A!'.padEnd(PASSWORD_MINIMUM_LENGTH - 1, 'a'),
      'A!'.padEnd(PASSWORD_MAXIMUM_LENGTH + 1, 'a'),
    ]

    for (const sample of samples) {
      expect(passwordSchema.safeParse(sample).success).toBe(isPasswordAcceptable(sample))
    }
  })
})
