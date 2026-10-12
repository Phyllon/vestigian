import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { toggleOverlay, waitForMapReady } from './helpers/map'

/**
 * Line of sight from a frontier tower, and the profile along a line.
 *
 * Both are calculated from elevation tiles on the server, so these tests need
 * terrain to be reachable: the mirror when `NUXT_PUBLIC_BASEMAP_TERRAIN_URL` is
 * set, Mapterhorn's own tiles when it is empty. They read the dev import's
 * records (the Taunus tower Turm 3-25, a Sardinian-style tower in Italy, the
 * Aquileia–Opie road) the way the other specs read theirs.
 */
const TOWER_SLUG = 'turm-3-25'
const TOWER_ID = 840
/** A `watchtower` record that is not on a frontier: it must be left alone. */
const OFF_FRONTIER_SLUG = 'torre-agro-nocerino-sarnese'
const OFF_FRONTIER_ID = 5510
const ROAD_TRACING_ID = 11808
/** A tower on the shoulder of a rim: a short open view and a long reach. */
const RIM_TOWER_SLUG = 'turm-15-25b'
const RIM_TOWER_ID = 781
const SECTOR_SLUG = 'limes-raeticus'

test.describe('what a frontier tower could see', () => {
  test('says what the guard platform could see, and what the calculation assumes', async ({
    page,
  }) => {
    const problems = watchForProblems(page)

    await page.goto(`/site/${TOWER_SLUG}`)

    const section = page.getByRole('region', { name: 'What the tower could see' })
    await expect(section).toBeVisible({ timeout: 30_000 })
    await expect(section.getByText('Calculated', { exact: true })).toBeVisible()
    await expect(section.getByText(/eyes about [\d.]+ m above the ground/)).toBeVisible()

    // The diagram is a picture of figures that are also written out.
    await expect(section.getByRole('img', { name: /Polar diagram of the open view/ })).toBeVisible()
    await expect(section.getByText('The view, direction by direction')).toBeVisible()
    await expect(section.getByText('north-east', { exact: true })).toBeVisible()

    // The height is said to be an estimate, in the open, with its range.
    await section.getByText('How this is worked out').click()
    await expect(section.getByText(/No tower stands to its full height/)).toBeVisible()

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('lists the towers nearby and whether each could be seen, and draws the ground between', async ({
    page,
  }) => {
    await page.goto(`/site/${TOWER_SLUG}`)

    const section = page.getByRole('region', { name: 'What the tower could see' })
    const neighbours = section.getByRole('button', { name: /Turm / })
    await expect(neighbours.first()).toBeVisible({ timeout: 30_000 })
    expect(await neighbours.count()).toBeGreaterThan(1)

    await neighbours.nth(1).click()
    await expect(neighbours.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(neighbours.first()).toHaveAttribute('aria-pressed', 'false')

    await expect(
      section.getByRole('img', { name: /Ground between this tower and Turm/ }),
    ).toBeVisible()

    // Arrow keys step along the line of sight; the position is read out.
    const slider = section.getByRole('slider', { name: 'Move along the line of sight' })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(section.getByText(/out · ground [\d.]+ m · line of sight/)).toBeVisible()
  })

  test('is silent for a watchtower that is not on a frontier', async ({ page }) => {
    const answered = page.waitForResponse(
      (response) => response.url().includes(`/api/sites/${OFF_FRONTIER_ID}/sightlines`),
      { timeout: 30_000 },
    )
    await page.goto(`/site/${OFF_FRONTIER_SLUG}`)

    // A `null` answer is a 204: the server has nothing to say about this one.
    const response = await answered
    expect(response.status()).toBe(204)

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('region', { name: 'What the tower could see' })).toHaveCount(0)
  })

  test('answers over the API with three heights, eight directions and neighbours', async ({
    request,
  }) => {
    const response = await request.get(`/api/sites/${TOWER_ID}/sightlines`)
    expect(response.status()).toBe(200)
    const body = await response.json()

    expect(body.platformMetres.low).toBeLessThan(body.platformMetres.central)
    expect(body.platformMetres.central).toBeLessThan(body.platformMetres.high)
    expect(body.variants.central.unbrokenMetres).toHaveLength(720)
    expect(
      body.variants.central.sectors.map((sector: { compass: string }) => sector.compass),
    ).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
    // A higher platform never sees less than a lower one.
    expect(body.variants.high.visibleAreaSquareKm).toBeGreaterThanOrEqual(
      body.variants.low.visibleAreaSquareKm,
    )
    expect(body.neighbours.length).toBeGreaterThan(0)
    expect(body.isBareEarthLikely).toBe(true)
  })

  test('draws the view on the map, which can be switched off', async ({ page }) => {
    const problems = watchForProblems(page)

    await page.goto('/#map=17/50.196682/8.273885')
    await waitForMapReady(page)
    await toggleOverlay(page, 'Sites')

    // The tower sits under the map's centre, beside the limes line: two records.
    const canvas = page.getByRole('application', { name: 'Map of archaeological sites' })
    await expect(canvas).toBeVisible()
    const box = (await canvas.boundingBox())!
    await expect
      .poll(
        async () => {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
          return page.getByRole('button', { name: /Turm 3-25/ }).count()
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0)
    await page
      .getByRole('button', { name: /Turm 3-25/ })
      .first()
      .click()

    const panel = page.getByRole('complementary', { name: 'Site details' })
    const section = panel.getByRole('region', { name: 'What the tower could see' })
    await expect(section).toBeVisible({ timeout: 30_000 })

    const show = section.getByRole('switch', { name: 'Show the view on the map' })
    await expect(show).toHaveAttribute('aria-checked', 'true')
    await expect(section.getByRole('button', { name: 'Fit it on the map' })).toBeVisible()

    await show.click()
    await expect(show).toHaveAttribute('aria-checked', 'false')
    await expect(section.getByRole('button', { name: 'Fit it on the map' })).toHaveCount(0)

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })
})

test.describe('a tower on a rim, and why', () => {
  test('says what it sees beyond the first rise, so a short open view is not read as blindness', async ({
    page,
  }) => {
    await page.goto(`/site/${RIM_TOWER_SLUG}`)

    const section = page.getByRole('region', { name: 'What the tower could see' })
    await expect(section).toBeVisible({ timeout: 30_000 })
    await expect(section.getByText(/ground around the tower lies open/)).toBeVisible()
    await expect(
      section.getByText(/Counting ground that comes back into view beyond a rise/),
    ).toBeVisible()
  })

  test('explains a direction from the ground: the crest, the dead ground, where it returns', async ({
    page,
  }) => {
    await page.goto(`/site/${RIM_TOWER_SLUG}`)

    const section = page.getByRole('region', { name: 'What the tower could see' })
    await section.getByRole('button', { name: /^north:/i }).click()

    await expect(section.getByRole('heading', { name: 'Looking to the north' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(section.getByText(/the foot of the tower/).first()).toBeVisible()
    await expect(section.getByText(/dead ground/).first()).toBeVisible()
    await expect(
      section.getByRole('img', { name: /Section of the ground to the north/ }),
    ).toBeVisible()

    // The section can be walked with the arrow keys, and says what each place is.
    const slider = section.getByRole('slider', { name: 'Move along the line' })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(section.getByText(/out · ground [\d.,]+ m/)).toBeVisible()

    // Choosing the same direction again closes it.
    await section.getByRole('button', { name: /^north:/i }).click()
    await expect(section.getByRole('heading', { name: 'Looking to the north' })).toHaveCount(0)
  })

  test('turns round to where the tower can be seen from', async ({ page }) => {
    await page.goto(`/site/${RIM_TOWER_SLUG}`)

    const section = page.getByRole('region', { name: 'What the tower could see' })
    await expect(section).toBeVisible({ timeout: 30_000 })

    const seenFrom = section.getByRole('button', { name: 'Where it is seen from' })
    await seenFrom.click()
    await expect(seenFrom).toHaveAttribute('aria-pressed', 'true')
    await expect(section.getByText(/A person on the ground could see this tower/)).toBeVisible()
    await expect(section.getByText(/Sight works both ways/)).toBeVisible()
  })

  test('writes the distances on the diagram, and answers a direction over the API', async ({
    page,
    request,
  }) => {
    await page.goto(`/site/${RIM_TOWER_SLUG}`)
    const section = page.getByRole('region', { name: 'What the tower could see' })
    const diagram = section.getByRole('img', { name: /Polar diagram of the view from the tower/ })
    await expect(diagram).toBeVisible({ timeout: 30_000 })
    // Ring labels and the figures at the compass points are text in the picture.
    await expect(diagram.getByText('10 km', { exact: true })).toHaveCount(1)

    const response = await request.get(`/api/sites/${RIM_TOWER_ID}/sightlines/ray`, {
      params: { compass: 'n' },
    })
    expect(response.status()).toBe(200)
    const ray = await response.json()
    expect(ray.compass).toBe('n')
    expect(ray.distances).toHaveLength(ray.ground.length)
    expect(ray.firstBlock.atMetres).toBeGreaterThan(0)
    // Not the first hummock: the longest hidden stretch and the crest that casts it.
    expect(ray.deadGround.toMetres).toBeGreaterThan(ray.deadGround.fromMetres)
    expect(ray.segments.length).toBeGreaterThan(1)
  })

  test('refuses a bearing that is not one of the eight compass lines', async ({ request }) => {
    const response = await request.get(`/api/sites/${RIM_TOWER_ID}/sightlines/ray`, {
      params: { compass: '47' },
    })
    expect(response.status()).toBe(400)
  })
})

test.describe('what a sector’s towers do together', () => {
  test('reads the chain, the breaks and the overlooked line on the sector’s page', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    await page.goto(`/limes/${SECTOR_SLUG}`)

    const watch = page.locator('details', { hasText: 'Watching the frontier' })
    await expect(watch).toBeVisible({ timeout: 30_000 })
    await expect(watch.getByText('Could a signal pass along it?')).toBeVisible()
    await expect(watch.getByText('What is overlooked')).toBeVisible()
    await expect(watch.getByText(/recorded towers/)).toBeVisible()
    // It says it is about the towers that are recorded.
    await expect(watch.getByText(/unrecorded rather than unwatched/)).toBeVisible()

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('answers over the API with shares, breaks and a drawable layer', async ({ request }) => {
    const summary = await request.get(`/api/limes/sectors/${SECTOR_SLUG}/sightlines`)
    expect(summary.status()).toBe(200)
    const body = await summary.json()
    expect(body.towerCount).toBeGreaterThan(10)
    expect(body.chainCoverage.low).toBeLessThanOrEqual(body.chainCoverage.high)
    expect(body.lineWatchedShare).toBeLessThanOrEqual(body.lineSeenShare)
    expect(body.towers[0].title).toBeTruthy()

    const layers = await request.get(`/api/limes/sectors/${SECTOR_SLUG}/sightlines.geojson`)
    expect(layers.status()).toBe(200)
    const collection = await layers.json()
    const roles = new Set(
      collection.features.map(
        (feature: { properties: { role: string } }) => feature.properties.role,
      ),
    )
    expect(roles).toContain('overlooked')
    expect(roles).toContain('tower')
  })

  test('says nothing for a sector no calculation has been run for', async ({ request }) => {
    const summary = await request.get('/api/limes/sectors/no-such-sector/sightlines')
    expect(summary.status()).toBe(204)

    const layers = await request.get('/api/limes/sectors/no-such-sector/sightlines.geojson')
    expect(layers.status()).toBe(404)
  })
})

test.describe('the relief along a line', () => {
  test('reads a road’s climb and fall and lets the reader move along it', async ({ page }) => {
    const problems = watchForProblems(page)

    await page.goto(`/tracing/${ROAD_TRACING_ID}`)

    const section = page.getByRole('region', { name: 'Relief along the line' })
    await expect(section).toBeVisible({ timeout: 30_000 })
    await expect(
      section.getByRole('img', { name: /Profile of the ground along this/ }),
    ).toBeVisible()
    await expect(section.getByText('Highest', { exact: true })).toBeVisible()
    await expect(section.getByText('Average slope', { exact: true })).toBeVisible()
    await expect(section.getByText('Steepest stretch', { exact: true })).toBeVisible()
    await expect(section.getByText(/Heights are a terrain model/)).toBeVisible()

    const slider = section.getByRole('slider', { name: 'Move along the line' })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(section.getByText(/along · [\d,.]+ m · slope [+−]?[\d,.]+ %/)).toBeVisible()

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('answers over the API with parallel arrays and the totals', async ({ request }) => {
    const response = await request.get(`/api/tracings/${ROAD_TRACING_ID}/profile`)
    expect(response.status()).toBe(200)
    const body = await response.json()

    expect(body.distances).toHaveLength(body.elevations.length)
    expect(body.path).toHaveLength(body.elevations.length)
    expect(body.stats.lengthMetres).toBeGreaterThan(1_000)
    expect(body.stats.highest.metres).toBeGreaterThanOrEqual(body.stats.lowest.metres)
    expect(body.terrainCoverage).toBeGreaterThan(0.9)
  })
})
