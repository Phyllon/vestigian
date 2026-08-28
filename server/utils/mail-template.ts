import type { TokenPurpose } from './tokens'

/**
 * Every message this project sends, set as a page from the notebook rather
 * than as a wall of grey text.
 *
 * Kept free of Nitro imports on purpose: it takes strings and returns strings,
 * which is what makes the escaping testable without a server.
 *
 * Email is not the web. Three constraints shape everything below and none of
 * them are preference:
 *
 * - **Every style is inline.** Gmail keeps a `<style>` block in the head only
 *   sometimes and strips it outright when a message is forwarded, so the block
 *   at the top carries the dark-mode and narrow-screen overrides *only* — the
 *   design survives without it.
 * - **Tables, not flexbox.** Outlook renders through Word, which has no
 *   `display:flex`, no `max-width` on a `div` and no `border-radius`.
 * - **No web fonts.** The brief's answer for a client that cannot load
 *   Fraunces is the same one the CSP gives the browser: no runtime request to
 *   anyone. Georgia stands in for the display face, and it is the closest
 *   thing to it that is already on the machine.
 *
 * The W3C checker therefore reports these documents as invalid HTML5 —
 * `cellpadding`, `cellspacing`, `border`, `width`, `align` and `bgcolor` are
 * all obsolete, and all of them are load-bearing here. Those errors are the
 * expected output, not a backlog; nothing else should appear beside them.
 */

/** Notebook palette, duplicated here because an email cannot read `main.css`. */
const PAPER = '#f2ede1'
const SHEET = '#faf7ef'
const RULE = '#d6cbb2'
const HAIRLINE = '#e7dfcd'
const INK = '#1c1815'
const INK_BODY = '#3d362e'
const INK_MUTED = '#635a4d'
const OXIDE = '#9a3b22'

const NIGHT_GROUND = '#17140f'
const NIGHT_SHEET = '#211d17'
const NIGHT_RULE = '#2e2820'
const NIGHT_INK = '#f2ede1'
const NIGHT_MUTED = '#b9ab8d'

const DISPLAY_FACE = "Georgia, 'Iowan Old Style', 'Times New Roman', serif"
const BODY_FACE = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const MONO_FACE = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

/**
 * What the atlas will write to somebody unprompted. Two of these carry a link
 * that grants something; the other four only report what has already happened,
 * which is why they have no expiry and, mostly, no button.
 */
export type MailKind =
  | TokenPurpose
  | 'password-changed'
  | 'revision-approved'
  | 'revision-rejected'
  | 'trust-suspended'
  | 'trust-restored'

/**
 * Display names, record titles, moderator notes and email addresses are all
 * written by people. Interpolating any of them into markup unescaped would let
 * a display name carry a link of its own into somebody else's inbox.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * A subject line is a header, and a record title reaches this from a form.
 * Newlines are folded out before it can become two headers, and the length is
 * clipped well under the 998 characters the API accepts.
 */
export const sanitiseSubject = (subject: string): string => {
  const folded = subject.replace(/\s+/g, ' ').trim()
  return folded.length > 160 ? `${folded.slice(0, 159)}…` : folded
}

/**
 * One timestamp format for every mail, in UTC and named as such. A reader in
 * Vienna reading "expires at 15:32" has to know which 15:32 is meant, and the
 * server has no idea where they are.
 */
export const formatMailTimestamp = (moment: Date): string =>
  `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(moment)} UTC`

interface EmailFact {
  label: string
  value: string
}

interface EmailAction {
  label: string
  href: string
}

interface EmailCopy {
  subject: string
  /** The line the inbox shows after the subject. Unset, clients quote the markup. */
  preheader: string
  heading: string
  paragraphs: string[]
  /** Absent when the message reports something rather than asking for it. */
  action?: EmailAction
  facts: EmailFact[]
  /** A moderator's own words, shown verbatim and never paraphrased. */
  note?: string | null
  /** What to do if the message was not expected. Always the last thing said. */
  reassurance: string
  /** Why this landed in the inbox, for the footer. */
  footerReason: string
  /** Only a one-time link earns the paste-it-yourself block. */
  showPasteFallback: boolean
}

