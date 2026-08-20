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
    console.info(`\n[mail → ${message.to}] ${message.subject}\n${message.text}\n`)
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

export const sendTokenMail = async (
  purpose: TokenPurpose,
  mail: TokenMail,
): Promise<void> => {
  await deliver(TEMPLATES[purpose](mail))
}
