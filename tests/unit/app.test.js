import { describe, it, expect, beforeEach } from 'vitest'

describe('serialize', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = `
      <input name="wifi.ssid" value="" />
      <select name="wifi.mode">
        <option value="station" selected>Station</option>
        <option value="ap">AP</option>
      </select>
      <input type="checkbox" name="wifi.hidden" role="switch" />
      <input type="range" name="wifi.channel" value="6" min="1" max="13" />
    `
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: {} },
        { key: 'mode', type: 'select', label: 'Mode', opts: {} },
        { key: 'hidden', type: 'switch', label: 'Hidden', opts: {} },
        { key: 'channel', type: 'range', label: 'Channel', opts: {} },
      ]},
    ]
  })

  it('returns current form values', () => {
    var data = window.serialize()
    expect(data).toEqual({
      'wifi.ssid': '',
      'wifi.mode': 'station',
      'wifi.hidden': false,
      'wifi.channel': '6',
    })
  })

  it('returns updated values after input change', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'MyNet'
    document.querySelector('[name="wifi.mode"]').value = 'ap'
    document.querySelector('[name="wifi.hidden"]').checked = true
    var data = window.serialize()
    expect(data).toEqual({
      'wifi.ssid': 'MyNet',
      'wifi.mode': 'ap',
      'wifi.hidden': true,
      'wifi.channel': '6',
    })
  })
})

describe('setBaseline / getPending', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = `
      <input name="wifi.ssid" value="" />
      <input name="wifi.channel" value="6" />
    `
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: {} },
        { key: 'channel', type: 'range', label: 'Channel', opts: {} },
      ]},
    ]
    window.setBaseline()
  })

  it('getPending returns empty when nothing changed', () => {
    expect(window.getPending()).toEqual({})
  })

  it('getPending detects a changed field', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'MyNet'
    expect(window.getPending()).toEqual({ 'wifi.ssid': 'MyNet' })
  })

  it('getPending returns empty after reverting', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Temp'
    expect(window.getPending()).toEqual({ 'wifi.ssid': 'Temp' })
    document.querySelector('[name="wifi.ssid"]').value = ''
    expect(window.getPending()).toEqual({})
  })

  it('getPending detects multiple changes', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    document.querySelector('[name="wifi.channel"]').value = '11'
    expect(window.getPending()).toEqual({ 'wifi.ssid': 'Net', 'wifi.channel': '11' })
  })
})

describe('updateUI', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = `
      <input name="wifi.ssid" value="" required />
    `
    window.__test.components = [
      { id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: {} }] },
    ]
    window.__test.dirty = false
    window.setBaseline()
  })

  it('disables buttons when no pending changes and not dirty', () => {
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })

  it('enables Reset when pending changes exist', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(false)
  })

  it('disables Reset when form is invalid', () => {
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })

  it('enables Save & Apply when dirty is true', () => {
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(false)
  })

  it('disables Save & Apply when dirty is false', () => {
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('disables Reset when pending is reverted', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(false)
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })
})