interface MailContext {
  displayName: string
  recipient: string
  siteUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface TokenEmailInput {
  purpose: TokenPurpose
  displayName: string
  /** The address the mail is going to, restated so the reader knows which account. */
  recipient: string
  link: string
  expiresAt: Date
  requestedAt?: Date
  /** Where the footer points. Defaults to the link's own origin. */
  siteUrl?: string
}

export interface AccountEmailInput {
  kind: Exclude<MailKind, TokenPurpose>
  displayName: string
  recipient: string
  siteUrl: string
  /** When the thing being reported happened. Defaults to now. */
  occurredAt?: Date
  /** The record a review decision is about. */
  recordTitle?: string
  /** 'site' or 'tracing', for the sentence that names it. */
  recordKind?: string
  /** Where that record lives, when it has a page. */
  recordUrl?: string
  /** The moderator who acted, named because the revision history names them too. */
  moderatorName?: string
  /** What the moderator wrote. Shown as a quotation, never edited. */
  note?: string | null
}

const buildTokenCopy = (input: TokenEmailInput): EmailCopy => {
  const expiry = formatMailTimestamp(input.expiresAt)
  const requested = formatMailTimestamp(input.requestedAt ?? new Date())
  const footerReason = `This message was sent to ${input.recipient} because that address was entered at ${input.siteUrl ?? new URL(input.link).origin}. It is not a newsletter and there is nothing to unsubscribe from.`

  if (input.purpose === 'verify-email') {
    return {
      subject: 'Confirm your Vestigia account',
      preheader: `Confirm ${input.recipient} to finish setting up your account. The link works until ${expiry}.`,
      heading: 'Confirm your address',
      paragraphs: [
        `An account was opened at Vestigia with this address, ${input.recipient}. Confirming it is the last step — until then the account cannot sign in.`,
        'Your first two contributions are read by a moderator before they appear on the map. After that they publish as you write them.',
      ],
      action: { label: 'Confirm this address', href: input.link },
      facts: [
        { label: 'Account', value: input.displayName },
        { label: 'Address', value: input.recipient },
        { label: 'Link expires', value: expiry },
        { label: 'Uses', value: 'Once' },
      ],
      reassurance:
        'If you did not sign up, nothing further is needed: an unconfirmed account cannot be used and is of no use to anyone else.',
      footerReason,
      showPasteFallback: true,
    }
  }

  return {
    subject: 'Reset your Vestigia password',
    preheader: `Set a new password for ${input.recipient}. The link works once, until ${expiry}.`,
    heading: 'Set a new password',
    paragraphs: [
      `Someone asked to reset the password for the Vestigia account registered to ${input.recipient}. If that was you, the link below opens the form to set a new one.`,
    ],
    action: { label: 'Set a new password', href: input.link },
    facts: [
      { label: 'Account', value: input.displayName },
      { label: 'Requested', value: requested },
      { label: 'Link expires', value: expiry },
      { label: 'Uses', value: 'Once' },
    ],
    reassurance:
      'If you did not ask for this, ignore the message. Your password has not changed, and it will not change until this link is used.',
    footerReason,
    showPasteFallback: true,
  }
}

const buildAccountCopy = (input: AccountEmailInput): EmailCopy => {
  const when = formatMailTimestamp(input.occurredAt ?? new Date())
  const site = input.siteUrl.replace(/\/$/, '')
  const title = input.recordTitle ?? 'your contribution'
  const recordKind = input.recordKind === 'tracing' ? 'tracing' : 'record'
  const footerReason = `This message was sent to ${input.recipient} because it is the address on your Vestigia account. Only account and moderation events are sent this way — there is no newsletter to unsubscribe from.`

  const reviewFacts: EmailFact[] = [
    { label: 'Record', value: title },
    { label: 'Reviewed', value: when },
    ...(input.moderatorName ? [{ label: 'Reviewed by', value: input.moderatorName }] : []),
  ]

  switch (input.kind) {
    case 'password-changed':
      return {
        subject: 'Your Vestigia password was changed',
        preheader: `The password for ${input.recipient} was changed on ${when}.`,
        heading: 'Your password was changed',
        paragraphs: [
          `The password for the Vestigia account registered to ${input.recipient} has been changed. Nothing else about the account was touched, and the new password works from now.`,
          'If that was not you, take the account back with the button below: setting a password voids every outstanding reset link, this one included.',
        ],
        action: { label: 'Reset the password', href: `${site}/forgot-password` },
        facts: [
          { label: 'Account', value: input.displayName },
          { label: 'Changed', value: when },
        ],
        reassurance:
          'Vestigia will never ask you for a password by email, and no message from us will ever contain one.',
        footerReason,
        showPasteFallback: false,
      }

    case 'revision-approved':
      return {
        subject: sanitiseSubject(`Published: ${title}`),
        preheader: `A moderator published your ${recordKind}, ${title}. It is on the map now.`,
        heading: 'Your contribution is live',
        paragraphs: [
          `A moderator has reviewed your ${recordKind} “${title}” and published it. It is on the map now, and the change is recorded in that record's history under your name.`,
        ],
        action: input.recordUrl ? { label: 'Open the record', href: input.recordUrl } : undefined,
        facts: [{ label: 'Decision', value: 'Published' }, ...reviewFacts],
        note: input.note,
        reassurance:
          'Accepted contributions count towards publishing without review: after two of them, your edits appear as you write them.',
        footerReason,
        showPasteFallback: false,
      }

    case 'revision-rejected':
      return {
        subject: sanitiseSubject(`Not published: ${title}`),
        preheader: `A moderator did not publish your ${recordKind}, ${title}. Nothing on the map changed.`,
        heading: 'Your contribution was not published',
        paragraphs: [
          `A moderator has reviewed your ${recordKind} “${title}” and decided not to publish it. Nothing was written to the atlas: if you were editing an existing record, it still reads as it did before.`,
          // Only promise an explanation when one was actually written. The
          // queue's note field is optional, and a batch decision may cover
          // fifty records with one sentence or with none at all.
          input.note
            ? 'You are welcome to record it again, addressing what the note below says was missing.'
            : 'You are welcome to record it again — with a source, a clearer position, or more detail than the version that was reviewed.',
        ],
        action: { label: 'Back to the map', href: input.recordUrl ?? site },
        facts: [{ label: 'Decision', value: 'Not published' }, ...reviewFacts],
        note: input.note,
        reassurance:
          'A contribution that is not published costs you nothing. Your standing and your accepted contributions are unchanged.',
        footerReason,
        showPasteFallback: false,
      }

    case 'trust-suspended':
      return {
        subject: 'Your Vestigia edits now wait for review',
        preheader: 'A moderator has suspended automatic publishing on your account.',
        heading: 'Your edits now wait for review',
        paragraphs: [
          'A moderator has suspended automatic publishing on your account. You can still record sites and edit existing ones; each change now waits in the review queue before it appears on the map.',
          'Your accepted contributions have not been touched. If publishing is restored, you return to exactly the standing you had.',
        ],
        facts: [
          { label: 'Account', value: input.displayName },
          { label: 'Suspended', value: when },
          ...(input.moderatorName ? [{ label: 'By', value: input.moderatorName }] : []),
        ],
        note: input.note,
        reassurance:
          'Nothing you have contributed has been removed, and a suspension is not a deletion — it is a return to the queue every new account starts in.',
        footerReason,
        showPasteFallback: false,
      }

    case 'trust-restored':
      return {
        subject: 'Your Vestigia edits publish immediately again',
        preheader: 'Automatic publishing has been restored on your account.',
        heading: 'Your edits publish immediately again',
        paragraphs: [
          'Automatic publishing has been restored on your account. Your edits go straight to the map again, as they did before, and anything still waiting in the queue is reviewed as normal.',
        ],
        action: { label: 'Open the atlas', href: site },
        facts: [
          { label: 'Account', value: input.displayName },
          { label: 'Restored', value: when },
          ...(input.moderatorName ? [{ label: 'By', value: input.moderatorName }] : []),
        ],
        note: input.note,
        reassurance:
          'Everything you contributed in the meantime still counts; nothing had to be recorded twice.',
        footerReason,
        showPasteFallback: false,
      }
  }
}

const renderFactRows = (facts: EmailFact[]): string =>
  facts
    .map(
      (fact) => `
              <tr>
                <td class="muted" style="padding:0 12px 6px 0;font-family:${MONO_FACE};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${INK_MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(fact.label)}</td>
                <td class="ink" style="padding:0 0 6px;font-family:${MONO_FACE};font-size:13px;color:${INK_BODY};vertical-align:top;">${escapeHtml(fact.value)}</td>
              </tr>`,
    )
    .join('')

const renderParagraphs = (paragraphs: string[]): string =>
  paragraphs
    .map(
      (paragraph) =>
        `<p class="ink" style="margin:0 0 14px;font-family:${BODY_FACE};font-size:16px;line-height:1.6;color:${INK_BODY};">${escapeHtml(paragraph)}</p>`,
    )
    .join('')

/** The moderator's own words, set off the way the review queue quotes them. */
const renderNote = (note: string): string => `
            <tr>
              <td class="pad" style="padding:22px 34px 0;">
                <div class="fallback" style="background-color:${PAPER};border-left:2px solid ${RULE};padding:12px 14px;">
                  <p class="muted" style="margin:0 0 6px;font-family:${MONO_FACE};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${INK_MUTED};">From the moderator</p>
                  <p class="ink" style="margin:0;font-family:${BODY_FACE};font-size:15px;line-height:1.6;font-style:italic;color:${INK_BODY};">${escapeHtml(note)}</p>
                </div>
              </td>
            </tr>`

const renderAction = (action: EmailAction): string => `
            <tr>
              <td class="pad" style="padding:8px 34px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${OXIDE}" style="background-color:${OXIDE};border-radius:2px;">
                      <a href="${escapeHtml(action.href)}" style="display:inline-block;padding:13px 24px;font-family:${BODY_FACE};font-size:16px;line-height:1;font-weight:600;color:${SHEET};text-decoration:none;border-radius:2px;">${escapeHtml(action.label)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`

const renderPasteFallback = (href: string): string => {
  const link = escapeHtml(href)

  return `
            <tr>
              <td class="pad" style="padding:20px 34px 0;">
                <p class="muted" style="margin:0 0 8px;font-family:${BODY_FACE};font-size:13px;line-height:1.5;color:${INK_MUTED};">If the button does nothing, paste this into the address bar:</p>
                <div class="fallback" style="background-color:${PAPER};border:1px solid ${HAIRLINE};border-radius:2px;padding:10px 12px;">
                  <a href="${link}" class="muted" style="font-family:${MONO_FACE};font-size:12px;line-height:1.5;color:${INK_MUTED};text-decoration:none;word-break:break-all;">${link}</a>
                </div>
              </td>
            </tr>`
}

/**
 * The sheet. One oxide accent — the button, where there is one — as the brief
 * allows per screen, and the same hairline rule the interface draws under a
 * panel header.
 */
const renderHtml = (copy: EmailCopy, context: MailContext): string => {
  const homeLink = escapeHtml(context.siteUrl.replace(/\/$/, ''))

  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(copy.subject)}</title>
    <style>
      /* Progressive enhancement only — every rule here has an inline default. */
      @media (max-width: 600px) {
        .pad { padding-left: 20px !important; padding-right: 20px !important; }
        .display { font-size: 24px !important; }
      }
      @media (prefers-color-scheme: dark) {
        .ground { background-color: ${NIGHT_GROUND} !important; }
        .sheet { background-color: ${NIGHT_SHEET} !important; border-color: ${NIGHT_RULE} !important; }
        .display, .ink { color: ${NIGHT_INK} !important; }
        .muted { color: ${NIGHT_MUTED} !important; }
        .rule { border-color: ${NIGHT_RULE} !important; }
        .fallback { background-color: ${NIGHT_GROUND} !important; border-color: ${NIGHT_RULE} !important; }
      }
    </style>
  </head>
  <body class="ground" style="margin:0;padding:0;background-color:${PAPER};">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${PAPER};">${escapeHtml(copy.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>

