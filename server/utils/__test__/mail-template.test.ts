import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  formatMailTimestamp,
  renderAccountEmail,
  renderTokenEmail,
  sanitiseSubject,
} from '../mail-template'

const TOKEN_MAIL = {
  displayName: 'Marcus',
  recipient: 'marcus@example.org',
  link: 'https://vestigia.example/reset-password?token=abc123',
  expiresAt: new Date('2026-08-28T14:32:00.000Z'),
  requestedAt: new Date('2026-08-28T13:32:00.000Z'),
} as const

const ACCOUNT_MAIL = {
  displayName: 'Marcus',
  recipient: 'marcus@example.org',
  siteUrl: 'https://vestigia.example',
  occurredAt: new Date('2026-08-28T14:32:00.000Z'),
} as const

describe('escapeHtml', () => {
  it('neutralises markup a display name could carry into an inbox', () => {
    expect(escapeHtml('<a href="https://evil.example">Marcus</a>')).toBe(
      '&lt;a href=&quot;https://evil.example&quot;&gt;Marcus&lt;/a&gt;',
    )
  })

  it('escapes the ampersand first, so an entity cannot be reassembled', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;')
  })
})

describe('sanitiseSubject', () => {
  /** A record title reaches the subject line from a form, and a subject is a header. */
  it('folds the newlines a header cannot carry', () => {
    expect(sanitiseSubject('Published: Saalburg\nBcc: someone@example.org')).toBe(
      'Published: Saalburg Bcc: someone@example.org',
    )
  })

  it('clips a title long enough to be a body of its own', () => {
    const subject = sanitiseSubject(`Published: ${'a'.repeat(400)}`)

    expect(subject).toHaveLength(160)
    expect(subject.endsWith('…')).toBe(true)
  })
})

describe('formatMailTimestamp', () => {
  it('names the zone, because the reader is not on the server', () => {
    expect(formatMailTimestamp(new Date('2026-08-28T14:32:00.000Z'))).toBe('28 Aug 2026, 14:32 UTC')
  })
})