describe('createField', () => {
  it('creates text input with attributes', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { attrs: { maxlength: '32', placeholder: 'MyNetwork' }, tooltip: 'WiFi network name' },
    })
    expect(field.tagName).toBe('LABEL')
    var input = field.querySelector('input')
    expect(input.type).toBe('text')
    expect(input.name).toBe('wifi.ssid')
    expect(input.maxLength).toBe(32)
    expect(input.placeholder).toBe('MyNetwork')
  })

  it('creates select with options', () => {
    var field = window.createField('wifi', {
      key: 'mode', type: 'select', label: 'Mode',
      opts: { options: [['station', 'Station'], ['ap', 'AP']], value: 'station' },
    })
    var select = field.querySelector('select')
    expect(select.options.length).toBe(2)
    expect(select.options[0].value).toBe('station')
    expect(select.options[1].value).toBe('ap')
    expect(select.value).toBe('station')
  })

  it('creates switch (checkbox with role)', () => {
    var field = window.createField('wifi', {
      key: 'hidden', type: 'switch', label: 'Hidden',
      opts: { attrs: { role: 'switch' }, value: true },
    })
    var input = field.querySelector('input')
    expect(input.type).toBe('checkbox')
    expect(input.role).toBe('switch')
    expect(input.checked).toBe(true)
  })

  it('creates range with output display', () => {
    var field = window.createField('wifi', {
      key: 'channel', type: 'range', label: 'Channel',
      opts: { attrs: { min: '1', max: '13', step: '1' }, value: '6' },
    })
    expect(field.querySelector('input[type="range"]')).not.toBeNull()
    expect(field.querySelector('output')).not.toBeNull()
  })

  it('creates number input', () => {
    var field = window.createField('gpio', {
      key: 'pin', type: 'number', label: 'Pin Number',
      opts: { attrs: { min: '0', max: '39' }, value: '2' },
    })
    var input = field.querySelector('input[type="number"]')
    expect(input.min).toBe('0')
    expect(input.max).toBe('39')
    expect(input.value).toBe('2')
  })

  it('creates radio group', () => {
    var field = window.createField('gpio', {
      key: 'pull', type: 'radio', label: 'Pull Resistor',
      opts: { options: [['none', 'None'], ['up', 'Up'], ['down', 'Down']], value: 'none' },
    })
    expect(field.tagName).toBe('FIELDSET')
    var radios = field.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    expect(radios[0].value).toBe('none')
    expect(radios[1].value).toBe('up')
    expect(radios[2].value).toBe('down')
  })

  it('sets tooltip attribute on label', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { tooltip: 'Network name' },
    })
    expect(field.getAttribute('data-tooltip')).toBe('Network name')
  })

  it('returns null for invalid field spec', () => {
    expect(window.createField('x', null)).toBeNull()
    expect(window.createField('x', {})).toBeNull()
  })
})

describe('applyAttrs', () => {
  it('sets multiple attributes on an element', () => {
    var el = document.createElement('input')
    window.applyAttrs(el, { maxlength: '32', placeholder: 'Name', min: '0' })
    expect(el.getAttribute('maxlength')).toBe('32')
    expect(el.getAttribute('placeholder')).toBe('Name')
    expect(el.getAttribute('min')).toBe('0')
  })

  it('handles null/undefined attrs gracefully', () => {
    var el = document.createElement('input')
    expect(function () { window.applyAttrs(el, null) }).not.toThrow()
    expect(function () { window.applyAttrs(el, undefined) }).not.toThrow()
  })
})

describe('populateFromComponents', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = `
      <input name="wifi.ssid" value="old" />
      <select name="wifi.mode">
        <option value="station">Station</option>
        <option value="ap" selected>AP</option>
      </select>
      <input type="checkbox" name="wifi.hidden" role="switch" />
    `
  })

  it('sets form values from components data using opts.value', () => {
    window.populateFromComponents([
      {
        id: 'wifi',
        fields: [
          { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'new-ssid' } },
          { key: 'mode', type: 'select', label: 'Mode', opts: { value: 'station' } },
          { key: 'hidden', type: 'switch', label: 'Hidden', opts: { value: false } },
        ],
      },
    ])
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('new-ssid')
    expect(document.querySelector('[name="wifi.mode"]').value).toBe('station')
    expect(document.querySelector('[name="wifi.hidden"]').checked).toBe(false)
  })

  it('handles empty fields gracefully', () => {
    expect(function () { window.populateFromComponents([]) }).not.toThrow()
    expect(function () { window.populateFromComponents([{ id: 'x' }]) }).not.toThrow()
  })
})

describe('showError / clearError', () => {
  beforeEach(() => {
    var sb = document.getElementById('status-bar')
    sb.textContent = ''
    sb.style.color = ''
  })

  it('showError sets status bar text and red color', () => {
    window.showError('Something failed')
    expect(document.getElementById('status-bar').textContent).toBe('Something failed')
    expect(document.getElementById('status-bar').style.color).toBe('var(--pico-color-red)')
  })

  it('clearError resets status bar', () => {
    window.showError('Error')
    window.clearError()
    expect(document.getElementById('status-bar').textContent).toBe('')
    expect(document.getElementById('status-bar').style.color).toBe('')
  })
})

