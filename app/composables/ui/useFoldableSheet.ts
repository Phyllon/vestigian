import type { Ref } from 'vue'
import { breakpointsTailwind, useBreakpoints, useDraggable, useEventListener } from '@vueuse/core'

/** Over a finger's own wobble on a tap, under a deliberate drag. */
const DRAG_THRESHOLD_PX = 8
/** Matches `duration-200` on the sheet. */
const SETTLE_MS = 200
/** The click a browser sends after a pointer is released over the control it was pressed on. */
const CLICK_AFTER_DRAG_MS = 60

export interface FoldableSheetOptions {
  /** The `aside`: the element whose `max-height` is driven. */
  panel: Readonly<Ref<HTMLElement | null>>
  /** The grey bar and title row. It is what a finger drags and what stays when the sheet is folded. */
  handle: Readonly<Ref<HTMLElement | null>>
  /**
   * The element that scrolls inside the sheet, when it is not the sheet itself.
   * Omit it for a sheet that is its own scroller: its open height is then its
   * own `scrollHeight`.
   */
  body?: Readonly<Ref<HTMLElement | null>>
  /**
   * The stylesheet's `max-height` as a share of `100dvh` (`max-h-[62dvh]` is
   * 0.62). It must be `dvh`: the drag clamps to `window.innerHeight`, which is
   * the dynamic viewport, and a `vh` ceiling left a few pixels' jump when the
   * browser's own bar was showing.
   */
  maxViewportRatio: number
  /** Share the folded state with something outside the sheet. Defaults to a ref of its own. */
  isCollapsed?: Ref<boolean>
  /**
   * The rail has a fold button of its own that hides the body without easing
   * (the frontier panel). Off, a rail never folds: a folded phone sheet that
   * is widened past `md` shows its whole body again.
   */
  foldsOnRail?: boolean
}

/**
 * A bottom sheet that can be folded down to its handle, by finger or by button.
 *
 * Below Tailwind's `md` the record panels and the frontier panel are sheets
 * over the map, and a sheet that cannot be put away hides the map completely —
 * the thing the reader opened it from. Above `md` they are rails and this does
 * nothing: there is no height to fold.
 *
 * **The grey bar is a handle.** The handle element can be dragged: up opens the
 * sheet, down folds it, and the sheet follows the finger meanwhile. The fold
 * button stays — dragging is a pointer gesture and `aria-expanded` is what a
 * keyboard or a screen reader gets — and it eases the sheet the way a released
 * drag does (`settleSheet`).
 *
 * **`useDraggable`, not `usePointerSwipe`.** The latter sets `touch-action:
 * pan-y` on its target, which is right for a horizontal swipe and hands the
 * vertical gesture straight back to the browser — `pointercancel` after the
 * first move, confirmed in a touch-emulated browser. This one leaves
 * `touch-action` to the `touch-none` the handle carries.
 *
 * **The caller owns three things the composable cannot:** `touch-none` on the
 * handle (so the browser does not take the gesture for a scroll), `v-show` on
 * the body bound to `isBodyShown`, and a click guard (`isJustAfterDrag`) on any
 * button inside the handle — a drag that starts on a button ends over it, and
 * the browser then clicks it, which would undo the gesture the moment it landed.
 */
