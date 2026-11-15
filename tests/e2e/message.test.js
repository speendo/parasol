import { test, expect } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.get('/api/settings/reset')
})

test.describe('status bar messages', () => {
  test('a warning message shows the warning glyph in amber', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('details#wifi')).toBeVisible()

    const res = await request.post('/api/test/message', {
      data: { level: 'warning', message: 'Wi-Fi changed; reconnect' },
    })
    expect(res.ok()).toBeTruthy()

    await expect(page.locator('#status-bar')).toHaveText('\u26a0 Wi-Fi changed; reconnect')
    expect(await page.locator('#status-bar').evaluate(function (el) {
      return el.style.color
    })).toBe('orange')
  })

  test('an error message shows the error glyph in red', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('details#wifi')).toBeVisible()

    await request.post('/api/test/message', {
      data: { level: 'error', message: 'Could not write config' },
    })

    await expect(page.locator('#status-bar')).toHaveText('\u2716 Could not write config')
    expect(await page.locator('#status-bar').evaluate(function (el) {
      return el.style.color
    })).toBe('var(--pico-color-red)')
  })

  test('a message adds no group and leaves the form usable', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('details#wifi')).toBeVisible()

    await request.post('/api/test/message', {
      data: { level: 'info', message: 'Settings restored' },
    })
    await expect(page.locator('#status-bar')).toHaveText('\u2139 Settings restored')

    await request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'AfterMessage' }] } },
    })

    await expect(page.locator('details#message')).toHaveCount(0)
    await expect(page.locator('#nav-list a[href="#message"]')).toHaveCount(0)
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')

    await page.locator('[name="wifi.ssid"]').fill('StillUsable')
    await page.locator('[name="wifi.password"]').fill('secret')
    await page.locator('[name="wifi.ssid"]').focus()
    await expect(page.locator('#btn-save-apply')).toBeEnabled({ timeout: 5000 })
  })
})
