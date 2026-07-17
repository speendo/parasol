import { test, expect } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.get('/api/settings/reset')
})

test.describe('Form rendering', () => {
  test('renders accordion sections from settings', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('details#wifi')).toBeVisible()
    await expect(page.locator('details#gpio')).toHaveCount(1)
    await expect(page.locator('details#mqtt')).toHaveCount(1)
    await expect(page.locator('details#notifications')).toHaveCount(1)
  })

  test('renders correct field types', async ({ page }) => {
    await page.goto('/')
        await expect(page.locator('[name="wifi.ssid"]')).toBeVisible()
    await expect(page.locator('[name="wifi.password"]')).toHaveAttribute('type', 'password')
    await expect(page.locator('[name="wifi.mode"]')).toBeVisible()
  })

  test('renders nav links', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#nav-list a[href="#wifi"]')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#gpio"]')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#mqtt"]')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#notifications"]')).toBeVisible()
  })

  test('no pending changes initially', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#btn-save-apply')).toBeHidden()
  })

  test('helper text is rendered', async ({ page }) => {
    await page.goto('/')
        await expect(page.locator('[name="wifi.ssid"]')).toHaveAttribute('aria-describedby', 'wifi.ssid-helper')
    await expect(page.locator('#wifi\\.ssid-helper')).toHaveText('WiFi network name — required, 1–32 characters')
  })

  test('removes aria-busy after settings loaded', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
  })

  test('wifi.ssid has required attribute', async ({ page }) => {
    await page.goto('/')
        await expect(page.locator('[name="wifi.ssid"]')).toHaveAttribute('required', 'true')
  })

  test('wifi.password has required attribute', async ({ page }) => {
    await page.goto('/')
        await expect(page.locator('[name="wifi.password"]')).toHaveAttribute('required', 'true')
  })

  test('gpio.pin does not have required attribute', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="gpio.pin"]')).not.toHaveAttribute('required')
  })

  test('required fields show asterisk in label', async ({ page }) => {
    await page.goto('/')
        var label = page.locator('label[for="wifi.ssid"]')
    await expect(label).toContainText('*')
  })
})

test.describe('Save & Apply button', () => {
  test('Save & Apply enabled when dirty flag true', async ({ page }) => {
    await page.goto('/')
        await page.locator('[name="wifi.ssid"]').fill('DirtyTest')
    await page.locator('[name="wifi.password"]').fill('secret')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await expect(page.locator('#btn-save-apply')).not.toBeHidden()
  })

  test('Save & Apply clears dirty after save', async ({ page }) => {
    await page.goto('/')
        await page.locator('[name="wifi.ssid"]').fill('SaveTest')
    await page.locator('[name="wifi.password"]').fill('secret')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await page.locator('#btn-save-apply').click()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
    await expect(page.locator('#btn-save-apply')).toBeHidden()
  })

  test('Save stays visible after multiple radio changes', async ({ page }) => {
    await page.goto('/')
        await page.locator('[name="wifi.ssid"]').fill('MyNet')
    await page.locator('[name="wifi.password"]').fill('secret')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
    await page.locator('details#gpio summary').click()
    await page.locator('#gpio\\.pull\\.up').check()
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
    await page.locator('#gpio\\.pull\\.down').check()
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
  })

  test('Save appears after toggling switch', async ({ page }) => {
    await page.goto('/')
        await page.locator('[name="wifi.ssid"]').fill('MyNet')
    await page.locator('[name="wifi.password"]').fill('secret')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
    await page.locator('details#gpio summary').click()
    await expect(page.locator('[name="gpio.enabled"]')).toBeChecked()
    await page.locator('[name="gpio.enabled"]').uncheck()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
    await page.locator('[name="gpio.enabled"]').check()
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
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
        await page.locator('[name="wifi.ssid"]').fill('LocalVal')
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'ExtVal' }] } },
    })
    await page.waitForSelector('#server-changed:not([hidden])', { timeout: 5000 })
    await page.locator('#notif-keep').click()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('LocalVal')
  })
})