describe('renderTokenEmail', () => {
  it('carries the link, the expiry and the account in both halves', () => {
    const mail = renderTokenEmail({ purpose: 'reset-password', ...TOKEN_MAIL })

    for (const body of [mail.html, mail.text]) {
      expect(body).toContain(TOKEN_MAIL.link)
      expect(body).toContain('28 Aug 2026, 14:32 UTC')
      expect(body).toContain(TOKEN_MAIL.recipient)
      expect(body).toContain('Once')
    }

    expect(mail.subject).toBe('Reset your Vestigia password')
    expect(mail.text).toContain('Your password has not changed')
  })

  it('says what an unexpected verification mail means', () => {
    const mail = renderTokenEmail({ purpose: 'verify-email', ...TOKEN_MAIL })

    expect(mail.subject).toBe('Confirm your Vestigia account')
    expect(mail.html).toContain('Confirm this address')
    expect(mail.text).toContain('an unconfirmed account cannot be used')
  })

  /**
   * The one that matters. A display name is chosen by the person, and on the
   * reset path the address is chosen by whoever filled in the form — neither
   * may become markup in somebody else's mail client.
   */
  it('escapes the display name rather than rendering it as markup', () => {
    const mail = renderTokenEmail({
      purpose: 'reset-password',
      ...TOKEN_MAIL,
      displayName: '<img src=x onerror="alert(1)">',
    })

    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('keeps the preheader out of the visible body', () => {
    const mail = renderTokenEmail({ purpose: 'reset-password', ...TOKEN_MAIL })

    expect(mail.html).toContain('display:none')
    expect(mail.html).toContain('The link works once, until 28 Aug 2026, 14:32 UTC')
  })

  it('offers the link to paste, because a button can fail to be a button', () => {
    const mail = renderTokenEmail({ purpose: 'reset-password', ...TOKEN_MAIL })

    expect(mail.html).toContain('paste this into the address bar')
  })
})

describe('renderAccountEmail', () => {
  it('tells the owner a password changed and how to take the account back', () => {
    const mail = renderAccountEmail({ kind: 'password-changed', ...ACCOUNT_MAIL })

    expect(mail.subject).toBe('Your Vestigia password was changed')
    expect(mail.html).toContain('https://vestigia.example/forgot-password')
    expect(mail.text).toContain('28 Aug 2026, 14:32 UTC')
    // Nothing here expires, so there is no one-time link to paste.
    expect(mail.html).not.toContain('paste this into the address bar')
  })

  it('names the record and links to it when a contribution is published', () => {
    const mail = renderAccountEmail({
      kind: 'revision-approved',
      ...ACCOUNT_MAIL,
      recordTitle: 'Kastell Saalburg',
      recordKind: 'site',
      recordUrl: 'https://vestigia.example/site/kastell-saalburg',
      moderatorName: 'Livia',
    })

    expect(mail.subject).toBe('Published: Kastell Saalburg')
    expect(mail.html).toContain('https://vestigia.example/site/kastell-saalburg')
    expect(mail.text).toContain('Reviewed by: Livia')
  })

  it('says plainly that nothing changed when a contribution is refused', () => {
    const mail = renderAccountEmail({
      kind: 'revision-rejected',
      ...ACCOUNT_MAIL,
      recordTitle: 'Kastell Saalburg',
      recordKind: 'site',
      note: 'The position is 4 km east of the recorded site.',
    })

    expect(mail.subject).toBe('Not published: Kastell Saalburg')
    expect(mail.html).toContain('From the moderator')
    expect(mail.text).toContain('The position is 4 km east of the recorded site.')
    expect(mail.text).toContain('Your standing and your accepted contributions are unchanged.')
  })

  /** A moderator writes the note, and a record title comes from a contributor. */
  it('escapes the note and the title', () => {
    const mail = renderAccountEmail({
      kind: 'revision-rejected',
      ...ACCOUNT_MAIL,
      recordTitle: '<b>Saalburg</b>',
      note: '<script>alert(1)</script>',
    })

    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.html).toContain('&lt;b&gt;Saalburg&lt;/b&gt;')
  })

  /** The note is optional in the review queue, so both shapes have to read well. */
  it('promises an explanation only when a note was actually written', () => {
    const withNote = renderAccountEmail({
      kind: 'revision-rejected',
      ...ACCOUNT_MAIL,
      recordTitle: 'Kastell Saalburg',
      note: 'Position is 4 km out.',
    })
    const without = renderAccountEmail({
      kind: 'revision-rejected',
      ...ACCOUNT_MAIL,
      recordTitle: 'Kastell Saalburg',
    })

    expect(withNote.text).toContain('what the note below says was missing')
    expect(without.text).not.toContain('note below')
    expect(without.html).not.toContain('From the moderator')
  })

  it('offers no action when a suspension leaves nothing to do', () => {
    const mail = renderAccountEmail({
      kind: 'trust-suspended',
      ...ACCOUNT_MAIL,
      moderatorName: 'Livia',
      note: 'Three edits removed sourced text.',
    })

    expect(mail.html).not.toContain(`background-color:#9a3b22`)
    expect(mail.html).toContain('waits in the review queue')
    expect(mail.text).toContain('Suspended: 28 Aug 2026, 14:32 UTC')
  })

  it('says what restoring trust restores', () => {
    const mail = renderAccountEmail({ kind: 'trust-restored', ...ACCOUNT_MAIL })

    expect(mail.subject).toBe('Your Vestigia edits publish immediately again')
    expect(mail.html).toContain('Open the atlas')
  })

  it('explains the inbox it landed in without promising an unsubscribe', () => {
    const mail = renderAccountEmail({ kind: 'trust-restored', ...ACCOUNT_MAIL })

    expect(mail.text).toContain('because it is the address on your Vestigia account')
    expect(mail.html).toContain('there is no newsletter to unsubscribe from')
  })
})
