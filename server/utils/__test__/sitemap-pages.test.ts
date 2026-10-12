import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITEMAP_DYNAMIC_ROUTES, SITEMAP_LEFT_OUT, SITEMAP_STATIC_PATHS } from '../sitemap-pages'
import { SITEMAP_SOURCES } from '../sitemap-sources'

const PAGES_DIRECTORY = join(process.cwd(), 'app', 'pages')

const listVueFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listVueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })

/** `site/[slug]/index.vue` → `/site/[slug]`, `index.vue` → `/`. */
const routeOf = (file: string): string => {
  const withoutExtension = relative(PAGES_DIRECTORY, file).replace(/\.vue$/, '')
  const segments = withoutExtension.split('/').filter((segment) => segment !== 'index')
  return `/${segments.join('/')}`
}

const pages = listVueFiles(PAGES_DIRECTORY).map((file) => ({
  route: routeOf(file),
  isNoIndex: readFileSync(file, 'utf8').includes('useNoIndex('),
}))

describe('the sitemap and app/pages agree', () => {
  it('finds the pages it is meant to compare against', () => {
    expect(pages.length).toBeGreaterThan(20)
    expect(pages.map((page) => page.route)).toContain('/site/[slug]')
  })

  it('accounts for every indexable page — listed, or left out with a reason', () => {
    const known = new Set<string>([
      ...SITEMAP_STATIC_PATHS,
      ...Object.keys(SITEMAP_DYNAMIC_ROUTES),
      ...Object.keys(SITEMAP_LEFT_OUT),
    ])
    const unaccounted = pages
      .filter((page) => !page.isNoIndex && !known.has(page.route))
      .map((page) => page.route)
    expect(
      unaccounted,
      'add each to SITEMAP_STATIC_PATHS, SITEMAP_DYNAMIC_ROUTES or SITEMAP_LEFT_OUT (server/utils/sitemap-pages.ts)',
    ).toEqual([])
  })

  it('never lists a page that asks not to be indexed', () => {
    const listed = new Set<string>([
      ...SITEMAP_STATIC_PATHS,
      ...Object.keys(SITEMAP_DYNAMIC_ROUTES),
    ])
    const contradictions = pages
      .filter((page) => page.isNoIndex && listed.has(page.route))
      .map((page) => page.route)
    expect(contradictions).toEqual([])
  })

  it('lists nothing that no longer exists', () => {
    const existing = new Set(pages.map((page) => page.route))
    const stale = [
      ...SITEMAP_STATIC_PATHS,
      ...Object.keys(SITEMAP_DYNAMIC_ROUTES),
      ...Object.keys(SITEMAP_LEFT_OUT),
    ].filter((route) => !existing.has(route))
    expect(stale).toEqual([])
  })

  it('has a source for every dynamic route that names one', () => {
    const sourceNames = new Set(SITEMAP_SOURCES.map((source) => source.name))
    for (const [route, name] of Object.entries(SITEMAP_DYNAMIC_ROUTES)) {
      if (name === 'static') continue
      expect(sourceNames.has(name), `${route} → ${name}`).toBe(true)
    }
    for (const source of SITEMAP_SOURCES) {
      expect(Object.values(SITEMAP_DYNAMIC_ROUTES), source.name).toContain(source.name)
    }
  })
})
