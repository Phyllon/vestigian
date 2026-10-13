import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { showSites, waitForMapReady, waitForTiles } from './helpers/map'

/**
 * Sites that lie on top of one another are redrawn by `useSiteArrangement`:
 * spread into a ring or grid, shrunk, and hidden from the tile layers so none
 * is drawn twice. The arrangement itself is canvas pixels, which nothing here
 * can read — what a browser can show is that the machinery around it is wired:
 * the expressions it hands MapLibre are valid (an invalid one is a console
 * error, not a thrown exception), and a tap on a dense district still reaches
 * the records through the arranged layers.
 *
 * Central Rome at zoom 13: several hundred records inside a viewport, enough
 * that most of them are arranged.
 */
const DENSE_DISTRICT = '/#map=13/41.89/12.49'

test.describe('overlapping sites', () => {
  test('are spread without a style error, and a dense tap still lists its records', async ({
    page,
  }) => {
    // A missing glyph range (`/fonts/…/9472-9727.pbf`) is a documented, expected
    // 404 — see "A missing SDF glyph range 404s cleanly" in map-and-tiles.md.
    const problems = watchForProblems(page, { ignore: [/Failed to load resource.*404/] })

    await page.goto(DENSE_DISTRICT)
    await waitForMapReady(page)
    await showSites(page)
    await waitForTiles(page)

    // The arrangement is computed on `idle`, after the last tile lands; the
    // tile traffic having been quiet for `waitForTiles`'s window is the
    // signal this suite already uses for "the map has settled".
    const mapBox = (await page
      .getByRole('application', { name: 'Map of archaeological sites' })
      .boundingBox())!
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)

    // Either the list of what is here (the usual answer in a district this
    // dense) or, if the tap landed on a lone icon, that record's own panel.
    const list = page.getByRole('button', { name: 'Dismiss the list of records here' })
    const panel = page.getByRole('complementary', { name: 'Site details' })
    await expect(list.or(panel)).toBeVisible({ timeout: 15_000 })

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
    // MapLibre reports an invalid layer filter or expression through the
    // console, not as an exception: `match` over thousands of ids, or the
    // per-feature `icon-size`, being malformed would land here.
    expect(problems.consoleErrors, 'MapLibre rejected an expression').toEqual([])
  })
})
