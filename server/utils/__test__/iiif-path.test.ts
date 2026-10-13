import { describe, expect, it } from 'vitest'
import { isSafeIiifPath } from '../iiif-path'

describe('isSafeIiifPath', () => {
  it.each([
    'petersen1896tafeln1%3A0013/info.json',
    'petersen1896tafeln1:0013/info.json',
    'petersen1896tafeln1%3A0013/full/1024,/0/default.jpg',
    'petersen1896tafeln2%3A0100/0,512,512,512/256,/0/default.jpg',
    'petersen1896tafeln1%3A0013/pct:10,10,50,50/max/0/default.jpg',
  ])('accepts an image-service request: %s', (path) => {
    expect(isSafeIiifPath(path)).toBe(true)
  })

  it.each([
    ['a dot-segment', '../../diglit/secret'],
    ['an encoded dot-segment', '%2e%2e/%2e%2e/secret'],
    ['a double-encoded dot-segment', '%252e%252e/secret'],
    ['an encoded slash', 'petersen1896tafeln1%2F..%2Fsecret/info.json'],
    ['a backslash', 'petersen1896tafeln1/..\\secret'],
    ['a query string', 'petersen1896tafeln1%3A0013/info.json?x=1'],
    ['an @', '@example.org/info.json'],
    ['an empty segment', 'petersen1896tafeln1//info.json'],
    ['a trailing slash', 'petersen1896tafeln1/'],
    ['nothing', ''],
    ['a malformed escape', 'petersen1896tafeln1%ZZ/info.json'],
    ['too many segments', 'a/b/c/d/e/f/g/h/i'],
    ['an enormous path', `a${'b'.repeat(400)}/info.json`],
  ])('refuses %s', (_label, path) => {
    expect(isSafeIiifPath(path)).toBe(false)
  })
})
