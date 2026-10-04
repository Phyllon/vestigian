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
    // The photographs are the one thing left out, and the page says why.
    await expect(
      page.getByText('the photographs are not, because they are not licensed'),
    ).toBeVisible()
  })

  test('documents the query parameters of both public feeds, with working examples', async ({
    page,
    request,
  }) => {
    await page.goto('/licence')

    await expect(page.getByRole('heading', { level: 3, name: 'Query parameters' })).toBeVisible()
    for (const name of ['bbox', 'category', 'limit', 'offset', 'dated']) {
      await expect(
        page.getByRole('term').filter({ hasText: new RegExp(`^${name}$`) }),
      ).toBeVisible()
    }

    // An example that does not answer would teach the wrong thing.
    const examples = await page.locator('a[href*="/api/data/sites."][href*="offset="]').all()
    expect(examples).toHaveLength(2)
    for (const example of examples) {
      const url = new URL((await example.getAttribute('href'))!)
      const response = await request.get(`${url.pathname}${url.search}`)
      expect(response.ok()).toBeTruthy()
    }
  })
})
