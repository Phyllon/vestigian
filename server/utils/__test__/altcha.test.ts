import { createChallenge, solveChallenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'
import { describe, expect, it } from 'vitest'
import { decodeAltchaPayload } from '../altcha'

/**
 * Only the payload decoding is exercised here — `assertHumanVisitor` reads
 * runtime config and burns a salt in Valkey, which is effect, not logic, and
 * untestable without mocks the house style avoids.
 *
 * What is worth pinning down is that a malformed submission is a *failed
 * challenge* and not a crash: a bot posting rubbish must get the same answer as
 * a bot posting a wrong solution, and neither must reach a stack trace.
 */
const SECRET = 'test-secret'

const solvedPayload = async (): Promise<string> => {
  const challenge = await createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 200,
    deriveKey,
    hmacSignatureSecret: SECRET,
    expiresAt: new Date(Date.now() + 60_000),
  })

  const solution = await solveChallenge({ challenge, deriveKey })
  expect(solution).not.toBeNull()

  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64')
}

describe('decodeAltchaPayload', () => {
  it('reads back a genuinely solved challenge', async () => {
    const decoded = decodeAltchaPayload(await solvedPayload())

    expect(decoded).not.toBeNull()
    expect(decoded!.challenge.parameters.salt).toBeTruthy()
    expect(typeof decoded!.solution.counter).toBe('number')
  })

  it('refuses anything that is not a solved challenge', () => {
    const notPayloads = [
      undefined,
      '',
      'not-base64-at-all!!',
      Buffer.from('null').toString('base64'),
      Buffer.from('"a string"').toString('base64'),
      Buffer.from('{}').toString('base64'),
      // Shaped like a payload, but carrying neither a salt nor a counter.
      Buffer.from(JSON.stringify({ challenge: { parameters: {} }, solution: {} })).toString(
        'base64',
      ),
      // A challenge with no solution attached.
      Buffer.from(JSON.stringify({ challenge: { parameters: { salt: 'abc' } } })).toString(
        'base64',
      ),
    ]

    for (const value of notPayloads) expect(decodeAltchaPayload(value)).toBeNull()
  })

  /**
   * The salt is what the replay guard keys on, so it has to survive decoding
   * intact — a payload whose salt were dropped would be burned under the wrong
   * key and replay silently.
   */
  it('preserves the salt the replay guard depends on', async () => {
    const payload = await solvedPayload()
    const decoded = decodeAltchaPayload(payload)
    const raw = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))

    expect(decoded!.challenge.parameters.salt).toBe(raw.challenge.parameters.salt)
  })
})
