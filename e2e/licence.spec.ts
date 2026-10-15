import { expect, test } from './helpers/fixtures'

/**
 * The licence page is the one place every upstream is credited in full, so a
 * source that ships without a line here is an attribution this project owes and
 * does not pay. These assert the production data sources named in the page, not
 * its wording.
 */
test.describe('the licence page', () => {
  test('credits every data source the production map and records draw on', async ({ page }) => {
    await page.goto('/licence')

    for (const name of [
      'Modern basemap',
      'Elevation (hillshade)',
      'Borrowed descriptions and links',
      'Symbols and typefaces',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }

    await expect(page.getByText('Vici.org', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('mapterhorn.com/attribution')).toBeVisible()
    await expect(page.getByText('Protomaps basemap extract')).toBeVisible()
    await expect(page.getByText('Delapouite and Lorc')).toBeVisible()
    await expect(page.getByText('Epigraphic Database Heidelberg (CC BY-SA 4.0)')).toBeVisible()
    await expect(page.getByText('Attic Inscriptions Online (CC BY-SA 3.0)')).toBeVisible()
    await expect(page.getByText('Itiner-e, the digital atlas of ancient roads')).toBeVisible()
    await expect(page.getByText('Nomisma.org, the American Numismatic Society')).toBeVisible()
    await expect(page.getByText('Roman monuments (theatres')).toBeVisible()
    await expect(
      page.getByText('Cliopatria, Seshat Global History Databank (CC BY 4.0)'),
    ).toBeVisible()
    await expect(page.getByText('the Atlas of Hillforts, Ralston & Lock')).toBeVisible()
    // The survey is named, linked, and its feed is listed in the ODbL group.
    await expect(
      page.getByRole('link', { name: 'Ancient Sites and Monuments Survey' }),
    ).toHaveAttribute('href', 'https://survey.jensineandresen.com')
    await expect(page.getByRole('link', { name: '/api/odbl/survey-sites.geojson' })).toBeVisible()
    // The photographs are the one thing left out, and the page says why.
    await expect(
      page.getByText('the photographs are not, because they are not licensed'),
    ).toBeVisible()
  })

  test('lists its sections in a legend that jumps to them', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/licence')

    const legend = page.getByRole('navigation', { name: 'On this page' })
    await expect(legend).toBeVisible()

    await legend.getByRole('link', { name: 'Reusing this data' }).click()
    await expect(page).toHaveURL(/\/licence#reuse$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Reusing this data' }),
    ).toBeInViewport()
    await expect(legend.getByRole('link', { name: 'Reusing this data' })).toHaveAttribute(
      'aria-current',
      'location',
    )
  })

  test('groups the feeds by licence, with the ODbL layers and their RDF beside the site feeds', async ({
    page,
  }) => {
    await page.goto('/licence')

    const shared = page.getByRole('region', { name: /CC BY-SA and CC0/ })
    await expect(shared.getByRole('link', { name: '/api/data/sites.geojson' })).toBeVisible()
    await expect(shared.getByRole('link', { name: '/api/data/sites.ttl' })).toBeVisible()

    // ODbL §4.6 is a duty, not a courtesy: every layer derived from an ODbL source is offered.
    const odbl = page.getByRole('region', { name: /ODbL 1\.0/ })
    for (const layer of [
      'awmc-water',
      'awmc-lines',
      'awmc-areas',
      'awmc-regions',
      'awmc-features',
      'coin-hoards',
      'limes',
      'survey-sites',
    ]) {
      await expect(odbl.getByRole('link', { name: `/api/odbl/${layer}.geojson` })).toBeVisible()
      await expect(odbl.getByRole('link', { name: `/api/odbl/${layer}.ttl` })).toBeVisible()
    }

    // The licence of the coin hoards is the one the sources disagree on; the page says both.
    await expect(page.getByText('ODbL 1.0 on its site, CC BY-NC 3.0')).toBeVisible()
  })

  test('documents the query parameters of the public feeds, with working examples', async ({
    page,
    request,
  }) => {
    await page.goto('/licence')

    await expect(page.getByRole('heading', { level: 3, name: 'Query parameters' })).toBeVisible()
    for (const name of ['bbox', 'category', 'limit', 'offset', 'dated', 'kind', 'source']) {
      await expect(
        page.getByRole('term').filter({ hasText: new RegExp(`^${name}$`) }),
      ).toBeVisible()
    }

    // An example that does not answer would teach the wrong thing.
    const examples = await page.locator('a[href*="/api/data/sites."][href*="offset="]').all()
    expect(examples).toHaveLength(3)
    for (const example of examples) {
      const url = new URL((await example.getAttribute('href'))!)
      const response = await request.get(`${url.pathname}${url.search}`)
      expect(response.ok()).toBeTruthy()
    }

    const odblExamples = await page.locator('a[href*="/api/odbl/"][href*="limit="]').all()
    expect(odblExamples.length).toBeGreaterThan(0)
    for (const example of odblExamples) {
      const url = new URL((await example.getAttribute('href'))!)
      const response = await request.get(`${url.pathname}${url.search}`)
      expect(response.ok()).toBeTruthy()
    }
  })
})