describe('postJSON', () => {
  beforeEach(() => {
    document.getElementById('status-bar').textContent = ''
  })

  it('sends POST with JSON body and returns true on success', async () => {
    var captured
    window.fetch = function (url, opts) {
      captured = { url: url, opts: opts }
      return Promise.resolve({ ok: true })
    }
    var result = await window.postJSON('/api/settings/apply', { key: 'val' })
    expect(result).toBe(true)
    expect(captured.url).toBe('/api/settings/apply')
    expect(captured.opts.method).toBe('POST')
    expect(captured.opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(captured.opts.body)).toEqual({ key: 'val' })
  })

  it('returns false and shows error on HTTP error', async () => {
    window.fetch = function () { return Promise.resolve({ ok: false, status: 400, text: function () { return Promise.resolve('Bad request') } }) }
    var result = await window.postJSON('/api/settings/apply', {})
    expect(result).toBe(false)
    expect(document.getElementById('status-bar').textContent).toContain('Request failed')
  })

  it('returns false and shows error on network failure', async () => {
    window.fetch = function () { return Promise.reject(new Error('Network error')) }
    var result = await window.postJSON('/api/settings/apply', {})
    expect(result).toBe(false)
    expect(document.getElementById('status-bar').textContent).toContain('Request failed')
  })
})

describe('loadSettings', () => {
  beforeEach(() => {
    window.__test.components = []
    document.getElementById('status-bar').textContent = ''
  })

  it('loads settings and builds components on success', async () => {
    window.fetch = function () {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({
          _dirty: false,
          wifi: {
            ssid: ['text', 'SSID', { value: '', tooltip: 'WiFi network name' }],
          },
        })},
      })
    }
    var result = await window.loadSettings()
    expect(result).toBe(true)
    expect(window.__test.components.length).toBe(1)
    expect(window.__test.components[0].id).toBe('wifi')
    expect(window.__test.components[0].label).toBe('Wifi')
    expect(window.__test.components[0].fields.length).toBe(1)
    expect(window.__test.components[0].fields[0].key).toBe('ssid')
    expect(window.__test.components[0].fields[0].type).toBe('text')
    expect(window.__test.components[0].fields[0].label).toBe('SSID')
    expect(window.__test.components[0].fields[0].opts.value).toBe('')
  })

  it('shows error on 404', async () => {
    window.fetch = function () { return Promise.resolve({ ok: false, status: 404 }) }
    var result = await window.loadSettings()
    expect(result).toBe(false)
    expect(document.getElementById('status-bar').textContent).toContain('Failed to load settings')
  })

  it('shows error on network failure', async () => {
    window.fetch = function () { return Promise.reject(new Error('Network error')) }
    var result = await window.loadSettings()
    expect(result).toBe(false)
    expect(document.getElementById('status-bar').textContent).toContain('Failed to load settings')
  })

  it('captures _dirty flag from response', async () => {
    window.__test.dirty = null
    window.fetch = function () {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({
          _dirty: true,
          wifi: { ssid: ['text', 'SSID', { value: '' }] },
        })},
      })
    }
    await window.loadSettings()
    expect(window.__test.dirty).toBe(true)
  })

  it('captures _dirty as false when not dirty', async () => {
    window.__test.dirty = null
    window.fetch = function () {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({
          _dirty: false,
          wifi: { ssid: ['text', 'SSID', { value: '' }] },
        })},
      })
    }
    await window.loadSettings()
    expect(window.__test.dirty).toBe(false)
  })
})

