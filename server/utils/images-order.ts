import type { SessionUser } from '#shared/types'

export interface OrderableImage {
  id: number
  sortOrder: number
}

/**
 * Sort orders arrive from the database as whatever the last reorder left
 * behind — with gaps, duplicates, or all zeros for imported rows. Normalising
 * to a dense 0..n sequence before any move means the reorder maths never has to
 * reason about ties.
 */
export const normaliseOrder = (images: OrderableImage[]): OrderableImage[] =>
  [...images]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((image, index) => ({ id: image.id, sortOrder: index }))

/**
 * Moves one image to a new position, returning the full new ordering rather
 * than a delta. Writing every row is cheap at this scale and removes a whole
 * class of bug where two concurrent reorders leave the sequence inconsistent.
 */
export const applyReorder = (
  images: OrderableImage[],
  movedId: number,
  targetIndex: number,
): OrderableImage[] => {
  const ordered = normaliseOrder(images)
  const currentIndex = ordered.findIndex((image) => image.id === movedId)

  if (currentIndex === -1) return ordered

  const clampedTarget = Math.max(0, Math.min(targetIndex, ordered.length - 1))
  if (clampedTarget === currentIndex) return ordered

  const [moved] = ordered.splice(currentIndex, 1)
  ordered.splice(clampedTarget, 0, moved!)

  return ordered.map((image, index) => ({ id: image.id, sortOrder: index }))
}

/** Where a newly uploaded image lands: at the end, never displacing a choice. */
export const nextSortOrder = (images: OrderableImage[]): number =>
  images.length === 0 ? 0 : Math.max(...images.map((image) => image.sortOrder)) + 1

/**
 * Who may unpublish or re-order a photograph.
 *
 * The uploader keeps control of their own image, which matters because someone
 * who uploads a photograph they did not have the right to share must be able to
 * withdraw it without waiting on a moderator.
 */
export const canManageImage = (user: SessionUser, uploaderId: number | null): boolean =>
  user.role === 'moderator' || user.role === 'admin' || user.id === uploaderId
