import { hash, verify } from '@node-rs/argon2'

/**
 * OWASP-recommended argon2id parameters: 19 MiB of memory, two passes. The
 * memory cost is what makes GPU cracking uneconomic, so it is not tuned down
 * to save resources on the app container.
 */
const ARGON_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const

export const hashPasswordArgon = async (password: string): Promise<string> =>
  hash(password, ARGON_OPTIONS)

export const verifyPasswordArgon = async (digest: string, password: string): Promise<boolean> => {
  try {
    return await verify(digest, password, ARGON_OPTIONS)
  } catch {
    return false
  }
}

/**
 * Run against a throwaway hash when no user matches, so a failed login takes
 * the same time whether or not the address exists. Without this, response
 * timing enumerates the user table.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2ZXN0aWdpYQ$0000000000000000000000000000000000000000000'
