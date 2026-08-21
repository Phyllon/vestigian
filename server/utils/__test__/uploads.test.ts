import { describe, expect, it } from 'vitest'
import { buildStorageKey, detectImageFormat, inspectUpload, MAX_UPLOAD_BYTES } from '../uploads'

const padded = (header: number[], size = 4096): Buffer => {
  const buffer = Buffer.alloc(size)
  Buffer.from(header).copy(buffer)
  return buffer
}

const JPEG = padded([0xff, 0xd8, 0xff, 0xe0])
const PNG = padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const webp = (): Buffer => {
  const buffer = Buffer.alloc(4096)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  return buffer
}

describe('detectImageFormat', () => {
  it('identifies the three accepted formats by signature', () => {
    expect(detectImageFormat(JPEG)).toBe('jpeg')
    expect(detectImageFormat(PNG)).toBe('png')
    expect(detectImageFormat(webp())).toBe('webp')
  })

  it('rejects an SVG dressed up as an image', () => {
    expect(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
  })

  it('rejects a buffer too short to carry a signature', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull()
  })
})

describe('inspectUpload', () => {
  it('accepts a well-formed jpeg', () => {
    const verdict = inspectUpload({ bytes: JPEG, declaredType: 'image/jpeg', filename: 'a.jpg' })
    expect(verdict).toEqual({ accepted: true, format: 'jpeg', reason: null })
  })

  it('treats image/jpg and image/jpeg as the same declaration', () => {
    expect(
      inspectUpload({ bytes: JPEG, declaredType: 'image/jpg', filename: 'a.jpg' }).accepted,
    ).toBe(true)
  })

  it('refuses a file whose real format contradicts its declared type', () => {
    const verdict = inspectUpload({ bytes: PNG, declaredType: 'image/jpeg', filename: 'a.jpg' })
    expect(verdict.reason).toBe('type-mismatch')
  })

  it('enforces the size ceiling', () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1)
    Buffer.from([0xff, 0xd8, 0xff]).copy(oversized)
    expect(
      inspectUpload({ bytes: oversized, declaredType: 'image/jpeg', filename: 'a.jpg' }).reason,
    ).toBe('too-large')
  })

  it('accepts an upload with no declared type at all', () => {
    expect(
      inspectUpload({ bytes: JPEG, declaredType: undefined, filename: undefined }).accepted,
    ).toBe(true)
  })
})

describe('buildStorageKey', () => {
  it('never incorporates a user-supplied filename', () => {
    expect(buildStorageKey(4711, 22)).toBe('sites/4711/22.jpg')
  })
})
