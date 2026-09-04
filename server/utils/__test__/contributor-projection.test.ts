import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The public contributor route is a projection, and what it leaves out is the
 * whole of its security value: email, role, trust state, and the two notebook
 * tables that are private under every setting.
 *
 * Asserted against the source text rather than by calling the handler, which
 * would need a database. That is a blunt instrument, but it catches the change
 * this is actually guarding against — somebody widening the `select` while
 * adding a feature — and it fails loudly enough to send them to the docstring.
 */
const source = readFileSync(
  fileURLToPath(new URL('../../api/contributors/[name].get.ts', import.meta.url)),
  'utf8',
)

/**
 * Comments explain why these are absent, so only real code is examined.
 * Runs once against this project's own source file, never against untrusted
 * input, so the lazy-quantifier flag below is not a real ReDoS risk.
 */
const code = source
  .replace(/\/\*\*[\s\S]*?\*\//g, '')
  // eslint-disable-next-line sonarjs/super-linear-regex
  .replace(/\/\/.*$/gm, '')
  .replace(/'[^']*'/g, "''")

describe('the public contributor projection', () => {
  it.each([
    ['users.email', 'an address is never public'],
    ['users.role', 'publishing roles makes the moderator list enumerable'],
    ['users.trustRevoked', 'a moderation judgement is not a public fact'],
    ['siteVisits', 'visits are private under every setting'],
    ['siteBookmarks', 'bookmarks are private under every setting'],
  ])('never selects %s — %s', (field) => {
    expect(code).not.toContain(field)
  })

  it('is gated on the opt-in flag', () => {
    expect(code).toContain('users.publicProfile')
  })

  it('answers 404 rather than 403, so display names cannot be enumerated', () => {
    expect(code).toContain('statusCode: 404')
    expect(code).not.toContain('statusCode: 403')
  })

  it('reports the joining date as a month, not a timestamp', () => {
    expect(code).toContain('.slice(0, 7)')
  })
})
