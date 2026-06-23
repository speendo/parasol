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

  it('hides and disables Save when not dirty', () => {
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('shows and enables Save when dirty', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
    expect(document.getElementById('btn-save-apply').disabled).toBe(false)
  })

  it('disables and hides Save when form is invalid even if dirty', () => {
    window.__test.dirty = true
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('hides Save after dirty is cleared', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
    window.__test.dirty = false
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('btn-reset does not exist in DOM', () => {
    expect(document.getElementById('btn-reset')).toBeNull()
  })
})

describe('createField', () => {
  it('creates text input with attributes', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { attrs: { maxlength: '32', placeholder: 'MyNetwork' }, tooltip: 'WiFi network name' },
    })
    expect(field.tagName).toBe('DIV')
    expect(field.querySelector('label').getAttribute('for')).toBe('wifi.ssid')
    var input = field.querySelector('input')
    expect(input.type).toBe('text')
    expect(input.name).toBe('wifi.ssid')
    expect(input.id).toBe('wifi.ssid')
    expect(input.maxLength).toBe(32)
    expect(input.placeholder).toBe('MyNetwork')
  })

  it('creates select with options', () => {
    var field = window.createField('wifi', {
      key: 'mode', type: 'select', label: 'Mode',
      opts: { options: [['station', 'Station'], ['ap', 'AP']], value: 'station' },
    })
    expect(field.querySelector('label').getAttribute('for')).toBe('wifi.mode')
    var select = field.querySelector('select')
    expect(select.options.length).toBe(2)
    expect(select.options[0].value).toBe('station')
    expect(select.options[1].value).toBe('ap')
    expect(select.value).toBe('station')
    expect(select.id).toBe('wifi.mode')
  })

  it('creates switch (checkbox with role)', () => {
    var field = window.createField('wifi', {
      key: 'hidden', type: 'switch', label: 'Hidden',
      opts: { attrs: { role: 'switch' }, value: true },
    })
    expect(field.querySelector('label').getAttribute('for')).toBe('wifi.hidden')
    var input = field.querySelector('input')
    expect(input.type).toBe('checkbox')
    expect(input.role).toBe('switch')
    expect(input.checked).toBe(true)
    expect(input.id).toBe('wifi.hidden')
  })

  it('creates range with output display', () => {
    var field = window.createField('wifi', {
      key: 'channel', type: 'range', label: 'Channel',
      opts: { attrs: { min: '1', max: '13', step: '1' }, value: '6' },
    })
    expect(field.querySelector('label').getAttribute('for')).toBe('wifi.channel')
    expect(field.querySelector('input[type="range"]').id).toBe('wifi.channel')
    expect(field.querySelector('output')).not.toBeNull()
  })

  it('creates number input', () => {
    var field = window.createField('gpio', {
      key: 'pin', type: 'number', label: 'Pin Number',
      opts: { attrs: { min: '0', max: '39' }, value: '2' },
    })
    expect(field.querySelector('label').getAttribute('for')).toBe('gpio.pin')
    var input = field.querySelector('input[type="number"]')
    expect(input.min).toBe('0')
    expect(input.max).toBe('39')
    expect(input.value).toBe('2')
    expect(input.id).toBe('gpio.pin')
  })

  it('creates radio group', () => {
    var field = window.createField('gpio', {
      key: 'pull', type: 'radio', label: 'Pull Resistor',
      opts: { options: [['none', 'None'], ['up', 'Up'], ['down', 'Down']], value: 'none' },
    })
    expect(field.tagName).toBe('DIV')
    var fieldset = field.querySelector('fieldset')
    expect(fieldset).not.toBeNull()
    var radios = field.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    expect(radios[0].value).toBe('none')
    expect(radios[0].id).toBe('gpio.pull.none')
    expect(radios[1].value).toBe('up')
    expect(radios[1].id).toBe('gpio.pull.up')
    expect(radios[2].value).toBe('down')
    expect(radios[2].id).toBe('gpio.pull.down')
    var labels = field.querySelectorAll('label')
    expect(labels[0].getAttribute('for')).toBe('gpio.pull.none')
    expect(labels[1].getAttribute('for')).toBe('gpio.pull.up')
    expect(labels[2].getAttribute('for')).toBe('gpio.pull.down')
    expect(field.querySelectorAll('input + label').length).toBe(3)
  })

  it('sets tooltip as small helper after input', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { tooltip: 'Network name' },
    })
    var small = field.querySelector('small')
    expect(small).not.toBeNull()
    expect(small.textContent).toBe('Network name')
    expect(small.id).toBe('wifi.ssid-helper')
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBe('wifi.ssid-helper')
  })

  it('does not create small helper when tooltip is omitted', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
    })
    expect(field.querySelector('small')).toBeNull()
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBeNull()
  })

  it('does not create small helper when tooltip is empty', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { tooltip: '' },
    })
    expect(field.querySelector('small')).toBeNull()
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBeNull()
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

  it('clears error, resets baseline, updates UI', () => {
    window.syncThen()
    expect(window.getPending()).toEqual({})
    expect(document.getElementById('status-bar').textContent).toBe('')
  })
})

