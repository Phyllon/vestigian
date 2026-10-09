/**
 * The list is ~2 MB of domains. It is loaded on first use, not at import:
 * `server/utils` is auto-imported into every handler, so a top-level import
 * (and the `Set` built from it) put the whole list in the main server chunk
 * and paid for it on every start, though only registration and an email
 * change ever ask. Nitro splits a dynamic import into a chunk of its own.
 *
 * Hence the answer is a promise, and the check lives in the two handlers, not
 * in their zod schemas — a `.refine()` there would need an async parse.
 */
let disposableEmailDomainSet: Promise<ReadonlySet<string>> | undefined

const loadDisposableEmailDomains = (): Promise<ReadonlySet<string>> => {
  disposableEmailDomainSet ??= import('disposable-email-domains').then(
    (module) => new Set(module.default),
  )
  return disposableEmailDomainSet
}

export const isDisposableEmailDomain = async (email: string): Promise<boolean> => {
  const domain = email.trim().toLowerCase().split('@').at(-1)
  if (!domain) return false
  return (await loadDisposableEmailDomains()).has(domain)
}
