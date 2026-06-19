import { test, expect } from '@playwright/test'

test.describe('Form rendering', () => {
  test('renders accordion sections from /api/settings', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('details#wifi')
    var sections = page.locator('details')
    await expect(sections).toHaveCount(2)
    await expect(page.locator('details#wifi summary')).toHaveText('Wifi')
    await expect(page.locator('details#gpio summary')).toHaveText('Gpio')
  })

  test('text input renders with correct attributes', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.waitForSelector('[name="wifi.ssid"]')
    var ssid = page.locator('[name="wifi.ssid"]')
    await expect(ssid).toHaveAttribute('type', 'text')
    await expect(ssid).toHaveAttribute('maxlength', '32')
    await expect(ssid).toHaveAttribute('placeholder', 'MyNetwork')
  })

  test('select renders with options', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.waitForSelector('[name="wifi.mode"]')
    var options = page.locator('[name="wifi.mode"] option')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveAttribute('value', 'station')
    await expect(options.nth(0)).toHaveText('Station')
    await expect(options.nth(1)).toHaveAttribute('value', 'ap')
    await expect(options.nth(1)).toHaveText('Access Point')
  })

  test('switch renders correctly', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    var sw = page.locator('[name="wifi.hidden"]')
    await expect(sw).toHaveAttribute('type', 'checkbox')
    await expect(sw).toHaveAttribute('role', 'switch')
  })

  test('range renders with output', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    var channel = page.locator('[name="wifi.channel"]')
    await expect(channel).toHaveAttribute('type', 'range')
    await expect(channel).toHaveAttribute('min', '1')
    await expect(channel).toHaveAttribute('max', '13')
    await expect(channel).toHaveAttribute('step', '1')
  })

  test('radio group renders', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    var radios = page.locator('[name="gpio.pull"]')
    await expect(radios).toHaveCount(3)
    await expect(radios.nth(0)).toHaveValue('none')
    await expect(radios.nth(1)).toHaveValue('up')
    await expect(radios.nth(2)).toHaveValue('down')
  })

  test('labels include tooltips', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    var ssidLabel = page.locator('label[data-tooltip="WiFi network name"]')
    await expect(ssidLabel).toHaveText('SSID')
  })

  test('nav links render for each component with derived labels', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#nav-list a')
    var links = page.locator('#nav-list a')
    await expect(links).toHaveCount(2)
    await expect(links.nth(0)).toHaveAttribute('href', '#wifi')
    await expect(links.nth(0)).toHaveText('Wifi')
    await expect(links.nth(1)).toHaveAttribute('href', '#gpio')
    await expect(links.nth(1)).toHaveText('Gpio')
  })
})

test.describe('Initial values', () => {
  test('text input value from settings response', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('')
  })

  test('select default from settings response', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.mode"]')).toHaveValue('station')
  })

  test('switch default from settings response', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.hidden"]')).not.toBeChecked()
  })

  test('range default from settings response', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.channel"]')).toHaveValue('6')
  })

  test('number default from settings response', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    await expect(page.locator('[name="gpio.pin"]')).toHaveValue('2')
  })

  test('radio default from settings response', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    await expect(page.locator('[name="gpio.pull"][value="none"]')).toBeChecked()
  })

  test('no pending changes initially', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#pending-count')).toHaveText('')
    await expect(page.locator('#btn-apply')).toBeDisabled()
    await expect(page.locator('#btn-reset')).toBeDisabled()
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
  })
})

test.describe('Pending detection', () => {
  test('changing text shows pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('MyNetwork')
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
  })

  test('restoring value clears pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    var ssid = page.locator('[name="wifi.ssid"]')
    await ssid.fill('MyNetwork')
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
    await ssid.fill('')
    await expect(page.locator('#pending-count')).toHaveText('')
  })

  test('changing switch triggers pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.hidden"]').check()
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
  })

  test('changing select triggers pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.mode"]').selectOption('ap')
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
  })

  test('changing range triggers pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.channel"]').fill('11')
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
  })

  test('multiple changes show correct count', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('MyNet')
    await page.locator('[name="wifi.mode"]').selectOption('ap')
    await expect(page.locator('#pending-count')).toHaveText('2 pending change(s)')
  })

  test('changing radio triggers pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    await page.locator('[name="gpio.pull"]').nth(1).check()
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
  })

  test('switch toggle and revert clears pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    var sw = page.locator('[name="wifi.hidden"]')
    await sw.check()
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
    await sw.uncheck()
    await expect(page.locator('#pending-count')).toHaveText('')
  })

  test('radio change and revert clears pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    await page.locator('[name="gpio.pull"][value="up"]').check()
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
    await page.locator('[name="gpio.pull"][value="none"]').check()
    await expect(page.locator('#pending-count')).toHaveText('')
  })
})