describe('renderNav', () => {
  beforeEach(() => {
    document.getElementById('nav-list').innerHTML = ''
    window.__test.components = [
      { id: 'wifi', label: 'Wifi' },
      { id: 'gpio', label: 'Gpio' },
    ]
  })

  it('renders nav links for each component', () => {
    window.renderNav()
    var links = document.querySelectorAll('#nav-list a')
    expect(links.length).toBe(2)
    expect(links[0].textContent).toBe('Wifi')
    expect(links[0].getAttribute('href')).toBe('#wifi')
    expect(links[1].textContent).toBe('Gpio')
    expect(links[1].getAttribute('href')).toBe('#gpio')
  })
})

describe('renderForm', () => {
  beforeEach(() => {
    document.getElementById('config-form').innerHTML = ''
    window.__test.components = [
      {
        id: 'wifi',
        label: 'Wifi',
        fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { tooltip: 'Network name' } }],
      },
    ]
  })

  it('renders accordion details for each component', () => {
    window.renderForm()
    var details = document.querySelector('#config-form details')
    expect(details).not.toBeNull()
    expect(details.id).toBe('wifi')
    expect(details.querySelector('summary').textContent).toBe('Wifi')
  })

  it('renders fields inside accordion', () => {
    window.renderForm()
    var input = document.querySelector('#config-form input[name="wifi.ssid"]')
    expect(input).not.toBeNull()
  })
})

describe('handleHash', () => {
  beforeEach(() => {
    var el = document.createElement('details')
    el.id = 'test-section'
    el.innerHTML = '<summary>Test</summary>'
    document.body.appendChild(el)
  })

  it('opens details section matching location hash', () => {
    location.hash = '#test-section'
    window.handleHash()
    expect(document.getElementById('test-section').open).toBe(true)
  })
})

describe('wireButtons / bindChangeListeners', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />'
    window.__test.components = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID' }] }]
    window.__test.dirty = false
    window.setBaseline()
  })

  it('wireButtons attaches click handler to btn-reset', async () => {
    document.querySelector('[name="wifi.ssid"]').value = 'changed'
    window.fetch = function (url, opts) {
      if (opts && opts.method === 'POST') return Promise.resolve({ ok: true })
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'changed' }] } }) } })
    }
    window.wireButtons()
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(false)
    document.getElementById('btn-reset').click()
    await new Promise(function (r) { return setTimeout(r, 0) })
    expect(window.getPending()).toEqual({})
  })

  it('bindChangeListeners triggers updateUI on input event', () => {
    window.bindChangeListeners()
    document.querySelector('[name="wifi.ssid"]').value = 'changed'
    document.querySelector('[name="wifi.ssid"]').dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('bindChangeListeners triggers updateUI on change event', () => {
    window.bindChangeListeners()
    document.querySelector('[name="wifi.ssid"]').value = 'changed'
    document.querySelector('[name="wifi.ssid"]').dispatchEvent(new Event('change', { bubbles: true }))
  })
})

describe('refreshComponents', () => {
  beforeEach(() => {
    window.__test.components = [{ id: 'wifi', label: 'Wifi' }]
    document.getElementById('status-bar').textContent = ''
  })

  it('fetches /api/settings and updates fields', async () => {
    window.fetch = function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'test' }] } }) } })
    }
    await window.refreshComponents()
    expect(window.__test.components[0].fields).toBeDefined()
    expect(window.__test.components[0].fields.length).toBe(1)
    expect(window.__test.components[0].fields[0].key).toBe('ssid')
  })

  it('shows error on fetch failure', async () => {
    window.fetch = function () { return Promise.resolve({ ok: false, status: 404 }) }
    await window.refreshComponents()
    expect(document.getElementById('status-bar').textContent).toContain('Failed to refresh')
  })

  it('captures _dirty flag from refresh response', async () => {
    window.__test.dirty = null
    window.fetch = function () {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({
          _dirty: true,
          wifi: { ssid: ['text', 'SSID', { value: 'test' }] },
        })},
      })
    }
    await window.refreshComponents()
    expect(window.__test.dirty).toBe(true)
  })
})

