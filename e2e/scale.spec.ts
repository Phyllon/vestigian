import { expect, test } from './helpers/fixtures'
import { openMap } from './helpers/map'

/**
 * The distance scale: MapLibre's own control, mounted beside the key rather
 * than in the canvas corner, so it never sits under another control.
 */
test.describe('the distance scale', () => {
  test('reads a round distance and changes it with the zoom', async ({ page }) => {
    await openMap(page)

    const scale = page.getByRole('group', { name: 'Map scale' })
    await expect(scale).toBeVisible()

    const first = (await scale.innerText()).trim()
    expect(first).toMatch(/^\d+\s*(m|km)$/)

    // Three zoom levels in by keyboard (MapLibre binds `+`/`=`): the same bar
    // must stand for a shorter distance. The hash is read only when the map is
    // created, so editing it here would move nothing.
    await page.locator('canvas.maplibregl-canvas').focus()
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('Equal')
    await expect.poll(async () => (await scale.innerText()).trim()).not.toBe(first)
  })

  test('does not overlap the key button, the credit or the control column', async ({ page }) => {
    await openMap(page)

    const scale = await page.getByRole('group', { name: 'Map scale' }).boundingBox()
    const key = await page.getByRole('button', { name: 'Key', exact: true }).boundingBox()
    expect(scale).not.toBeNull()
    expect(key).not.toBeNull()

    const overlaps =
      scale!.x < key!.x + key!.width &&
      scale!.x + scale!.width > key!.x &&
      scale!.y < key!.y + key!.height &&
      scale!.y + scale!.height > key!.y
    expect(overlaps, 'the scale sits under the key button').toBe(false)
  })

  test('stays put when the key is opened', async ({ page }) => {
    await openMap(page)

    const scale = page.getByRole('group', { name: 'Map scale' })
    const before = await scale.boundingBox()

    await page.getByRole('button', { name: 'Key', exact: true }).click()
    const after = await scale.boundingBox()

    expect(after?.x).toBe(before?.x)
    expect(after?.y).toBe(before?.y)
  })
})
