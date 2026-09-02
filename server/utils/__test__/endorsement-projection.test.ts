import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The endorsement count is deliberately public — unlike `site_visits` and
 * `site_bookmarks`, this is the one part of the notebook family meant to be
 * aggregated and shown to every reader. What must never follow it out is
 * *who* endorsed: the row stays as private as a bookmark even though the
 * count it contributes to is not.
 *
 * Asserted against source text, the same blunt-but-effective approach
 * `contributor-projection.test.ts` uses for the same reason: it catches
 * someone widening a `select` while adding a feature, which is exactly the
 * failure mode that matters here.
 */
const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8')

const stripComments = (source: string): string =>
  source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('the endorsement count never exposes who endorsed', () => {
  it('server/utils/endorsements.ts selects only an id, never a name or account field', () => {
    const code = stripComments(read('utils/endorsements.ts'))
    expect(code).not.toMatch(/displayName|email|users\./)
  })

  it('server/utils/site-record.ts’s endorsement query selects no user-identifying column', () => {
    const code = stripComments(read('utils/site-record.ts'))
    // The whole query is one tagged template; look at just its own lines.
    const endorsementQuery = code.slice(code.indexOf('site_endorsements'))
    expect(endorsementQuery).not.toMatch(/user_id\s*,|SELECT\s+user_id/i)
  })

  it('the endorse endpoints return only siteId and the aggregate state, not a user id', () => {
    for (const file of ['api/sites/[id]/endorse.post.ts', 'api/sites/[id]/endorse.delete.ts']) {
      const code = stripComments(read(file))
      const returnStatement = code.slice(code.lastIndexOf('return')).trim()
      // `userId` legitimately appears as an *argument* to readEndorsementState
      // (it needs the viewer's own id to compute `endorsedByMe`); what must
      // never appear is a `userId` *key* in the returned object literal.
      expect(returnStatement.startsWith('return { siteId, ...(await readEndorsementState(')).toBe(
        true,
      )
      expect(returnStatement).not.toMatch(/\buserId\s*[:,]/)
    }
  })
})
