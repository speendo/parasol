import { test, expect } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.get('/api/settings/reset')
})

/* gpio lives in a closed <details>; Playwright cannot act on hidden fields.
 * (The wifi section opens itself because the empty required password fails
 * validation.) */
async function openGpio(page) {
  await page.goto('/')
  await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
  await page.locator('details#gpio summary').click()
}

test.describe('ack correlation', () => {
  test('transform shows the decided value with no prompt', async ({ page }) => {
    await openGpio(page)
    await page.fill('[name="gpio.transform"]', '5')
    await page.locator('[name="gpio.transform"]').blur()
    await expect(page.locator('[name="gpio.transform"]')).toHaveValue('10')
    await expect(page.locator('#server-changed')).toBeHidden()
  })

  test('a rejection reverts and leaves the field retryable', async ({ page }) => {
    await openGpio(page)
    await page.fill('[name="gpio.reject"]', 'nope')
    await page.locator('[name="gpio.reject"]').blur()
    await expect(page.locator('[name="gpio.reject"]')).toHaveValue('none')
    await expect(page.locator('#status-bar')).toContainText('Rejected: Reject')
    await page.fill('[name="gpio.reject"]', 'again')
    await page.locator('[name="gpio.reject"]').blur()
    await expect(page.locator('[name="gpio.reject"]')).toHaveValue('none')
    await expect(page.locator('#status-bar')).toContainText('Rejected: Reject')
  })

  test('the page stays responsive after a transform', async ({ page }) => {
    // Make the form valid first: the empty required password would keep the
    // Save button hidden no matter what the ack does.
    await page.goto('/')
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
    await page.fill('[name="wifi.ssid"]', 'MyNet')
    await page.fill('[name="wifi.password"]', 'secret')
    await page.locator('details#gpio summary').click()
    await page.fill('[name="gpio.transform"]', '3')
    await page.locator('[name="gpio.transform"]').blur()
    await expect(page.locator('[name="gpio.transform"]')).toHaveValue('6')
    // a second apply still works while the first batch is settling
    await page.locator('[name="gpio.enabled"]').uncheck()
    await expect(page.locator('[name="gpio.enabled"]')).not.toBeChecked()
    await expect(page.locator('#btn-save-apply')).toBeVisible()
    // Prove the second apply actually reached the server, not just the widget.
    await page.reload()
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
    await page.locator('details#gpio summary').click()
    await expect(page.locator('[name="gpio.enabled"]')).not.toBeChecked()
  })
})