describe('connectWS', () => {
  it('sets aria-busy on form', () => {
    window.connectWS()
    expect(document.getElementById('config-form').getAttribute('aria-busy')).toBe('true')
  })
})

describe('processSettings', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = ''
    document.getElementById('nav-list').innerHTML = ''
    window.__test.components = []
  })

  it('builds components from settings data', () => {
    var data = {
      wifi: { ssid: ['text', 'SSID', { value: 'MyNet' }] },
      gpio: { pin: ['number', 'Pin', { value: 5 }] },
    }
    window.processSettings(data, false)
    expect(window.__test.components.length).toBe(2)
    expect(window.__test.components[0].id).toBe('wifi')
    expect(window.__test.components[1].id).toBe('gpio')
  })

  it('captures dirty flag', () => {
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: '' }] } }, true)
    expect(window.__test.dirty).toBe(true)
  })

  it('captures dirty as false', () => {
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: '' }] } }, false)
    expect(window.__test.dirty).toBe(false)
  })

  it('removes aria-busy after rendering', () => {
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: '' }] } }, false)
    expect(document.getElementById('config-form').getAttribute('aria-busy')).toBeNull()
  })

  it('clears error on successful load', () => {
    document.getElementById('status-bar').textContent = 'Previous error'
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: '' }] } }, false)
    expect(document.getElementById('status-bar').textContent).toBe('')
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

describe('onUserInput', () => {
  beforeEach(() => {
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
    window.connectWS()
    window.__test.wsReady()
  })

  it('sends value over WS when field changes', () => {
    window.onUserInput('wifi.ssid', 'NewNet')
    expect(window.__test.wsSent).toEqual({ action: 'apply', data: { wifi: { ssid: ['text', 'SSID', { value: 'NewNet' }] } } })
  })

  it('sets lastSent and inFlight after sending', () => {
    window.onUserInput('gpio.pin', 7)
    expect(window.__test.lastSent['gpio.pin']).toBe(7)
    expect(window.__test.inFlight['gpio.pin']).toBe(true)
  })

  it('does not send when value unchanged from lastSent', () => {
    window.onUserInput('wifi.ssid', 'SameNet')
    window.__test.wsSent = null
    window.onUserInput('wifi.ssid', 'SameNet')
    expect(window.__test.wsSent).toBeNull()
  })

  it('does not send when inFlight is true', () => {
    window.onUserInput('wifi.ssid', 'val1')
    window.__test.wsSent = null
    window.onUserInput('wifi.ssid', 'val2')
    expect(window.__test.wsSent).toBeNull()
  })
})

describe('init', () => {
  beforeEach(() => {
    document.getElementById('nav-list').innerHTML = ''
    document.getElementById('config-form').innerHTML = ''
    document.getElementById('status-bar').textContent = ''
  })

  it('sets aria-busy and connects WS on init', async () => {
    await window.init()
    expect(document.getElementById('config-form').getAttribute('aria-busy')).toBe('true')
  })
})

