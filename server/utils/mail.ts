import type { TokenPurpose } from './tokens'
import { renderAccountEmail, renderTokenEmail } from './mail-template'
import type { MailKind } from './mail-template'

interface OutgoingMail {
  to: string
  subject: string
  text: string
  html: string
}

type MailTransport = 'lettermint' | 'dev-inbox' | 'log'

/**
 * Splits `Vestigia <no-reply@vestigia.org>` into its parts. Lettermint takes
 * the header form as one string; Mailpit's API wants the two separately.
 */
const parseAddress = (address: string): { name: string; email: string } => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(address)
  return match ? { name: match[1] ?? '', email: match[2]! } : { name: '', email: address.trim() }
}

/**
 * Lettermint, in Amsterdam. It replaced Resend for one reason: transactional
 * mail carries an address, a display name and the fact that a person has an
 * account here, and there is no reason for that to cross the Atlantic when the
 * CDN, the object store and the database have all been moved into the EU.
 *
 * `to` is an array — the one shape difference from the Resend call this
 * replaces, and the kind of thing that would fail quietly at 422.
 */
const sendThroughLettermint = async (message: OutgoingMail, apiKey: string, from: string) => {
  await $fetch('https://api.lettermint.co/v1/send', {
    method: 'POST',
    headers: { 'x-lettermint-token': apiKey },
    body: {
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    },
  })
}

/**
 * Mailpit, which `docker/compose.dev.yml` has always started and nothing ever
 * used. Its HTTP send API needs no SMTP client, so the styled mail can be read
 * at http://localhost:8025 exactly as it will arrive — a plain-text log line
 * cannot show whether the sheet renders.
 */
const sendToDevInbox = async (message: OutgoingMail, inboxUrl: string, from: string) => {
  const sender = parseAddress(from)

  await $fetch(`${inboxUrl.replace(/\/$/, '')}/api/v1/send`, {
    method: 'POST',
    body: {
      From: { Email: sender.email, Name: sender.name },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      HTML: message.html,
    },
  })
}

/**
 * Picks a transport and never throws.
 *
 * The swallowing is the point. `forgot-password` answers identically whether
 * or not the address has an account, and it can only do that if a provider
 * outage is invisible too: letting the error propagate would answer 500 for a
 * registered address and 200 for an unknown one, which is precisely the
 * enumeration oracle the endpoint exists to avoid. `mail_deliveries_total` and
 * the error log are what make the failure visible to the operator instead.
 */
const deliver = async (purpose: MailKind, message: OutgoingMail): Promise<void> => {
  const { mail } = useRuntimeConfig()
  const logger = useLogger()

  const transport: MailTransport = mail.apiKey
    ? 'lettermint'
    : import.meta.dev && mail.devInboxUrl
      ? 'dev-inbox'
      : 'log'

  try {
    if (transport === 'lettermint') {
      await sendThroughLettermint(message, mail.apiKey, mail.from)
    } else if (transport === 'dev-inbox') {
      await sendToDevInbox(message, mail.devInboxUrl, mail.from)
      logger.info({ recipient: message.to, subject: message.subject }, 'mail sent to dev inbox')
    } else if (import.meta.dev) {
      // The whole message, recipient and body, on purpose: this is how a
      // verification link is retrieved when walking the signup flow with no
      // provider and no Mailpit. `recipient` rather than `email` so the
      // logger's redaction does not censor the one field that makes it useful.
      logger.info(
        { recipient: message.to, subject: message.subject, text: message.text },
        'mail not sent: no api key and no dev inbox, printing instead',
      )
    } else {
      // In production an unset key is a misconfiguration that silently swallows
      // every verification and password-reset mail, which presents to the user
      // as an account they can never sign in to.
      logger.error(
        { email: message.to, subject: message.subject },
        'mail not sent: NUXT_MAIL_API_KEY is unset',
      )
      mailDeliveriesTotal().inc({ purpose, transport, outcome: 'unconfigured' })
      return
    }

    mailDeliveriesTotal().inc({ purpose, transport, outcome: 'sent' })
  } catch (error) {
    logger.error(
      { email: message.to, subject: message.subject, transport, error },
      'mail delivery failed',
    )
    mailDeliveriesTotal().inc({ purpose, transport, outcome: 'failed' })
  }
}

export interface TokenMail {
  to: string
  displayName: string
  link: string
  /** Shown in the message, so the reader knows how long they have. */
  expiresAt: Date
}

export const sendTokenMail = async (purpose: TokenPurpose, mail: TokenMail): Promise<void> => {
  const rendered = renderTokenEmail({
    purpose,
    displayName: mail.displayName,
    recipient: mail.to,
    link: mail.link,
    expiresAt: mail.expiresAt,
  })

  await deliver(purpose, {
    to: mail.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
}

export interface AccountMail {
  to: string
  displayName: string
  siteUrl: string
  occurredAt?: Date
  recordTitle?: string
  recordKind?: string
  recordUrl?: string
  moderatorName?: string
  note?: string | null
}

/**
 * The messages that report rather than grant: a password already changed, a
 * decision already taken. They carry no token, so nothing here expires and
 * nothing is single-use.
 */
export const sendAccountMail = async (
  kind: Exclude<MailKind, TokenPurpose>,
  mail: AccountMail,
): Promise<void> => {
  const rendered = renderAccountEmail({
    kind,
    displayName: mail.displayName,
    recipient: mail.to,
    siteUrl: mail.siteUrl,
    occurredAt: mail.occurredAt,
    recordTitle: mail.recordTitle,
    recordKind: mail.recordKind,
    recordUrl: mail.recordUrl,
    moderatorName: mail.moderatorName,
    note: mail.note,
  })

  await deliver(kind, {
    to: mail.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
}
