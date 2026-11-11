import { test, expect } from '@playwright/test'

// Upload e2e coverage: the Playwright suite loads the production app.min.js
// (built from app.js), so window.__test is stripped. Every interaction here
// goes through the real DOM and HTTP/WebSocket contract against the FastAPI
// test server, which mirrors the device's upload behaviour.

const JSON_BODY = Buffer.from(JSON.stringify({ hello: 'world', pad: 'x'.repeat(2000) }))
const MP3_BODY = Buffer.from('ID3 fake mp3 payload')

/** Resolve once the server-side upload lock has been released. */
async function waitForUploadIdle(request) {
  await expect.poll(async function () {
    return (await (await request.get('/api/test/upload-state')).json()).uploading
  }, { timeout: 10000 }).toBe(false)
}

/** Resolve once the server has begun handling a PUT (upload lock held). */
async function waitForUploading(request) {
  await expect.poll(async function () {
    return (await (await request.get('/api/test/upload-state')).json()).uploading
  }, { timeout: 5000 }).toBe(true)
}

test.beforeEach(async ({ request }) => {
  // Clear upload state (locks, pending temps, committed bytes, delay), then
  // restore the settings defaults so each test starts clean.
  await request.post('/api/test/reset-uploads')
  await request.get('/api/settings/reset')
})

test.describe('upload happy path and rejection', () => {
  test('uploads a JSON config, reports progress, and commits exact bytes', async ({ page }) => {
    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.setInputFiles('[name="config.file"]', {
      name: 'config.json', mimeType: 'application/json', buffer: JSON_BODY,
    })
    await page.click('#config\\.file-upload')

    await expect(page.locator('#config\\.file-msg')).toHaveText('Uploaded')

    // Progress reached 100 before the field reported completion.
    const progress = await page.locator('#config\\.file-progress').evaluate(function (el) { return el.value })
    expect(progress).toBe(100)

    // The committed bytes match exactly what the client streamed.
    const committed = await (await page.request.get('/api/test/uploads/config/file')).body()
    expect(Buffer.compare(committed, JSON_BODY)).toBe(0)
  })

  test('rejects a .txt file locally and keeps Upload disabled', async ({ page }) => {
    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.setInputFiles('[name="config.file"]', {
      name: 'config.txt', mimeType: 'text/plain', buffer: Buffer.from('not json'),
    })

    await expect(page.locator('#config\\.file-msg')).toHaveText('File type not allowed')
    await expect(page.locator('#config\\.file-upload')).toBeDisabled()
  })

  test('rejects an 8 KiB + 1 byte file with no PUT', async ({ page }) => {
    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    const before = await (await page.request.get('/api/test/upload-state')).json()
    await page.setInputFiles('[name="config.file"]', {
      name: 'config.json', mimeType: 'application/json', buffer: Buffer.alloc(8 * 1024 + 1, 0x61),
    })

    await expect(page.locator('#config\\.file-msg')).toHaveText('File too large')
    await expect(page.locator('#config\\.file-upload')).toBeDisabled()

    const after = await (await page.request.get('/api/test/upload-state')).json()
    expect(after.put_count).toBe(before.put_count)
  })

  test('renders the file field per the settings convention', async ({ page, request }) => {
    const settings = await (await request.get('/api/settings')).json()
    const field = settings.config.file
    expect(field).toHaveLength(3)
    expect(field[0]).toBe('file')
    expect(field[1]).toBe('Config file')
    expect(typeof field[2]).toBe('object')
    expect(field[2].accept).toBe('.json,application/json')
    expect(field[2].max_size).toBe(8 * 1024)

    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await expect(page.locator('details#config [name="config.file"]')).toHaveCount(1)
    await expect(page.locator('label[for="config.file"]')).toHaveText('Config file')
    await expect(page.locator('#config\\.file-helper')).toHaveText('JSON config, up to 8 KiB')
    await expect(page.locator('[name="config.file"]')).toHaveAttribute('aria-describedby', 'config.file-helper')
  })
})