test.describe('Button actions', () => {
  test('apply clears pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('TestNet')
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#pending-count')).toHaveText('')
  })

  test('reset after apply reverts to server defaults', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('StableNet')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await page.locator('[name="wifi.ssid"]').fill('LocalChange')
    await expect(page.locator('#pending-count')).toHaveText('1 pending change(s)')
    await page.locator('#btn-reset').click()
    await page.waitForTimeout(500)
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('')
    await expect(page.locator('#pending-count')).toHaveText('')
  })

  test('save and apply persists values', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('SavedNet')
    await page.locator('#btn-save-apply').click()
    await page.waitForTimeout(500)
    await page.reload()
    await page.waitForSelector('details#wifi')
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('SavedNet')
  })
})

test.describe('Navigation and hash', () => {
  test('nav click opens accordion', async ({ page }) => {
    await page.goto('/')
    await page.locator('#nav-list a[href="#gpio"]').click()
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
  })

  test('url hash opens section', async ({ page }) => {
    await page.goto('/#gpio')
    await page.waitForSelector('details#gpio')
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
  })
})

test.describe('Error states', () => {
  test('settings failure shows error', async ({ page }) => {
    await page.route('**/api/settings', function (route) { return route.fulfill({ status: 404 }) })
    await page.goto('/')
    await page.waitForSelector('#status-bar')
    await expect(page.locator('#status-bar')).toContainText('Failed to load settings')
  })

  test('settings failure renders no form', async ({ page }) => {
    await page.route('**/api/settings', function (route) { return route.fulfill({ status: 404 }) })
    await page.goto('/')
    await expect(page.locator('details')).toHaveCount(0)
  })

  test('post error shows in status bar', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('Test')
    await page.route('**/api/settings/apply', function (route) { return route.fulfill({ status: 400, body: 'Invalid' }) })
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#status-bar')).toContainText('Request failed')
  })

  test('subsequent success clears error', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('Test')
    await page.route('**/api/settings/apply', function (route) { return route.fulfill({ status: 400, body: 'Invalid' }) })
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#status-bar')).toContainText('Request failed')
    await page.unroute('**/api/settings/apply')
    await page.locator('[name="wifi.ssid"]').fill('Test2')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#status-bar')).toHaveText('')
  })
})

test.describe('Edge cases', () => {
  test('invalid number does not enable buttons', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    var pin = page.locator('[name="gpio.pin"]')
    await pin.fill('999')
    await expect(page.locator('#btn-apply')).toBeDisabled()
  })

  test('range output displays live value', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    var channel = page.locator('[name="wifi.channel"]')
    var output = page.locator('output')
    await expect(output).toHaveText('6')
    await channel.fill('11')
    await expect(output).toHaveText('11')
  })

  test('multiple fields then apply', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('details#gpio summary').click()
    await page.locator('[name="wifi.ssid"]').fill('Net')
    await page.locator('[name="wifi.channel"]').fill('11')
    await page.locator('[name="gpio.pin"]').fill('5')
    await expect(page.locator('#pending-count')).toHaveText('3 pending change(s)')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#pending-count')).toHaveText('')
  })

  test('form has expected field count', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('details#gpio summary').click()
    var wifiFields = page.locator('details#wifi > label, details#wifi > fieldset')
    var gpioFields = page.locator('details#gpio > label, details#gpio > fieldset')
    await expect(wifiFields).toHaveCount(5)
    await expect(gpioFields).toHaveCount(4)
  })
})
