import type { TokenPurpose } from './tokens'

interface OutgoingMail {
  to: string
  subject: string
  text: string
}

/**
 * Transactional mail through Resend. Without an API key — which is the normal
 * state in development — the message is written to the log instead, so the
 * verification flow can be walked end to end without configuring a provider.
 */
const deliver = async (message: OutgoingMail): Promise<void> => {
  const { mail } = useRuntimeConfig()

  if (!mail.apiKey) {
    if (import.meta.dev) {
      // The whole message, recipient and body, on purpose: nothing in this
      // project speaks SMTP, so this line is how a verification link is
      // retrieved when walking the signup flow locally. `recipient` rather than
      // `email` so the logger's redaction does not censor the one field that
      // makes it useful.
      useLogger().info(
        { recipient: message.to, subject: message.subject, text: message.text },
        'mail not sent: no api key, printing instead',
      )
      return
    }

    // In production an unset key is a misconfiguration that silently swallows
    // every verification and password-reset mail, which presents to the user as
    // an account they can never sign in to.
    useLogger().error(
      { email: message.to, subject: message.subject },
      'mail not sent: NUXT_MAIL_API_KEY is unset',
    )
    return
  }

  await $fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${mail.apiKey}` },
    body: {
      from: mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    },
  })
}

interface TokenMail {
  to: string
  displayName: string
  link: string
}

const TEMPLATES: Record<TokenPurpose, (mail: TokenMail) => OutgoingMail> = {
  'verify-email': (mail) => ({
    to: mail.to,
    subject: 'Confirm your Vestigia account',
    text: [
      `${mail.displayName},`,
      '',
      'Confirm this address to finish setting up your account:',
      mail.link,
      '',
      'The link works for one day. If you did not sign up, ignore this message —',
      'the account cannot be used until the address is confirmed.',
      '',
      'Vestigia',
    ].join('\n'),
  }),
  'reset-password': (mail) => ({
    to: mail.to,
    subject: 'Reset your Vestigia password',
    text: [
      `${mail.displayName},`,
      '',
      'Set a new password here:',
      mail.link,
      '',
      'The link works for one hour and only once. If you did not ask for this,',
      'nothing has changed and you can ignore this message.',
      '',
      'Vestigia',
    ].join('\n'),
  }),
}

export const sendTokenMail = async (purpose: TokenPurpose, mail: TokenMail): Promise<void> => {
  await deliver(TEMPLATES[purpose](mail))
}