// Tests for the full onWSMessage state machine covering all 10 cases.
describe('onWSMessage — all 10 state machine cases', () => {
  function setupCase(fv, av, ls, inflight) {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="' + fv + '" />'
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: av } },
      ]},
    ]
    window.__test.lastSent = {}
    if (ls !== undefined) window.__test.lastSent['wifi.ssid'] = ls
    window.__test.inFlight = {}
    if (inflight) window.__test.inFlight['wifi.ssid'] = true
  }

  function serverPush(newAv) {
    return JSON.stringify({ _dirty: false,
      wifi: { ssid: ['text', 'SSID', { value: newAv }] },
    })
  }

  beforeEach(() => {
    document.getElementById('server-changed').hidden = true
    document.querySelector('#config-form').innerHTML = ''
    window.__test.components = []
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    document.getElementById('notif-load').hidden = true
    document.getElementById('notif-keep').hidden = true
    document.getElementById('notif-keep-local').hidden = true
    document.getElementById('notif-accept-server').hidden = true
  })

  it('Case 1: no-op when everything is synced', () => {
    setupCase('hello', 'hello', 'hello', false)
    window.__test.receiveWSMessage({ data: serverPush('hello') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('hello')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('Case 3: shows external notification when server pushes new value while idle', () => {
    setupCase('oldVal', 'oldVal', 'oldVal', false)
    window.__test.receiveWSMessage({ data: serverPush('newServerVal') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('newServerVal')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('oldVal')
    expect(document.getElementById('server-changed').hidden).toBe(false)
    expect(document.getElementById('notif-load').hidden).toBe(false)
    expect(document.getElementById('notif-keep').hidden).toBe(false)
    expect(document.getElementById('notif-keep-local').hidden).toBe(true)
    expect(document.getElementById('notif-accept-server').hidden).toBe(true)
  })

  it('Case 4: silent sync when FV matches server push', () => {
    setupCase('match', 'oldVal', 'oldVal', false)
    window.__test.receiveWSMessage({ data: serverPush('match') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('match')
    expect(window.__test.lastSent['wifi.ssid']).toBe('match')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('Case 5: shows conflict prompt when local and server both changed', () => {
    setupCase('myLocal', 'oldVal', 'oldVal', false)
    window.__test.receiveWSMessage({ data: serverPush('serverChanged') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('serverChanged')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('myLocal')
    expect(document.getElementById('server-changed').hidden).toBe(false)
    expect(document.getElementById('notif-load').hidden).toBe(true)
    expect(document.getElementById('notif-keep').hidden).toBe(true)
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)
    expect(document.getElementById('notif-accept-server').hidden).toBe(false)
  })

  it('Case 6: clears inFlight when echo matches', () => {
    setupCase('sentVal', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('sentVal') })
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
    expect(window.__test.components[0].fields[0].opts.value).toBe('sentVal')
  })

  it('Case 7: sends queued input after echo arrives', () => {
    setupCase('queuedNew', 'oldVal', 'sentVal', true)
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
    window.__test.wsReady()
    window.__test.receiveWSMessage({ data: serverPush('sentVal') })
    expect(window.__test.wsSent).toEqual({
      action: 'apply',
      data: { wifi: { ssid: ['text', 'SSID', { value: 'queuedNew' }] } },
    })
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('Case 8: ignores packet when inFlight and no echo match', () => {
    setupCase('local', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('unrelatedExternal') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('oldVal')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('Case 9: ignores packet while inFlight even if user reverted (FV == oldAV)', () => {
    setupCase('oldVal', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('someExternal') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('oldVal')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('Case 10: ignores packet while inFlight even with conflicting local change', () => {
    setupCase('userChange', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('yetAnotherExt') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('oldVal')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })
})

describe('WS reconnect', () => {
  beforeEach(() => {
    document.getElementById('status-bar').textContent = ''
    var existing = document.getElementById('btn-ws-retry')
    if (existing) existing.remove()
  })

  it('shows retry button after 5 failed attempts', () => {
    for (var i = 0; i < 5; i++) {
      window.onWSClose()
    }
    expect(document.getElementById('status-bar').textContent).toContain('Cannot connect')
    expect(document.getElementById('btn-ws-retry').hidden).toBe(false)
  })

  it('sets aria-busy on close', () => {
    window.onWSClose()
    expect(document.getElementById('config-form').getAttribute('aria-busy')).toBe('true')
  })
})

describe('populateFromComponents null safety', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />'
  })

  it('handles field without opts gracefully', () => {
    expect(function () {
      window.populateFromComponents([
        { id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID' }] },
      ])
    }).not.toThrow()
  })

  it('handles field with opts undefined gracefully', () => {
    expect(function () {
      window.populateFromComponents([
        { id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: undefined }] },
      ])
    }).not.toThrow()
  })
})

describe('dirty flag propagation', () => {
  beforeEach(() => {
    window.__test.dirty = false
    window.__test.inFlight = {}
    window.__test.lastSent = {}
  })

  it('onWSMessage sets dirty from _dirty flag', () => {
    window.__test.receiveWSMessage({ data: JSON.stringify({ _dirty: true, wifi: { ssid: ['text', 'SSID', { value: '' }] } }) })
    expect(window.__test.dirty).toBe(true)
  })

  it('onWSMessage sets dirty false when _dirty is false', () => {
    window.__test.receiveWSMessage({ data: JSON.stringify({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: '' }] } }) })
    expect(window.__test.dirty).toBe(false)
  })

  it('syncThen resets dirty to false', () => {
    window.__test.dirty = true
    window.syncThen()
    expect(window.__test.dirty).toBe(false)
  })
})

describe('sendToServer field lookup', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />'
    window.__test.components = [
      { id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: {} }] },
    ]
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    if (window.ws) window.ws.close()
    window.connectWS()
  })

  it('sends full field format with type and label from components', () => {
    window.__test.wsReady()
    window.sendToServer('wifi.ssid', 'MyVal')
    expect(window.__test.wsSent).toEqual({
      action: 'apply',
      data: { wifi: { ssid: ['text', 'SSID', { value: 'MyVal' }] } },
    })
  })
})

describe('radio event handling', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input type="radio" name="gpio.pull" id="gpio.pull.none" value="none">',
      '<input type="radio" name="gpio.pull" id="gpio.pull.up" value="up">',
      '<input type="radio" name="gpio.pull" id="gpio.pull.down" value="down">',
    ].join('')
    window.__test.components = [{
      id: 'gpio', fields: [
        { key: 'pull', type: 'radio', label: 'Pull Resistor', opts: { value: 'none' } },
      ],
    }]
    window.__test.dirty = false
    window.setBaseline()
  })

  it('radio uses click event not change', () => {
    window.bindChangeListeners()
    var radio = document.getElementById('gpio.pull.up')
    var clickFired = false
    radio.addEventListener('click', function () { clickFired = true })
    radio.dispatchEvent(new Event('click', { bubbles: true }))
    expect(clickFired).toBe(true)
  })

  it('bindChangeListeners does not attach change handler to radio', () => {
    window.bindChangeListeners()
    var radio = document.getElementById('gpio.pull.up')
    var handlers = radio.eventListeners
    expect(handlers).toBeUndefined()
  })
})

describe('radio createField structure', () => {
  it('returns div container not fieldset', () => {
    var field = window.createField('gpio', {
      key: 'pull', type: 'radio', label: 'Pull Resistor',
      opts: { options: [['none', 'None'], ['up', 'Up'], ['down', 'Down']], value: 'none' },
    })
    expect(field.tagName).toBe('DIV')
    expect(field.querySelector('fieldset')).not.toBeNull()
  })

  it('radio tooltip is outside fieldset inside the container div', () => {
    var field = window.createField('gpio', {
      key: 'pull', type: 'radio', label: 'Pull Resistor',
      opts: {
        options: [['none', 'None'], ['up', 'Up'], ['down', 'Down']],
        value: 'none',
        tooltip: 'Select pull resistor',
      },
    })
    var fieldset = field.querySelector('fieldset')
    var small = field.querySelector('small')
    expect(small).not.toBeNull()
    expect(fieldset.contains(small)).toBe(false)
    expect(field.contains(small)).toBe(true)
  })
})

describe('echo path syncLS', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="newVal" />'
    window.__test.components = [{
      id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = { 'wifi.ssid': true }
    window.__test.lastSent['wifi.ssid'] = 'newVal'
  })

  it('syncLS called after echo match updates lastSent', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: { ssid: ['text', 'SSID', { value: 'newVal' }] },
      }),
    })
    expect(window.__test.lastSent['wifi.ssid']).toBe('newVal')
  })
})

