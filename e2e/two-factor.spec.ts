import { TOTP } from 'otpauth'
import { expect, test } from './helpers/fixtures'
import { ACCOUNTS, E2E_PASSWORD } from './helpers/accounts'
import { signIn, signOut } from './helpers/auth'
import { gotoAndHydrate } from './helpers/hydration'

/**
 * Opt-in TOTP two-factor login, end to end: enrollment from `/settings`,
 * the two-step sign-in it then requires, and turning it back off. Uses its
 * own fixture account (`twoFactorSubject`) rather than `trusted` — see the
 * comment on that account in `helpers/accounts.ts`.
 *
 * The code itself is computed the same way an authenticator app would, with
 * the same `otpauth` library the server uses, from the secret this suite
 * reads straight off the settings page rather than the QR image (nothing
 * here decodes a QR code, which is what the manual-entry key is for).
 */
test.describe('two-factor authentication', () => {
  test('enables from settings, requires a code at the next sign-in, and can be turned off', async ({
    page,
  }) => {
    await signIn(page, 'twoFactorSubject')
    await gotoAndHydrate(page, '/settings')

    await page.getByRole('button', { name: /turn on two-factor authentication/i }).click()

    const secretLine = page.getByText(/enter this key by hand/i)
    await expect(secretLine).toBeVisible({ timeout: 10_000 })
    const secretText = (await secretLine.textContent()) ?? ''
    const secret = secretText.split(':').pop()?.trim()
    expect(secret, 'could not read the manual-entry key off the page').toBeTruthy()

    const totp = new TOTP({ secret: secret!, digits: 6, period: 30 })

    await page.getByLabel(/^code$/i).fill(totp.generate())
    await page.getByRole('button', { name: /confirm and turn on/i }).click()

    // Backup codes, shown exactly once.
    await expect(page.getByText(/save these ten backup codes/i)).toBeVisible({ timeout: 10_000 })
    const codeCells = page.locator('ul li.datum')
    await expect(codeCells).toHaveCount(10)
    const backupCodes = await codeCells.allTextContents()
    expect(new Set(backupCodes.map((entry) => entry.trim())).size).toBe(10)

    await page.getByRole('button', { name: /i've saved these codes/i }).click()
    await expect(page.getByRole('button', { name: /^turn off$/i })).toBeVisible()

    // Signing out and back in now stops at a second step.
    await signOut(page)
    await gotoAndHydrate(page, '/login')
    await page.getByLabel('Email').fill(ACCOUNTS.twoFactorSubject.email)
    await page.getByLabel('Password').fill(E2E_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByRole('heading', { name: /enter your code/i })).toBeVisible({
      timeout: 10_000,
    })

    // A wrong code is refused, and the reader stays on the same step.
    await page.getByLabel(/^code$/i).fill('000000')
    await page.getByRole('button', { name: /verify/i }).click()
    await expect(page.getByText(/did not work/i).first()).toBeVisible({ timeout: 10_000 })

    // The right code completes the sign-in.
    await page.getByLabel(/^code$/i).fill(totp.generate())
    await page.getByRole('button', { name: /verify/i }).click()
    await expect(page.getByText(ACCOUNTS.twoFactorSubject.displayName).first()).toBeVisible({
      timeout: 20_000,
    })

    // A backup code works too, and only once.
    await signOut(page)
    await gotoAndHydrate(page, '/login')
    await page.getByLabel('Email').fill(ACCOUNTS.twoFactorSubject.email)
    await page.getByLabel('Password').fill(E2E_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.getByRole('button', { name: /use a backup code instead/i }).click()

    const backupCode = backupCodes[0]!.trim()
    await page.getByLabel(/backup code/i).fill(backupCode)
    await page.getByRole('button', { name: /verify/i }).click()
    await expect(page.getByText(ACCOUNTS.twoFactorSubject.displayName).first()).toBeVisible({
      timeout: 20_000,
    })

    const reuse = await page.request.post('/api/auth/login', {
      data: { email: ACCOUNTS.twoFactorSubject.email, password: E2E_PASSWORD },
    })
    const { challengeId } = (await reuse.json()) as { challengeId: string }
    const replay = await page.request.post('/api/auth/verify-2fa', {
      data: { challengeId, code: backupCode },
    })
    expect(replay.status()).toBe(401)

    // Turning it off needs the password and a live code, not just one.
    await gotoAndHydrate(page, '/settings')
    await page.locator('#settings-2fa-disable-password').fill(E2E_PASSWORD)
    await page.locator('#settings-2fa-disable-code').fill(totp.generate())
    await page.getByRole('button', { name: /^turn off$/i }).click()

    await expect(page.getByText(/two-factor authentication is off/i).first()).toBeVisible({
      timeout: 10_000,
    })

    // A plain sign-in works again, with no second step.
    await signOut(page)
    const plain = await page.request.post('/api/auth/login', {
      data: { email: ACCOUNTS.twoFactorSubject.email, password: E2E_PASSWORD },
    })
    expect((await plain.json()).requiresTwoFactor).toBeUndefined()
  })
})