test.describe('Status variables', () => {
  test('renders status sections before settings', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('details#system')).toHaveCount(1)
    await expect(page.locator('details#sensors')).toHaveCount(1)
    var allDetails = page.locator('#config-form details')
    await expect(allDetails.nth(0)).toHaveId('system')
    await expect(allDetails.nth(1)).toHaveId('network')
  })

  test('status summary has secondary class', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#system summary')).toHaveClass('secondary')
    await expect(page.locator('#network summary')).toHaveClass('secondary')
  })

  test('settings summary does not have secondary class', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#wifi summary')).not.toHaveClass('secondary')
  })

  test('status fields are disabled', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="st-system.uptime"]')).toBeDisabled()
    await expect(page.locator('[name="st-system.fw_version"]')).toBeDisabled()
    await expect(page.locator('[name="st-system.led"]')).toBeDisabled()
    await expect(page.locator('[name="st-network.mode"]').first()).toBeDisabled()
    await expect(page.locator('[name="st-network.signal"]')).toBeDisabled()
    await expect(page.locator('[name="st-network.connection"]')).toBeDisabled()
    await expect(page.locator('[name="st-sensors.temperature"]')).toBeDisabled()
  })

  test('settings fields are not disabled', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="wifi.ssid"]')).not.toBeDisabled()
  })

  test('status shows computed values', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="st-system.uptime"]')).not.toHaveValue('')
    await expect(page.locator('[name="st-network.signal"]')).not.toHaveValue('')
    await expect(page.locator('[name="st-sensors.temperature"]')).not.toHaveValue('')
  })

  test('status nav links are present', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#nav-list a[href="#system"]')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#network"]')).toBeVisible()
  })

  test('status values update over time', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    var val1 = await page.locator('[name="st-network.signal"]').inputValue()
    await page.waitForTimeout(4000)
    var val2 = await page.locator('[name="st-network.signal"]').inputValue()
    expect(val1).not.toBe(val2)
  })
})