    <table role="presentation" class="ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
      <tr>
        <td align="center" style="padding:28px 12px 40px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="sheet" style="width:100%;max-width:600px;background-color:${SHEET};border:1px solid ${HAIRLINE};border-radius:2px;">
            <tr>
              <td class="pad" style="padding:30px 34px 0;">
                <span class="display" style="font-family:${DISPLAY_FACE};font-size:28px;line-height:1;color:${INK};letter-spacing:-0.01em;">Vestigia</span>
                <span class="muted" style="font-family:${MONO_FACE};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${INK_MUTED};padding-left:10px;">traces of antiquity</span>
                <div class="rule" style="border-top:1px solid ${RULE};margin-top:18px;font-size:0;line-height:0;">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td class="pad" style="padding:26px 34px 0;">
                <h1 class="display" style="margin:0 0 16px;font-family:${DISPLAY_FACE};font-size:27px;line-height:1.2;font-weight:normal;color:${INK};letter-spacing:-0.011em;">${escapeHtml(copy.heading)}</h1>
                <p class="ink" style="margin:0 0 14px;font-family:${BODY_FACE};font-size:16px;line-height:1.6;color:${INK_BODY};">${escapeHtml(context.displayName)},</p>
                ${renderParagraphs(copy.paragraphs)}
              </td>
            </tr>
${copy.note ? renderNote(copy.note) : ''}${copy.action ? renderAction(copy.action) : ''}
            <tr>
              <td class="pad" style="padding:26px 34px 0;">
                <div class="rule" style="border-top:1px solid ${HAIRLINE};padding-top:16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${renderFactRows(copy.facts)}
                  </table>
                </div>
              </td>
            </tr>