describe('syncThen', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="old" />'
    window.__test.components = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'new' } }] }]
    window.setBaseline()
    document.getElementById('status-bar').textContent = 'old error'
    window.fetch = function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'new' }] } }) } })
    }
  })

  it('with true repopulates, resets baseline, clears error', async () => {
    window.syncThen(true)
    await new Promise(function (r) { return setTimeout(r, 0) })
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('new')
    expect(window.getPending()).toEqual({})
    expect(document.getElementById('status-bar').textContent).toBe('')
  })

  it('with false does not repopulate but resets baseline', async () => {
    window.syncThen(false)
    await new Promise(function (r) { return setTimeout(r, 0) })
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('old')
    expect(window.getPending()).toEqual({})
  })
})

describe('buildPatch', () => {
  beforeEach(() => {
    window.__test.components = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: {} }] }]
  })

  it('converts flat changes to nested POST body', () => {
    var patch = window.buildPatch({ 'wifi.ssid': 'MyNet' })
    expect(patch).toEqual({ wifi: { ssid: ['text', 'SSID', { value: 'MyNet' }] } })
  })

  it('returns empty object for no changes', () => {
    var patch = window.buildPatch({})
    expect(patch).toEqual({})
  })
})

describe('handleSaveApply', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />'
    window.__test.components = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID' }] }]
    window.__test.dirty = false
    window.setBaseline()
  })

  it('sends pending patch to /api/settings/save', async () => {
    var postedUrl = null
    window.fetch = function (url, opts) {
      if (opts && opts.method === 'POST') {
        postedUrl = url
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false }) } })
    }
    document.querySelector('[name="wifi.ssid"]').value = 'saved'
    window.handleSaveApply()
    await new Promise(function (r) { return setTimeout(r, 0) })
    expect(postedUrl).toBe('/api/settings/save')
  })

  it('sends all form values when no pending but dirty is true', async () => {
    window.__test.dirty = true
    var postedData = null
    window.fetch = function (url, opts) {
      if (opts && opts.method === 'POST') {
        postedData = JSON.parse(opts.body)
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false }) } })
    }
    window.handleSaveApply()
    await new Promise(function (r) { return setTimeout(r, 0) })
    expect(postedData).toEqual({ wifi: { ssid: ['text', 'SSID', { value: '' }] } })
  })

  it('does nothing when no pending and dirty is false', () => {
    window.fetch = function () { throw new Error('should not be called') }
    expect(function () { window.handleSaveApply() }).not.toThrow()
  })
})

describe('handleReset', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="baseline" />'
    window.__test.components = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'baseline' } }] }]
    window.setBaseline()
    document.getElementById('status-bar').textContent = 'some error'
    window.fetch = function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'baseline' }] } }) } })
    }
  })

  it('clears error and resets form to baseline', async () => {
    document.querySelector('[name="wifi.ssid"]').value = 'dirty'
    expect(Object.keys(window.getPending()).length).toBeGreaterThan(0)
    window.handleReset()
    await new Promise(function (r) { return setTimeout(r, 0) })
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('baseline')
    expect(window.getPending()).toEqual({})
    expect(document.getElementById('status-bar').textContent).toBe('')
  })
})

describe('init', () => {
  beforeEach(() => {
    document.getElementById('nav-list').innerHTML = ''
    document.getElementById('config-form').innerHTML = ''
    document.getElementById('status-bar').textContent = ''
  })

  it('loads settings, renders UI, sets baseline', async () => {
    window.fetch = function (url) {
      if (url === '/api/settings') {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve({
            _dirty: false,
            wifi: { ssid: ['text', 'SSID', { value: '', tooltip: 'Net name' }] },
          })},
        })
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}) } })
    }
    await window.init()
    expect(document.getElementById('nav-list').querySelectorAll('a').length).toBe(1)
    expect(document.querySelector('#config-form details')).not.toBeNull()
    expect(document.querySelector('[name="wifi.ssid"]')).not.toBeNull()
    expect(window.getPending()).toEqual({})
    expect(document.getElementById('status-bar').textContent).toBe('')
  })
})