test.describe('form validation UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 8000 })
  })

  test('required empty field shows :invalid after blur', async ({ page }) => {
        var input = page.locator('[name="wifi.ssid"]')
    await input.fill('')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('required field loses :invalid after filling valid value', async ({ page }) => {
        var input = page.locator('[name="wifi.ssid"]')
    await input.fill('MyNetwork')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(false)
  })

  test('maxlength violation shows :invalid', async ({ page }) => {
        var input = page.locator('[name="wifi.ssid"]')
    await input.evaluate(function (el) { el.removeAttribute('maxlength') })
    await input.fill('a'.repeat(33))
    await input.evaluate(function (el) {
      el.setAttribute('maxlength', '32')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('minlength violation shows :invalid after blur', async ({ page }) => {
    await page.locator('#nav-list a[href="#mqtt"]').click()
    await page.waitForSelector('#mqtt[open]', { timeout: 5000 })
    var input = page.locator('[name="mqtt.client_id"]')
    await input.fill('ab')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('minlength satisfied does not show :invalid', async ({ page }) => {
    await page.locator('#nav-list a[href="#mqtt"]').click()
    await page.waitForSelector('#mqtt[open]', { timeout: 5000 })
    var input = page.locator('[name="mqtt.client_id"]')
    await input.fill('esp32-device')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(false)
  })

  test('pattern violation shows :invalid after blur', async ({ page }) => {
    await page.locator('#nav-list a[href="#mqtt"]').click()
    await page.waitForSelector('#mqtt[open]', { timeout: 5000 })
    var input = page.locator('[name="mqtt.client_id"]')
    await input.fill('!!!')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('email type validation shows :invalid for malformed email', async ({ page }) => {
    await page.locator('#nav-list a[href="#notifications"]').click()
    await page.waitForSelector('#notifications[open]', { timeout: 5000 })
    var input = page.locator('[name="notifications.sender"]')
    await input.fill('not-an-email')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('email type validation passes for valid email', async ({ page }) => {
    await page.locator('#nav-list a[href="#notifications"]').click()
    await page.waitForSelector('#notifications[open]', { timeout: 5000 })
    var input = page.locator('[name="notifications.sender"]')
    await input.fill('device@example.com')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(false)
  })

  test('number min constraint shows :invalid', async ({ page }) => {
    await page.locator('#nav-list a[href="#notifications"]').click()
    await page.waitForSelector('#notifications[open]', { timeout: 5000 })
    var input = page.locator('[name="notifications.port"]')
    await input.fill('0')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('number step constraint shows :invalid', async ({ page }) => {
    await page.locator('#nav-list a[href="#mqtt"]').click()
    await page.waitForSelector('#mqtt[open]', { timeout: 5000 })
    var input = page.locator('[name="mqtt.keepalive"]')
    await input.fill('62')
    await input.blur()
    var isInvalid = await input.evaluate(function (el) { return el.matches(':invalid') })
    expect(isInvalid).toBe(true)
  })

  test('save button hidden when form has invalid fields', async ({ page }) => {
        await page.locator('[name="wifi.ssid"]').fill('MyNetwork')
    await page.locator('[name="wifi.password"]').fill('secret123')
    await page.locator('[name="wifi.ssid"]').focus()
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
    await page.locator('#nav-list a[href="#notifications"]').click()
    await page.waitForSelector('#notifications[open]', { timeout: 5000 })
    var port = page.locator('[name="notifications.port"]')
    await port.evaluate(function (el) { el.value = '0'; el.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeHidden()
  })

  test('save button visible when form is valid and dirty', async ({ page }) => {
        await page.locator('[name="wifi.ssid"]').fill('MyNetwork')
    await page.locator('[name="wifi.password"]').fill('secret123')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    var saveBtn = page.locator('#btn-save-apply')
    await expect(saveBtn).toBeVisible({ timeout: 5000 })
  })

  test('accordion stays open when field is invalid after blur', async ({ page }) => {
    var details = page.locator('details#wifi')
    await expect(details).toHaveAttribute('open', '')
  })

  test('initially empty required fields do not block save button', async ({ page }) => {
    // Fill all required fields
        await page.locator('[name="wifi.ssid"]').fill('Network')
    await page.locator('[name="wifi.password"]').fill('password')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
  })

  test('invalid field blocks WS send until corrected', async function ({ page }) {
    // First fill required wifi fields to make the form valid
        await page.locator('[name="wifi.ssid"]').fill('MyNetwork')
    await page.locator('[name="wifi.password"]').fill('secret123')
    // Now test that an invalid mqtt field blocks WS send, and
    // correcting it allows the save button to appear
    await page.locator('#nav-list a[href="#mqtt"]').click()
    var input = page.locator('[name="mqtt.client_id"]')
    await input.fill('ab')
    await input.blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeHidden()
    await input.fill('valid-device')
    await input.blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
  })

  test('password field shows invalid styling on load', async ({ page }) => {
    await page.goto('/')
        var input = page.locator('[name="wifi.password"]')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  test('accordion with invalid field opens on load and blocks close', async ({ page }) => {
    await expect(page.locator('details#wifi')).toHaveAttribute('open', '')
    await expect(page.locator('details#wifi summary')).toHaveCSS('pointer-events', 'none')
  })
})

test.describe('Navbar image and favicon', () => {
  test('favicon link is present in head', async ({ page }) => {
    await page.goto('/')
    var favicon = page.locator('link[rel="icon"]')
    await expect(favicon).toHaveAttribute('href', '/favicon.ico')
  })

  test('logo image is present in navbar', async ({ page }) => {
    await page.goto('/')
    var logo = page.locator('#nav-logo')
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('src', '/logo.png')
    await expect(logo).toHaveAttribute('alt', 'Logo')
    var nw = await logo.evaluate(function (el) { return el.naturalWidth })
    expect(nw).toBeGreaterThan(0)
  })

  test('logo image hides on load error', async ({ page }) => {
    await page.route('**/logo.png', function (route) { return route.abort('failed') })
    await page.goto('/')
    var logo = page.locator('#nav-logo')
    await expect(logo).toHaveCount(1)
    var display = await logo.evaluate(function (el) { return el.style.display })
    expect(display).toBe('none')
  })
})

test.describe('Save non-string fields', () => {
  test('save persists number, checkbox, and range values (not silently dropped)', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 10000 })

    // Fill required wifi fields first so save button is enabled
    await page.locator('[name="wifi.ssid"]').fill('TestNet')
    await page.locator('[name="wifi.password"]').fill('secret123')
    await page.locator('[name="wifi.ssid"]').focus()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })

    // Open gpio accordion to make fields visible
    await page.locator('details#gpio summary').click()
    await page.waitForSelector('#gpio[open]', { timeout: 5000 })

    var pinInput = page.locator('[name="gpio.pin"]')
    await pinInput.fill('10')
    await pinInput.blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })

    var enabledCb = page.locator('[name="gpio.enabled"]')
    var wasChecked = await enabledCb.isChecked()
    await enabledCb.setChecked(!wasChecked)
    await enabledCb.dispatchEvent('change')
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })

    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })

    var savePayload = null
    await page.route('**/api/settings/save', async function (route) {
      savePayload = route.request().postDataJSON()
      await route.fulfill({ status: 200, body: 'OK' })
    })

    await page.locator('#btn-save-apply').click()
    await page.waitForTimeout(1000)

    expect(savePayload).not.toBeNull()
    expect(savePayload.gpio).toBeDefined()
    expect(savePayload.gpio.pin).toBeDefined()
    var pinValue = savePayload.gpio.pin[2].value
    expect(pinValue).toBe(10)

    expect(savePayload.gpio.enabled).toBeDefined()
    var enabledValue = savePayload.gpio.enabled[2].value
    expect(typeof enabledValue).toBe('boolean')
  })
})