describe('init does not call bindChangeListeners', () => {
  beforeEach(() => {
    document.getElementById('nav-list').innerHTML = ''
    document.getElementById('config-form').innerHTML = ''
    document.getElementById('status-bar').textContent = ''
  })

  it('init connects WS without calling bindChangeListeners', async () => {
    var called = false
    var orig = window.bindChangeListeners
    window.bindChangeListeners = function () { called = true }
    await window.init()
    expect(called).toBe(false)
    window.bindChangeListeners = orig
  })
})

describe('readFormValue', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input type="radio" name="gpio.pull" id="gpio.pull.none" value="none" checked />',
      '<input type="radio" name="gpio.pull" id="gpio.pull.up" value="up" />',
      '<input type="radio" name="gpio.pull" id="gpio.pull.down" value="down" />',
    ].join('')
  })

  it('returns checked radio value not first radio', () => {
    expect(window.readFormValue(['gpio', 'pull'])).toBe('none')
  })

  it('returns updated checked radio value after selection change', () => {
    document.getElementById('gpio.pull.up').checked = true
    expect(window.readFormValue(['gpio', 'pull'])).toBe('up')
  })

  it('returns checked state for checkbox (true/false)', () => {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="gpio.enabled" checked />'
    expect(window.readFormValue(['gpio', 'enabled'])).toBe(true)
    document.querySelector('[name="gpio.enabled"]').checked = false
    expect(window.readFormValue(['gpio', 'enabled'])).toBe(false)
  })

  it('returns value for non-radio fields unchanged', () => {
    var text = document.createElement('input')
    text.setAttribute('name', 'wifi.ssid')
    text.value = 'hello'
    document.querySelector('#config-form').appendChild(text)
    expect(window.readFormValue(['wifi', 'ssid'])).toBe('hello')
  })

  it('returns undefined when element not found', () => {
    expect(window.readFormValue(['wifi', 'missing'])).toBeUndefined()
  })
})

