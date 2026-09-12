import disposableEmailDomains from 'disposable-email-domains'

const disposableEmailDomainSet = new Set(disposableEmailDomains)

export const isDisposableEmailDomain = (email: string): boolean => {
  const domain = email.trim().toLowerCase().split('@').at(-1)
  return domain ? disposableEmailDomainSet.has(domain) : false
}