test.describe('deferred and immediate upload flows', () => {
  test('deferred audio upload follows pending → Save → clip.mp3 → Reset', async ({ page }) => {
    await page.goto('/#audio')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.setInputFiles('[name="audio.clip"]', {
      name: 'beep.mp3', mimeType: 'audio/mpeg', buffer: MP3_BODY,
    })
    await page.click('#audio\\.clip-upload')

    await expect(page.locator('#audio\\.clip-msg')).toHaveText('Uploaded')
    await expect(page.locator('#audio\\.clip-current')).toContainText('beep.mp3 (pending)')
    await expect(page.locator('#btn-save-apply')).toBeVisible()

    // Save promotes the pending temp to the committed label.
    await page.click('#btn-save-apply')
    await expect(page.locator('#audio\\.clip-current')).toHaveText('Current: clip.mp3')
    await expect(page.locator('#btn-save-apply')).toBeHidden()

    // A second upload becomes pending again; Reset discards the temp and the
    // committed label survives.
    await page.setInputFiles('[name="audio.clip"]', {
      name: 'beep2.mp3', mimeType: 'audio/mpeg', buffer: MP3_BODY,
    })
    await page.click('#audio\\.clip-upload')
    await expect(page.locator('#audio\\.clip-current')).toContainText('beep2.mp3 (pending)')
    await expect(page.locator('#btn-reset')).toBeVisible()

    await page.click('#btn-reset')
    await expect(page.locator('#audio\\.clip-current')).toHaveText('Current: clip.mp3')
  })

  test('immediate config upload commits without marking dirty', async ({ page }) => {
    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    const json = Buffer.from(JSON.stringify({ hello: 'world' }))
    await page.setInputFiles('[name="config.file"]', {
      name: 'config.json', mimeType: 'application/json', buffer: json,
    })
    await page.click('#config\\.file-upload')

    await expect(page.locator('#config\\.file-msg')).toHaveText('Uploaded')
    await expect(page.locator('#config\\.file-current')).toHaveText('Current: config.json')
    await expect(page.locator('#btn-save-apply')).toBeHidden()

    const committed = await (await page.request.get('/api/test/uploads/config/file')).body()
    expect(Buffer.compare(committed, json)).toBe(0)
  })
})

