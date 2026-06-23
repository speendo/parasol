import { test, expect } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.get('/api/settings/reset')
})

test.describe('Form rendering', () => {
  test('renders accordion sections from settings', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('details#wifi')).toBeVisible()
    await expect(page.locator('details#gpio')).toBeVisible()
  })

  test('renders correct field types', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.ssid"]')).toBeVisible()
    await expect(page.locator('[name="wifi.password"]')).toHaveAttribute('type', 'password')
    await expect(page.locator('[name="wifi.mode"]')).toBeVisible()
  })

  test('renders nav links', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#nav-list a[href="#wifi"]')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#gpio"]')).toBeVisible()
  })

  test('no pending changes initially', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#btn-save-apply')).toBeHidden()
  })

  test('tooltip is rendered', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveAttribute('aria-describedby', 'wifi.ssid-helper')
    await expect(page.locator('#wifi\\.ssid-helper')).toHaveText('WiFi network name')
  })

  test('removes aria-busy after settings loaded', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
  })
})

test.describe('Save & Apply button', () => {
  test('Save & Apply enabled when dirty flag true', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('DirtyTest')
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await expect(page.locator('#btn-save-apply')).not.toBeHidden()
  })

  test('Save & Apply clears dirty after save', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('SaveTest')
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await page.locator('#btn-save-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
    await expect(page.locator('#btn-save-apply')).toBeHidden()
  })

  test('Save stays visible after multiple radio changes', async ({ page }) => {
    await page.goto('/#gpio')
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeHidden()
    await page.locator('#gpio\\.pull\\.up').check()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeVisible()
    await page.locator('#gpio\\.pull\\.down').check()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeVisible()
  })

  test('Save appears after toggling checkbox', async ({ page }) => {
    await page.goto('/#gpio')
    await page.waitForTimeout(500)
    await expect(page.locator('[name="gpio.enabled"]')).toBeChecked()
    await page.locator('[name="gpio.enabled"]').uncheck()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeVisible()
  })
})

test.describe('Navigation and hash', () => {
  test('nav click opens accordion', async ({ page }) => {
    await page.goto('/')
    await page.locator('#nav-list a[href="#gpio"]').click()
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
  })

  test('URL hash opens section on load', async ({ page }) => {
    await page.goto('/#gpio')
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
  })
})

test.describe('WebSocket notifications', () => {
  test('shows notification on external change', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'ExtNet' }] } },
    })
    await page.waitForTimeout(500)
    await expect(page.locator('#server-changed')).not.toBeHidden()
    await expect(page.locator('#notif-load')).not.toBeHidden()
    await expect(page.locator('#notif-keep')).not.toBeHidden()
  })

  test('Load button accepts server change', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'LoadNet' }] } },
    })
    await page.waitForTimeout(500)
    await page.locator('#notif-load').click()
    await expect(page.locator('#server-changed')).toBeHidden()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('LoadNet')
  })

  test('Keep button preserves local value', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('LocalVal')
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForTimeout(300)
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'ExtVal' }] } },
    })
    await page.waitForTimeout(500)
    await page.locator('#notif-keep').click()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('LocalVal')
  })
})


