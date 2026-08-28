import type { Page } from '@playwright/test'

export interface BrowserResponse<T = unknown> {
  status: number
  body: T
}

/**
 * Calls an endpoint **from inside the page**, so the session cookie is sent.
 *
 * `page.request` looks like the obvious tool and quietly is not: the session
 * cookie is `Secure` (h3's default), and Playwright's Node-side request context
 * refuses to send a Secure cookie over plain HTTP. Chromium does send it,
 * because it treats 127.0.0.1 as a trustworthy origin — so the browser is
 * authenticated while `page.request` silently is not, and every API assertion
 * comes back 401 for a reason that has nothing to do with the application.
 *
 * Running the fetch in the page also means these assertions traverse the same
 * path a real visitor's browser does, including the CSP.
 */
export const fetchAsBrowser = async <T = unknown>(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<BrowserResponse<T>> =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, {
        method: init?.method ?? 'GET',
        headers: init?.body ? { 'content-type': 'application/json' } : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
      })

      const text = await response.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {
        // Not every endpoint answers JSON — tiles are binary, robots.txt is text.
      }
      return { status: response.status, body }
    },
    { path, init },
  ) as Promise<BrowserResponse<T>>
