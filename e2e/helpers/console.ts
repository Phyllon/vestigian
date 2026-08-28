import type { ConsoleMessage, Page } from '@playwright/test'

export interface PageProblems {
  /** Content-Security-Policy refusals, which this project has shipped twice. */
  cspViolations: string[]
  consoleErrors: string[]
  pageErrors: string[]
}

/**
 * Collects everything the browser complained about during a test.
 *
 * CSP violations are separated out because they are the failure mode this
 * codebase actually has: a refused inline script once stopped Vue mounting
 * entirely, and a rewritten image URL once blocked every photograph. Both were
 * silent server-side — 200 everywhere, nothing in the logs.
 *
 * Attach before navigating; read after asserting on behaviour, so a broken page
 * reports what it was doing rather than only that it was noisy.
 */
export interface WatchOptions {
  /**
   * Patterns to treat as environment noise rather than failure. Every entry
   * needs a reason at the call site — this is the one place a real CSP bug
   * could be hidden, so nothing goes in it casually.
   */
  ignore?: RegExp[]
}

/**
 * The suite runs the **production** build against the **development** imgproxy,
 * which is served over plain HTTP. Production enables
 * `upgrade-insecure-requests`, so the browser rewrites
 * `http://localhost:8080/...` to `https://` before the `img-src` check and then
 * refuses it — the origin in the allowlist is the http one.
 *
 * That combination cannot occur in production, where the image host is https
 * and the directive is a no-op. It is a property of testing a production build
 * against a development dependency, not of the application.
 */
export const IMGPROXY_OVER_HTTP = /Loading the image 'https:\/\/localhost:8080\//

export const watchForProblems = (page: Page, options: WatchOptions = {}): PageProblems => {
  const problems: PageProblems = { cspViolations: [], consoleErrors: [], pageErrors: [] }

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()

    if (options.ignore?.some((pattern) => pattern.test(text))) return

    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) {
      problems.cspViolations.push(text)
      return
    }
    problems.consoleErrors.push(text)
  })

  page.on('pageerror', (error) => problems.pageErrors.push(error.message))

  return problems
}
