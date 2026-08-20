import { describe, expect, it } from 'vitest'
import {
  applyReorder,
  canManageImage,
  nextSortOrder,
  normaliseOrder,
} from '../images-order'
import type { SessionUser } from '#shared/types'

const orderOf = (images: { id: number; sortOrder: number }[]): number[] =>
  [...images].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.id)

describe('normaliseOrder', () => {
  it('closes gaps left by earlier reorders', () => {
    const result = normaliseOrder([
      { id: 3, sortOrder: 10 },
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 5 },
    ])
    expect(result.map((image) => image.sortOrder)).toEqual([0, 1, 2])
    expect(orderOf(result)).toEqual([1, 2, 3])
  })

  it('breaks ties by id so imported rows at zero are stable', () => {
    const result = normaliseOrder([
      { id: 9, sortOrder: 0 },
      { id: 4, sortOrder: 0 },
      { id: 7, sortOrder: 0 },
    ])
    expect(orderOf(result)).toEqual([4, 7, 9])
  })
})

describe('applyReorder', () => {
  const images = [
    { id: 1, sortOrder: 0 },
    { id: 2, sortOrder: 1 },
    { id: 3, sortOrder: 2 },
    { id: 4, sortOrder: 3 },
  ]

  it('moves an image forwards', () => {
    expect(orderOf(applyReorder(images, 4, 0))).toEqual([4, 1, 2, 3])
  })

  it('moves an image backwards', () => {
    expect(orderOf(applyReorder(images, 1, 2))).toEqual([2, 3, 1, 4])
  })

  it('leaves the order untouched when nothing moves', () => {
    expect(orderOf(applyReorder(images, 2, 1))).toEqual([1, 2, 3, 4])
  })

  it('clamps a target beyond the end instead of losing the image', () => {
    expect(orderOf(applyReorder(images, 1, 99))).toEqual([2, 3, 4, 1])
  })

  it('clamps a negative target to the front', () => {
    expect(orderOf(applyReorder(images, 3, -5))).toEqual([3, 1, 2, 4])
  })

  it('ignores an id that is not in the set', () => {
    expect(orderOf(applyReorder(images, 999, 0))).toEqual([1, 2, 3, 4])
  })

  it('always returns a dense sequence', () => {
    const result = applyReorder(images, 4, 1)
    expect(result.map((image) => image.sortOrder).sort()).toEqual([0, 1, 2, 3])
  })
})

describe('nextSortOrder', () => {
  it('places the first image at zero', () => {
    expect(nextSortOrder([])).toBe(0)
  })

  it('appends after the highest existing position', () => {
    expect(nextSortOrder([{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 7 }])).toBe(8)
  })
})

describe('canManageImage', () => {
  const user = (id: number, role: SessionUser['role']): SessionUser => ({
    id,
    role,
    displayName: 'Tester',
    trustLevel: 1,
    approvedContributions: 3,
  })

  it('lets the uploader withdraw their own photograph', () => {
    expect(canManageImage(user(5, 'contributor'), 5)).toBe(true)
  })

  it('stops a contributor touching someone else’s photograph', () => {
    expect(canManageImage(user(5, 'contributor'), 6)).toBe(false)
  })

  it('lets a moderator manage any photograph', () => {
    expect(canManageImage(user(5, 'moderator'), 6)).toBe(true)
  })

  it('handles an image whose uploader account was deleted', () => {
    expect(canManageImage(user(5, 'contributor'), null)).toBe(false)
    expect(canManageImage(user(5, 'admin'), null)).toBe(true)
  })
})