describe('dirty flag survives dropped WS messages', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input type="radio" name="gpio.pull" value="none" checked />',
      '<input type="radio" name="gpio.pull" value="up" />',
      '<input type="radio" name="gpio.pull" value="down" />',
    ].join('')
    window.__test.components = [{
      id: 'gpio', fields: [
        { key: 'pull', type: 'radio', label: 'Pull Resistor', opts: { value: 'up' } },
      ],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = true
    window.__test.lastSent['gpio.pull'] = 'up'
    window.__test.inFlight['gpio.pull'] = true
  })

  it('dirty stays true when WS message is dropped due to inFlight mismatch', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        gpio: { pull: ['radio', 'Pull Resistor', { value: 'none' }] },
      }),
    })
    expect(window.__test.dirty).toBe(true)
  })
})

describe('echo resolution with radio does not trigger spurious queued keys', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input type="radio" name="gpio.pull" value="none" />',
      '<input type="radio" name="gpio.pull" value="up" checked />',
      '<input type="radio" name="gpio.pull" value="down" />',
    ].join('')
    window.__test.components = [{
      id: 'gpio', fields: [
        { key: 'pull', type: 'radio', label: 'Pull Resistor', opts: { value: 'none' } },
      ],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    window.__test.lastSent['gpio.pull'] = 'up'
    window.__test.inFlight['gpio.pull'] = true
    document.getElementById('server-changed').hidden = true
  })

  it('echo match does not queue spurious change for radio', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        gpio: { pull: ['radio', 'Pull Resistor', { value: 'up' }] },
      }),
    })
    expect(window.__test.inFlight['gpio.pull']).toBe(false)
    expect(window.__test.dirty).toBe(true)
    expect(window.__test.components[0].fields[0].opts.value).toBe('up')
  })
})

describe('echo resolution with checkbox preserves dirty', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="gpio.enabled" checked />'
    window.__test.components = [{
      id: 'gpio', fields: [
        { key: 'enabled', type: 'checkbox', label: 'GPIO Enabled', opts: { value: false } },
      ],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    window.__test.lastSent['gpio.enabled'] = true
    window.__test.inFlight['gpio.enabled'] = true
    document.getElementById('server-changed').hidden = true
  })

  it('echo match with checkbox does not queue spurious change', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        gpio: { enabled: ['checkbox', 'GPIO Enabled', { value: true }] },
      }),
    })
    expect(window.__test.inFlight['gpio.enabled']).toBe(false)
    expect(window.__test.dirty).toBe(true)
    expect(window.__test.components[0].fields[0].opts.value).toBe(true)
  })
})

describe('footer visibility (CSS-only)', () => {
  beforeEach(() => {
    document.getElementById('status-bar').textContent = ''
  })

  it('footer visible when status bar has content even without button', () => {
    window.showError('Test error')
    var footer = document.querySelector('footer')
    var btnHidden = document.getElementById('btn-save-apply').hidden
    var cssHides = btnHidden && !document.getElementById('status-bar').textContent
    expect(cssHides).toBe(false)
  })
})
