import { z } from 'zod'

/**
 * The password policy, defined once for both sides of the wire.
 *
 * The browser uses `checkPasswordRules` to show the reader which requirements
 * they have met as they type; the server uses `passwordSchema` to enforce them.
 * Both are generated from `PASSWORD_RULES`, so a rule cannot be tightened in
 * the form and left loose in the endpoint — which is the failure that matters,
 * since the form is only ever advice and the endpoint is the actual boundary.
 *
 * The upper bound is a product decision rather than a technical one. argon2id
 * hashes any length happily; a stated maximum exists so that a password
 * manager's output is rejected at the keyboard rather than silently truncated
 * somewhere it cannot be seen.
 */
export const PASSWORD_MINIMUM_LENGTH = 12
export const PASSWORD_MAXIMUM_LENGTH = 100

/** Anything that is neither a letter nor a digit in any script. */
const SPECIAL_CHARACTER = /[^\p{L}\p{N}]/u
const CAPITAL_LETTER = /\p{Lu}/u

export type PasswordRuleId = 'length' | 'capital' | 'special'

interface PasswordRule {
  id: PasswordRuleId
  isSatisfiedBy: (password: string) => boolean
}

const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    isSatisfiedBy: (password) =>
      password.length >= PASSWORD_MINIMUM_LENGTH && password.length <= PASSWORD_MAXIMUM_LENGTH,
  },
  {
    id: 'capital',
    isSatisfiedBy: (password) => CAPITAL_LETTER.test(password),
  },
  {
    id: 'special',
    isSatisfiedBy: (password) => SPECIAL_CHARACTER.test(password),
  },
]

export interface PasswordRuleState {
  id: PasswordRuleId
  isMet: boolean
}

/**
 * Every rule with its current state, in a fixed order. All of them are returned
 * whether met or not: a checklist that only shows what is still wrong makes the
 * requirements look like they are growing as the reader types. No label is
 * carried here — this is isomorphic shared code with no guaranteed i18n
 * context, so `PasswordRequirements.vue` maps `id` to translated text itself.
 */
export const checkPasswordRules = (password: string): PasswordRuleState[] =>
  PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    isMet: rule.isSatisfiedBy(password),
  }))

export const isPasswordAcceptable = (password: string): boolean =>
  PASSWORD_RULES.every((rule) => rule.isSatisfiedBy(password))

/**
 * The same rules as a schema. Used by `/api/auth/register` and
 * `/api/auth/reset-password`. Deliberately **not** used by `/api/auth/login`:
 * an account created before a rule existed must still be able to sign in, and
 * rejecting a login on policy grounds tells an attacker what the policy is
 * before they have guessed anything.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MINIMUM_LENGTH, `Use at least ${PASSWORD_MINIMUM_LENGTH} characters.`)
  .max(PASSWORD_MAXIMUM_LENGTH, `Use at most ${PASSWORD_MAXIMUM_LENGTH} characters.`)
  .regex(CAPITAL_LETTER, 'Include one capital letter.')
  .regex(SPECIAL_CHARACTER, 'Include one special character.')