test.describe('upload lock and second client', () => {
  test('locks controls and rejects actions during a slow upload', async ({ page }) => {
    await page.request.post('/api/test/upload-delay', { data: { ms: 3000 } })
    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.setInputFiles('[name="config.file"]', {
      name: 'config.json', mimeType: 'application/json', buffer: JSON_BODY,
    })
    await page.click('#config\\.file-upload')
    await waitForUploading(page.request)

    await expect(page.locator('#btn-save-apply')).toBeDisabled()
    await expect(page.locator('#btn-reset')).toBeDisabled()
    await expect(page.locator('#nav-reboot')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('#config\\.file-upload')).toBeDisabled()
    await expect(page.locator('#audio\\.clip-upload')).toBeDisabled()

    expect((await page.request.post('/api/settings/save', { data: {} })).status()).toBe(409)
    expect((await page.request.post('/api/settings/reset', { data: {} })).status()).toBe(409)
    expect((await page.request.post('/api/system/reboot', { data: {} })).status()).toBe(409)

    await waitForUploadIdle(page.request)
  })

  test('second page sees the upload lock', async ({ page, context }) => {
    await page.request.post('/api/test/upload-delay', { data: { ms: 3000 } })
    await page.goto('/#config')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.setInputFiles('[name="config.file"]', {
      name: 'config.json', mimeType: 'application/json', buffer: JSON_BODY,
    })
    await page.click('#config\\.file-upload')
    await waitForUploading(page.request)

    const page2 = await context.newPage()
    await page2.goto('/#audio')
    await page2.waitForSelector('#config-form:not([aria-busy])')

    await expect(page2.locator('#audio\\.clip-msg')).toHaveText('Another upload is in progress.')
    await expect(page2.locator('#nav-reboot')).toHaveAttribute('aria-disabled', 'true')
    const meta = await (await page2.request.get('/api/settings')).json()
    expect(meta._meta.uploading).toBe(true)

    await waitForUploadIdle(page.request)
  })

  test('second upload preflight returns 409 and shows its message', async ({ page }) => {
    await page.goto('/#audio')
    await page.waitForSelector('#config-form:not([aria-busy])')

    // Simulate a concurrent upload this page has not been told about: drop the
    // WebSocket, then arm the server-side lock. The page still believes it is
    // idle, so startUpload reaches the real preflight, which the server
    // rejects with 409.
    await page.evaluate(function () { parasol.disconnectWS() })
    await page.request.post('/api/test/uploading', { data: { uploading: true } })

    await page.evaluate(function () {
      document.querySelector('[name="audio.clip"]').disabled = false
    })
    await page.setInputFiles('[name="audio.clip"]', {
      name: 'beep.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('x'),
    })
    await page.evaluate(function () {
      var btn = document.getElementById('audio.clip-upload')
      btn.disabled = false
      btn.click()
    })

    await expect(page.locator('#audio\\.clip-msg')).toHaveText('Upload in progress')
  })

  test('upload completes while WS is down and label appears on reconnect', async ({ page }) => {
    await page.goto('/#audio')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.evaluate(function () { parasol.disconnectWS() })

    await page.setInputFiles('[name="audio.clip"]', {
      name: 'beep.mp3', mimeType: 'audio/mpeg', buffer: MP3_BODY,
    })
    await page.click('#audio\\.clip-upload')
    await expect(page.locator('#audio\\.clip-msg')).toHaveText('Uploaded')

    await page.evaluate(function () { parasol.connectWS() })
    await expect(page.locator('#audio\\.clip-current')).toContainText('beep.mp3 (pending)')
  })

  test('crafted save body with audio.clip does not change the label', async ({ page }) => {
    await page.goto('/#audio')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.request.post('/api/settings/save', {
      data: { audio: { clip: ['file', 'Clip', { value: 'evil.mp3' }] } },
    })

    // The test server skips file fields in save, so the label stays "none".
    await expect(page.locator('#audio\\.clip-current')).toHaveText('Current: none')
  })
})

test.describe('cancel and timeout', () => {
  test('cancel aborts the upload and discards the pending file', async ({ page }) => {
    await page.request.post('/api/test/upload-delay', { data: { ms: 3000 } })
    await page.goto('/#audio')
    await page.waitForSelector('#config-form:not([aria-busy])')

    // A large body keeps the upload genuinely in flight for the duration of
    // the server-side delay.
    await page.setInputFiles('[name="audio.clip"]', {
      name: 'beep.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(256 * 1024, 0x61),
    })
    await page.click('#audio\\.clip-upload')
    await waitForUploading(page.request)

    await expect.poll(async function () {
      return await page.locator('#audio\\.clip-progress').evaluate(function (el) { return el.value })
    }).toBeGreaterThan(0)

    await page.click('#audio\\.clip-cancel')
    await expect(page.locator('#audio\\.clip-msg')).toHaveText('Upload cancelled')

    await waitForUploadIdle(page.request)
    const state = await (await page.request.get('/api/test/upload-state')).json()
    expect(state.aborted).toContain('audio.clip')
    expect((await page.request.get('/api/test/uploads/audio/clip')).status()).toBe(404)
  })

  test('timeout unlocks the UI and clears the uploading flag', async ({ page }) => {
    await page.goto('/#audio')
    await page.waitForSelector('#config-form:not([aria-busy])')

    await page.request.post('/api/test/upload-timeout', { data: { ms: 500 } })

    // Locked while the server holds the upload flag.
    await expect(page.locator('#nav-reboot')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('#audio\\.clip-msg')).toHaveText('Another upload is in progress.')

    // Unlocked once the timeout flips the flag back and broadcasts.
    await expect(page.locator('#nav-reboot')).toHaveAttribute('aria-disabled', 'false', { timeout: 5000 })
    await expect(page.locator('#audio\\.clip-msg')).toHaveText('')

    const meta = await (await page.request.get('/api/settings')).json()
    expect(meta._meta.uploading).toBe(false)
  })
})