            <tr>
              <td class="pad" style="padding:20px 34px 0;">
                <p class="muted" style="margin:0;font-family:${BODY_FACE};font-size:14px;line-height:1.6;color:${INK_MUTED};">${escapeHtml(copy.reassurance)}</p>
              </td>
            </tr>
${copy.showPasteFallback && copy.action ? renderPasteFallback(copy.action.href) : ''}
            <tr>
              <td style="padding:0 0 32px;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>

          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td class="pad" align="center" style="padding:18px 34px 0;">
                <p class="muted" style="margin:0 0 4px;font-family:${BODY_FACE};font-size:12px;line-height:1.6;color:${INK_MUTED};">
                  <a href="${homeLink}" class="muted" style="color:${INK_MUTED};text-decoration:underline;">Vestigia</a> — an atlas of the ancient world, recorded by the people who visit it.
                </p>
                <p class="muted" style="margin:0;font-family:${BODY_FACE};font-size:12px;line-height:1.6;color:${INK_MUTED};">
                  ${escapeHtml(copy.footerReason)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * The plain-text half, and not an afterthought: it is what a text-only client
 * shows, what a screen reader may fall back to, and what lands in the
 * development log when no provider is configured.
 */
const renderText = (copy: EmailCopy, context: MailContext): string =>
  [
    `${context.displayName},`,
    '',
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(copy.note ? [`From the moderator: “${copy.note}”`, ''] : []),
    ...(copy.action ? [`${copy.action.label}:`, copy.action.href, ''] : []),
    ...copy.facts.map((fact) => `${fact.label}: ${fact.value}`),
    '',
    copy.reassurance,
    '',
    '—',
    'Vestigia — an atlas of the ancient world.',
    copy.footerReason,
  ].join('\n')

const render = (copy: EmailCopy, context: MailContext): RenderedEmail => ({
  subject: sanitiseSubject(copy.subject),
  html: renderHtml(copy, context),
  text: renderText(copy, context),
})

/** The two messages that carry a link granting something. */
export const renderTokenEmail = (input: TokenEmailInput): RenderedEmail =>
  render(buildTokenCopy(input), {
    displayName: input.displayName,
    recipient: input.recipient,
    siteUrl: input.siteUrl ?? new URL(input.link).origin,
  })

/** The messages that report something that has already happened. */
export const renderAccountEmail = (input: AccountEmailInput): RenderedEmail =>
  render(buildAccountCopy(input), {
    displayName: input.displayName,
    recipient: input.recipient,
    siteUrl: input.siteUrl,
  })