export const useFoldableSheet = (options: FoldableSheetOptions) => {
  const { panel, handle, body, maxViewportRatio, foldsOnRail = false } = options
  const isCollapsed = options.isCollapsed ?? ref(false)

  /** Tailwind's own `md`: the width at which the sheet becomes a rail and there is nothing to drag. */
  const isSheet = useBreakpoints(breakpointsTailwind).smaller('md')

  const isDragging = ref(false)
  /** The script, not the stylesheet, owns the sheet's height: a finger let go, or the button was pressed. */
  const isSettling = ref(false)
  /** `transition-[max-height]` is on. Off for the frame that pins the sheet where it stands. */
  const isEasing = ref(false)
  /** The sheet's `max-height` in px while a finger holds it or it settles; `null` leaves it to the stylesheet. */
  const sheetHeight = ref<number | null>(null)
  const isBodyShown = computed(
    () =>
      !isCollapsed.value ||
      isDragging.value ||
      isSettling.value ||
      (!foldsOnRail && !isSheet.value),
  )

  let pointerStartY = 0
  let heightAtDragStart = 0
  let foldedHeight = 0
  let openHeight = 0
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let lastDragEndedAt = Number.NEGATIVE_INFINITY

  /** Reads the sheet's two resting heights. Nothing to drag when it is not a sheet. */
  const measureSheet = (): boolean => {
    const sheet = panel.value
    const grip = handle.value
    if (!sheet || !grip || !isSheet.value) return false
    heightAtDragStart = sheet.offsetHeight
    foldedHeight = grip.offsetHeight + Number.parseFloat(getComputedStyle(sheet).paddingBottom)
    openHeight = window.innerHeight * maxViewportRatio
    return true
  }

  /**
   * Where an open sheet comes to rest: as tall as its content, or the ceiling
   * when the content is longer. Easing towards the ceiling of short content
   * would run out of height half way and spend the rest of the 200ms standing
   * still.
   */
  const openRestingHeight = (): number => {
    const scroller = body?.value
    if (!scroller) return Math.min(openHeight, panel.value?.scrollHeight ?? openHeight)
    const border = scroller.offsetHeight - scroller.clientHeight
    return Math.min(openHeight, foldedHeight + scroller.scrollHeight + border)
  }

  /**
   * Eases the sheet to its folded or open height — for a released drag, which
   * is already held at a pixel height, and for the fold button, which is not.
   *
   * A transition needs a number to start from, and a sheet at rest has none:
   * its `max-height` is the stylesheet's, far above its own content, so easing
   * straight from that would sit still until the value came down to the
   * content. The button path therefore pins the sheet at the height it has,
   * lets that paint (a measurement, so the style is flushed), and only then
   * sets the target.
   */
  const settleSheet = async (folded: boolean): Promise<void> => {
    clearTimeout(settleTimer)
    isCollapsed.value = folded
    isSettling.value = true
    if (sheetHeight.value === null) {
      isEasing.value = false
      sheetHeight.value = heightAtDragStart
      await nextTick()
      panel.value?.getBoundingClientRect()
    }
    isEasing.value = true
    sheetHeight.value = folded ? foldedHeight : openRestingHeight()
    settleTimer = setTimeout(() => {
      isSettling.value = false
      isEasing.value = false
      sheetHeight.value = null
    }, SETTLE_MS)
  }

  /** Where a released drag ends up: the way it was going, or back where it was. */
  const isFoldedAfter = (upwardDistance: number): boolean => {
    if (upwardDistance > DRAG_THRESHOLD_PX) return false
    if (upwardDistance < -DRAG_THRESHOLD_PX) return true
    return isCollapsed.value
  }

  const followDrag = (upwardDistance: number): void => {
    if (!isDragging.value) {
      if (Math.abs(upwardDistance) < DRAG_THRESHOLD_PX || !measureSheet()) return
      clearTimeout(settleTimer)
      isSettling.value = false
      isEasing.value = false
      isDragging.value = true
    }
    sheetHeight.value = Math.min(
      Math.max(heightAtDragStart + upwardDistance, foldedHeight),
      openHeight,
    )
  }

  const releaseDrag = (upwardDistance: number): void => {
    if (!isDragging.value) return
    isDragging.value = false
    lastDragEndedAt = performance.now()
    void settleSheet(isFoldedAfter(upwardDistance))
  }

  const isJustAfterDrag = (): boolean => performance.now() - lastDragEndedAt < CLICK_AFTER_DRAG_MS

  const toggleCollapsed = (): void => {
    if (isJustAfterDrag()) return
    const folded = !isCollapsed.value
    if (measureSheet()) {
      void settleSheet(folded)
      return
    }
    // The rail: a full-height column with nothing to ease.
    if (foldsOnRail) isCollapsed.value = folded
  }

  /**
   * Back to the stylesheet's own height, unfolded, with no ease. For a sheet
   * that stays mounted while what it shows is replaced or put away: a folded
   * sheet must not greet the next record folded, nor a reopened one.
   */
  const unfold = (): void => {
    clearTimeout(settleTimer)
    isCollapsed.value = false
    isSettling.value = false
    isEasing.value = false
    isDragging.value = false
    sheetHeight.value = null
  }

  useDraggable(handle, {
    axis: 'y',
    onStart: (_position, event) => {
      pointerStartY = event.clientY
      return isSheet.value ? undefined : false
    },
    onMove: (_position, event) => {
      // A pointer that stopped touching but never said so (no `pointerup`).
      if (event.buttons === 0) return
      followDrag(pointerStartY - event.clientY)
    },
    onEnd: (_position, event) => releaseDrag(pointerStartY - event.clientY),
  })

  // A system gesture can take the pointer away mid-drag, and no `pointerup` follows.
  useEventListener(handle, 'pointercancel', () => releaseDrag(0))

  onBeforeUnmount(() => clearTimeout(settleTimer))

  return {
    isCollapsed,
    isDragging,
    isEasing,
    sheetHeight,
    isBodyShown,
    isJustAfterDrag,
    toggleCollapsed,
    unfold,
  }
}
