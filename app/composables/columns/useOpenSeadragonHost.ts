import type { Viewer } from 'openseadragon'

/**
 * The two things every OpenSeadragon viewer in this app has to get right about
 * the element it is mounted into. Both are here rather than duplicated in the
 * viewers because both were learned from a real failure, and the next viewer
 * should inherit the answers rather than the failures.
 */

/**
 * Resolves once `element` exists **and** has been laid out with a real size.
 *
 * A single `await nextTick()` is not enough. `.client.vue` components resolve
 * as async components, so their own template ref can still be unset when
 * `onMounted` first runs — the Marcus viewer's docstring already recorded
 * that, and noted it only survives because its manifest fetch happens to
 * yield first. The Trajan viewer has no fetch to hide behind and intermittently
 * initialised into nothing at all.
 *
 * Size matters as much as existence: OpenSeadragon computes its home bounds
 * from the container's measurements at `open()` time, so a viewer built
 * against a 0×0 element opens to degenerate bounds and shows an empty frame
 * until something forces a resize. Waiting for a laid-out element is what
 * stops that being possible.
 *
 * Returns null if the element never arrives within `timeoutMs`, so the caller
 * can report a failure rather than construct a viewer over nothing.
 */
export interface LaidOutElementRequest {
  read: () => HTMLElement | null | undefined
  timeoutMs?: number
}

export const waitForLaidOutElement = ({
  read,
  timeoutMs = 5000,
}: LaidOutElementRequest): Promise<HTMLElement | null> =>
  new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs

    const attempt = (): void => {
      const element = read()
      if (element && element.clientWidth > 0 && element.clientHeight > 0) {
        resolve(element)
        return
      }
      if (Date.now() >= deadline) {
        resolve(null)
        return
      }
      requestAnimationFrame(attempt)
    }

    requestAnimationFrame(attempt)
  })

/**
 * Leaves full-page mode before a viewer is destroyed.
 *
 * **`setFullPage(true)` sets `display: none` on every child of
 * `document.body`** except the viewer's own element, which it moves to the
 * body; the previous display values are restored *only* by `setFullPage(false)`
 * (confirmed in OpenSeadragon 6's own `Viewer.setFullPage`, not inferred).
 * `destroy()` does not do it. So a viewer destroyed while full-page — closing
 * the modal it lives in, or navigating away from the page — takes the entire
 * application off screen permanently, with no key or click able to bring it
 * back, because the element that knew how to restore it is gone.
 *
 * Every teardown path has to go through here first.
 */
export const releaseFullPage = (viewer: Viewer | null): void => {
  if (viewer?.isFullPage()) viewer.setFullPage(false)
}
