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
      <input type="color" name="wifi.led_color" value="#ff9500" />
    `
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: {} },
        { key: 'mode', type: 'select', label: 'Mode', opts: {} },
        { key: 'hidden', type: 'switch', label: 'Hidden', opts: {} },
        { key: 'channel', type: 'range', label: 'Channel', opts: {} },
        { key: 'led_color', type: 'color', label: 'LED Color', opts: {} },
      ]},
    ]
  })

  it('returns current form values', () => {
    var data = window.serialize()
    expect(data).toEqual({
      'wifi.ssid': '',
      'wifi.mode': 'station',
      'wifi.hidden': false,
      'wifi.channel': 6,
      'wifi.led_color': '#ff9500',
    })
  })

  it('returns updated values after input change', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'MyNet'
    document.querySelector('[name="wifi.mode"]').value = 'ap'
    document.querySelector('[name="wifi.hidden"]').checked = true
    document.querySelector('[name="wifi.led_color"]').value = '#00ff00'
    var data = window.serialize()
    expect(data).toEqual({
      'wifi.ssid': 'MyNet',
      'wifi.mode': 'ap',
      'wifi.hidden': true,
      'wifi.channel': 6,
      'wifi.led_color': '#00ff00',
    })
  })

  it('returns null for indeterminate checkbox', () => {
    window.__test.components[0].fields.push(
      { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: {} }
    )
    var el = document.querySelector('[name="wifi.confirm"]')
    if (!el) {
      el = document.createElement('input')
      el.type = 'checkbox'
      el.name = 'wifi.confirm'
      el.id = 'wifi.confirm'
      document.querySelector('#config-form').appendChild(el)
    }
    el.indeterminate = true
    var data = window.serialize()
    expect(data['wifi.confirm']).toBe(null)
  })

  it('returns number for number input (not string)', function () {
    document.querySelector('#config-form').innerHTML =
      '<input type="number" name="wifi.channel" value="7" />'
    window.__test.components[0].fields[0] =
      { key: 'channel', type: 'number', label: 'Channel', opts: {} }
    var data = window.serialize()
    expect(data['wifi.channel']).toBe(7)
  })

  it('returns number for range input (not string)', function () {
    document.querySelector('#config-form').innerHTML =
      '<input type="range" name="wifi.power" value="50" />'
    window.__test.components[0].fields[0] =
      { key: 'power', type: 'range', label: 'Power', opts: {} }
    var data = window.serialize()
    expect(data['wifi.power']).toBe(50)
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
    window.__test.formInteracted = true
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
      opts: { attrs: { maxlength: '32', placeholder: 'MyNetwork' }, help: 'WiFi network name' },
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
      opts: { value: true },
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

  it('creates color input', () => {
    var field = window.createField('gpio', {
      key: 'led_color', type: 'color', label: 'LED Color',
      opts: { value: '#ff9500', help: 'RGB LED color' },
    })
    expect(field.querySelector('label').getAttribute('for')).toBe('gpio.led_color')
    var input = field.querySelector('input[type="color"]')
    expect(input.value).toBe('#ff9500')
    expect(input.id).toBe('gpio.led_color')
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

  it('sets helper text as small after input', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { help: 'Network name' },
    })
    var small = field.querySelector('small')
    expect(small).not.toBeNull()
    expect(small.textContent).toBe('Network name')
    expect(small.id).toBe('wifi.ssid-helper')
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBe('wifi.ssid-helper')
  })

  it('does not create small helper when help is omitted', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
    })
    expect(field.querySelector('small')).toBeNull()
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBeNull()
  })

  it('does not create small helper when help is empty', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { help: '' },
    })
    expect(field.querySelector('small')).toBeNull()
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBeNull()
  })

  it('returns null for invalid field spec', () => {
    expect(window.createField('x', null)).toBeNull()
    expect(window.createField('x', {})).toBeNull()
  })

  it('shows asterisk on label when required in attrs', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { attrs: { required: true } },
    })
    expect(field.querySelector('label').textContent).toContain('*')
  })

  it('does not show asterisk when required is not set', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { attrs: { maxlength: '32' } },
    })
    expect(field.querySelector('label').textContent).not.toContain('*')
  })

  it('sets HTML required attribute on input', () => {
    var field = window.createField('wifi', {
      key: 'ssid', type: 'text', label: 'SSID',
      opts: { attrs: { required: true } },
    })
    expect(field.querySelector('input').getAttribute('required')).not.toBeNull()
  })

  it('shows asterisk on switch label when required', () => {
    var field = window.createField('wifi', {
      key: 'hidden', type: 'switch', label: 'Hidden',
      opts: { attrs: { required: true } },
    })
    expect(field.querySelector('label').textContent).toContain('*')
  })

  it('shows asterisk on radio legend when required', () => {
    var field = window.createField('gpio', {
      key: 'pull', type: 'radio', label: 'Pull',
      opts: { options: [['none', 'None']], attrs: { required: true } },
    })
    expect(field.querySelector('legend').textContent).toContain('*')
  })

  it('shows asterisk on select label when required', () => {
    var field = window.createField('wifi', {
      key: 'mode', type: 'select', label: 'Mode',
      opts: { options: [['a', 'A']], attrs: { required: true } },
    })
    expect(field.querySelector('label').textContent).toContain('*')
  })

  it('creates checkbox (input type=checkbox without role=switch)', () => {
    var field = window.createField('gpio', {
      key: 'confirm', type: 'checkbox', label: 'Confirm',
      opts: { value: null },
    })
    expect(field.tagName).toBe('DIV')
    expect(field.querySelector('label').getAttribute('for')).toBe('gpio.confirm')
    var input = field.querySelector('input')
    expect(input.type).toBe('checkbox')
    expect(input.hasAttribute('role')).toBe(false)
    expect(input.checked).toBe(false)
    expect(input.indeterminate).toBe(false)
    expect(input.id).toBe('gpio.confirm')
    expect(input.disabled).toBe(false)
  })

  it('sets helper text on checkbox as small after label', () => {
    var field = window.createField('gpio', {
      key: 'confirm', type: 'checkbox', label: 'Confirm',
      opts: { help: 'Make a choice' },
    })
    var small = field.querySelector('small')
    expect(small).not.toBeNull()
    expect(small.textContent).toBe('Make a choice')
    expect(small.id).toBe('gpio.confirm-helper')
    expect(field.querySelector('input').getAttribute('aria-describedby')).toBe('gpio.confirm-helper')
  })
})

describe('addHelperText', function () {
  it('creates small element with aria-describedby', function () {
    var container = document.createElement('div')
    var input = document.createElement('input')
    input.id = 'test.field'
    container.appendChild(input)
    window.addHelperText(container, input.id, 'Help text', input)
    var small = container.querySelector('small')
    expect(small).not.toBeNull()
    expect(small.id).toBe('test.field-helper')
    expect(small.textContent).toBe('Help text')
    expect(input.getAttribute('aria-describedby')).toBe('test.field-helper')
  })

  it('creates small without aria-describedby when describedEl is absent', function () {
    var container = document.createElement('div')
    window.addHelperText(container, 'radio.key', 'Radio help', null)
    var small = container.querySelector('small')
    expect(small).not.toBeNull()
    expect(small.id).toBe('radio.key-helper')
    expect(small.textContent).toBe('Radio help')
  })

  it('does nothing when text is empty', function () {
    var container = document.createElement('div')
    window.addHelperText(container, 'x.y', '', null)
    expect(container.querySelector('small')).toBeNull()
  })

  it('does nothing when text is undefined', function () {
    var container = document.createElement('div')
    window.addHelperText(container, 'x.y', undefined, null)
    expect(container.querySelector('small')).toBeNull()
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
      <input type="checkbox" name="gpio.confirm" />
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
      {
        id: 'gpio',
        fields: [
          { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: { value: true } },
        ],
      },
    ])
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('new-ssid')
    expect(document.querySelector('[name="wifi.mode"]').value).toBe('station')
    expect(document.querySelector('[name="wifi.hidden"]').checked).toBe(false)
    var confirmEl = document.querySelector('[name="gpio.confirm"]')
    expect(confirmEl.checked).toBe(true)
    expect(confirmEl.indeterminate).toBe(false)
  })

  it('sets checkbox to indeterminate when value is null', () => {
    window.populateFromComponents([
      {
        id: 'gpio',
        fields: [
          { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: { value: null } },
        ],
      },
    ])
    var el = document.querySelector('[name="gpio.confirm"]')
    expect(el.checked).toBe(false)
    expect(el.indeterminate).toBe(true)
  })

  it('sets checkbox to unchecked when value is false', () => {
    window.populateFromComponents([
      {
        id: 'gpio',
        fields: [
          { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: { value: false } },
        ],
      },
    ])
    var el = document.querySelector('[name="gpio.confirm"]')
    expect(el.checked).toBe(false)
    expect(el.indeterminate).toBe(false)
  })

  it('does not set indeterminate on switch', () => {
    var el = document.querySelector('[name="wifi.hidden"]')
    el.indeterminate = true
    window.populateFromComponents([
      {
        id: 'wifi',
        fields: [
          { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'x' } },
          { key: 'mode', type: 'select', label: 'Mode', opts: { value: 'station' } },
          { key: 'hidden', type: 'switch', label: 'Hidden', opts: { value: false } },
        ],
      },
    ])
    expect(el.checked).toBe(false)
    expect(el.indeterminate).toBe(false)
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
        fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { help: 'Network name' } }],
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
      gpio: { pin: ['number', 'Pin', { value: 5 }], led_color: ['color', 'LED Color', { value: '#ff9500' }] },
    }
    window.processSettings(data, false)
    expect(window.__test.components.length).toBe(2)
    expect(window.__test.components[0].id).toBe('wifi')
    expect(window.__test.components[1].id).toBe('gpio')
    var colorField = window.__test.components[1].fields.find(function (f) { return f.key === 'led_color' })
    expect(colorField).not.toBeUndefined()
    expect(colorField.type).toBe('color')
    expect(colorField.opts.value).toBe('#ff9500')
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

  it('uses group.label when present instead of labelFromKey', function () {
    var data = {
      wifi: { label: 'Wi-Fi', ssid: ['text', 'SSID', { value: 'MyNet' }] }
    }
    window.processSettings(data, false)
    expect(window.__test.components.length).toBe(1)
    expect(window.__test.components[0].label).toBe('Wi-Fi')
  })

  it('does not add label key as a field', function () {
    var data = {
      wifi: {
        label: 'Custom Label',
        ssid: ['text', 'SSID', { value: 'MyNet' }],
        channel: ['range', 'Channel', { value: 6 }]
      }
    }
    window.processSettings(data, false)
    expect(window.__test.components.length).toBe(1)
    var hasLabelField = window.__test.components[0].fields.some(function (f) { return f.key === 'label' })
    expect(hasLabelField).toBe(false)
    expect(window.__test.components[0].fields.length).toBe(2)
  })
})

describe('findField', function () {
  beforeEach(function () {
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'MyNet' } },
        { key: 'channel', type: 'range', label: 'Channel', opts: { value: 6 } },
      ]},
      { id: 'gpio', fields: [
        { key: 'pin', type: 'number', label: 'Pin', opts: { value: 2 } },
      ]},
    ]
  })

  it('returns the field object for a matching comp and key', function () {
    var field = window.findField('wifi', 'ssid')
    expect(field).not.toBeNull()
    expect(field.key).toBe('ssid')
    expect(field.type).toBe('text')
  })

  it('returns the field for a different component', function () {
    var field = window.findField('gpio', 'pin')
    expect(field).not.toBeNull()
    expect(field.key).toBe('pin')
    expect(field.opts.value).toBe(2)
  })

  it('returns null for unknown component ID', function () {
    expect(window.findField('nonexistent', 'ssid')).toBeNull()
  })

  it('returns null for unknown field key', function () {
    expect(window.findField('wifi', 'nonexistent')).toBeNull()
  })

  it('returns null for component with no fields', function () {
    window.__test.components = [{ id: 'empty' }]
    expect(window.findField('empty', 'x')).toBeNull()
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
    document.getElementById('config-form').removeAttribute('aria-busy')
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

describe('WS disconnect while in-flight', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="userChange" />'
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'serverVal' } },
      ]},
    ]
    window.__test.lastSent = { 'wifi.ssid': 'userChange' }
    window.__test.inFlight = { 'wifi.ssid': true }
    window.__test.dirty = false
    window.connectWS()
    window.__test.wsReady()
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
  })

  it('clears stale inFlight and re-sends pending change on reconnect', function () {
    // Server pushes settings with the same AV as before (our change was lost)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] },
      }),
    })
    // Field is re-sent so it's back in-flight
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('re-sends pending form value that differs from reconnected server AV', function () {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] },
      }),
    })
    expect(window.__test.wsSent).toEqual({
      action: 'apply',
      data: { wifi: { ssid: ['text', 'SSID', { value: 'userChange' }] } },
    })
  })

  it('does not re-send when form value matches reconnected server AV', function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="serverVal" />'
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] },
      }),
    })
    expect(window.__test.wsSent).toBeNull()
  })

  it('syncs lastSent after reconnect reconciliation', function () {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] },
      }),
    })
    expect(window.__test.lastSent['wifi.ssid']).toBe('userChange')
  })
})

describe('aria-busy lifecycle', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="hello" />'
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'hello' } },
      ]},
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    document.getElementById('config-form').setAttribute('aria-busy', 'true')
  })

  it('clears aria-busy after reconnect settings push (no changed fields)', function () {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'hello' }] },
      }),
    })
    expect(document.getElementById('config-form').hasAttribute('aria-busy')).toBe(false)
  })

  it('clears aria-busy after reconnect with stale inFlight', function () {
    window.__test.inFlight = { 'wifi.ssid': true }
    window.__test.lastSent = { 'wifi.ssid': 'valueMismatch' }
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'hello' }] },
      }),
    })
    expect(document.getElementById('config-form').hasAttribute('aria-busy')).toBe(false)
  })

  it('clears aria-busy after echo-matched reconnect', function () {
    window.__test.inFlight = { 'wifi.ssid': true }
    window.__test.lastSent = { 'wifi.ssid': 'hello' }
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'hello' }] },
      }),
    })
    expect(document.getElementById('config-form').hasAttribute('aria-busy')).toBe(false)
  })
})

describe('null-guard: syncLS and updateAV', function () {
  var origComponents;
  beforeEach(function () {
    origComponents = window.__test.components;
    window.__test.components = [
      { id: 'wifi', fields: null },
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
  })
  afterEach(function () {
    window.__test.components = origComponents;
  })

  it('syncLS does not throw when component has no fields', function () {
    expect(function () { window.syncLS() }).not.toThrow()
  })

  it('updateAV does not throw when component has no fields', function () {
    expect(function () {
      window.updateAV({ wifi: { ssid: ['text', 'SSID', { value: 'x' }] } })
    }).not.toThrow()
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

  it('radio helper text is outside fieldset inside the container div', () => {
    var field = window.createField('gpio', {
      key: 'pull', type: 'radio', label: 'Pull Resistor',
      opts: {
        options: [['none', 'None'], ['up', 'Up'], ['down', 'Down']],
        value: 'none',
        help: 'Select pull resistor',
      },
    })
    var fieldset = field.querySelector('fieldset')
    var small = field.querySelector('small')
    expect(small).not.toBeNull()
    expect(fieldset.contains(small)).toBe(false)
    expect(field.contains(small)).toBe(true)
  })
})

describe('echo path — single field match', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="newVal" />'
    window.__test.components = [{
      id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = { 'wifi.ssid': true }
    window.__test.lastSent['wifi.ssid'] = 'newVal'
  })

  it('echo match path keeps lastSent and reflects dirty flag', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: { ssid: ['text', 'SSID', { value: 'newVal' }] },
      }),
    })
    expect(window.__test.lastSent['wifi.ssid']).toBe('newVal')
    expect(window.__test.dirty).toBe(true)
    expect(window.__test.components[0].fields[0].opts.value).toBe('newVal')
  })
})

describe('echo path — partial match with multiple in-flight fields', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input name="wifi.ssid" value="DirtyTest" />',
      '<input name="wifi.password" value="secret" />',
    ].join('')
    window.__test.components = [{
      id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: '' } },
        { key: 'password', type: 'password', label: 'Password', opts: { value: '' } },
      ],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    window.__test.lastSent['wifi.ssid'] = 'DirtyTest'
    window.__test.inFlight['wifi.ssid'] = true
    window.__test.lastSent['wifi.password'] = 'secret'
    window.__test.inFlight['wifi.password'] = true
  })

  it('partial echo does not corrupt lastSent of other in-flight field', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: {
          ssid: ['text', 'SSID', { value: 'DirtyTest' }],
          password: ['password', 'Password', { value: '' }],
        },
      }),
    })
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
    expect(window.__test.inFlight['wifi.password']).toBe(true)
    expect(window.__test.lastSent['wifi.password']).toBe('secret')
    expect(window.__test.dirty).toBe(true)
  })

  it('second echo resolves after partial echo match', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: {
          ssid: ['text', 'SSID', { value: 'DirtyTest' }],
          password: ['password', 'Password', { value: '' }],
        },
      }),
    })
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: {
          ssid: ['text', 'SSID', { value: 'DirtyTest' }],
          password: ['password', 'Password', { value: 'secret' }],
        },
      }),
    })
    expect(window.__test.inFlight['wifi.password']).toBe(false)
    expect(window.__test.lastSent['wifi.password']).toBe('secret')
    expect(window.__test.dirty).toBe(true)
  })

  it('partial echo does not overwrite DOM for in-flight field', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: {
          ssid: ['text', 'SSID', { value: 'DirtyTest' }],
          password: ['password', 'Password', { value: '' }],
        },
      }),
    })
    expect(document.querySelector('[name="wifi.password"]').value).toBe('secret')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('DirtyTest')
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

  it('returns hex string for color input', () => {
    document.querySelector('#config-form').innerHTML =
      '<input type="color" name="gpio.led_color" value="#ff0000" />'
    expect(window.readFormValue(['gpio', 'led_color'])).toBe('#ff0000')
    document.querySelector('[name="gpio.led_color"]').value = '#00aa55'
    expect(window.readFormValue(['gpio', 'led_color'])).toBe('#00aa55')
  })

  it('returns undefined when element not found', () => {
    expect(window.readFormValue(['wifi', 'missing'])).toBeUndefined()
  })

  it('returns null for indeterminate checkbox', () => {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="gpio.confirm" />'
    var el = document.querySelector('[name="gpio.confirm"]')
    el.indeterminate = true
    expect(window.readFormValue(['gpio', 'confirm'])).toBe(null)
  })
})

describe('dirty flag survives dropped WS messages', () => {
  beforeEach(() => {
    document.getElementById('config-form').removeAttribute('aria-busy')
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

describe('settings push during visible prompt', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="myLocal" />'
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } },
      ]},
    ]
    window.__test.lastSent = { 'wifi.ssid': 'oldVal' }
    window.__test.inFlight = {}
    window.__test.dirty = false
    document.getElementById('server-changed').hidden = true
    document.getElementById('notif-load').hidden = true
    document.getElementById('notif-keep').hidden = true
    document.getElementById('notif-keep-local').hidden = true
    document.getElementById('notif-accept-server').hidden = true
  })

  it('does not overwrite visible conflict prompt with a new one', function () {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'externalVal' }] },
      }),
    })
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'thirdVal' }] },
      }),
    })
    expect(window.__test.components[0].fields[0].opts.value).toBe('thirdVal')
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)
  })

  it('does not overwrite visible external notification with a conflict prompt', function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="oldVal" />'
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'extVal' }] },
      }),
    })
    expect(document.getElementById('notif-load').hidden).toBe(false)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'thirdVal' }] },
      }),
    })
    expect(document.getElementById('notif-load').hidden).toBe(false)
    expect(document.getElementById('notif-keep').hidden).toBe(false)
    expect(document.getElementById('notif-keep-local').hidden).toBe(true)
    expect(document.getElementById('notif-accept-server').hidden).toBe(true)
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

describe('echo resolution with switch preserves dirty', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="gpio.enabled" checked />'
    window.__test.components = [{
      id: 'gpio', fields: [
        { key: 'enabled', type: 'switch', label: 'GPIO Enabled', opts: { value: false } },
      ],
    }]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    window.__test.lastSent['gpio.enabled'] = true
    window.__test.inFlight['gpio.enabled'] = true
    document.getElementById('server-changed').hidden = true
  })

  it('echo match with switch does not queue spurious change', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        gpio: { enabled: ['switch', 'GPIO Enabled', { value: true }] },
      }),
    })
    expect(window.__test.inFlight['gpio.enabled']).toBe(false)
    expect(window.__test.dirty).toBe(true)
    expect(window.__test.components[0].fields[0].opts.value).toBe(true)
  })
})

describe('status rendering', () => {
  var origStatus;

  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = ''
    document.getElementById('nav-list').innerHTML = ''
    window.__test.components = [
      { id: 'wifi', label: 'Wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'Net' } },
      ]},
    ]
    origStatus = window.__test.statusComponents
    window.__test.statusComponents = [
      { id: 'system', label: 'System', fields: [
        { key: 'uptime', type: 'text', label: 'Uptime', opts: { value: '1d 0h' } },
      ]},
    ]
  })

  afterEach(() => {
    window.__test.statusComponents = origStatus
  })

  it('renders status sections before settings sections', () => {
    window.renderForm()
    var details = document.querySelectorAll('#config-form details')
    expect(details.length).toBe(2)
    expect(details[0].id).toBe('system')
    expect(details[1].id).toBe('wifi')
  })

  it('status summary has secondary class', () => {
    window.renderForm()
    var summary = document.querySelector('#system summary')
    expect(summary.className).toBe('secondary')
    expect(document.querySelector('#wifi summary').className).toBe('')
  })

  it('status field is disabled', () => {
    window.renderForm()
    var input = document.querySelector('[name="system.uptime"]')
    expect(input.disabled).toBe(true)
  })

  it('settings field is not disabled', () => {
    window.renderForm()
    var input = document.querySelector('[name="wifi.ssid"]')
    expect(input.disabled).toBe(false)
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

describe('status message routing', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = ''
    document.getElementById('nav-list').innerHTML = ''
    document.getElementById('status-bar').textContent = ''
    window.__test.components = []
    window.__test.dirty = false
  })

  it('routes type:status message to processStatus', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({ type: 'status', data: { network: { signal: ['range', 'Signal', { value: '75' }] } } }),
    })
    expect(window.__test.statusComponents.length).toBe(1)
    expect(window.__test.statusComponents[0].id).toBe('network')
    expect(window.__test.statusComponents[0].fields[0].key).toBe('signal')
  })

  it('does not route status message to settings handling', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({ type: 'status', data: { network: { signal: ['range', 'Signal', { value: '75' }] } } }),
    })
    expect(window.__test.dirty).toBe(false)
    expect(window.__test.components.length).toBe(0)
  })

  it('routes type:settings messages correctly', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({ type: 'settings', _dirty: true, data: { wifi: { ssid: ['text', 'SSID', { value: 'Net' }] } } }),
    })
    expect(window.__test.components.length).toBeGreaterThan(0)
    expect(window.__test.dirty).toBe(true)
  })
})

describe('form validation', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input name="mqtt.client_id" value="" required minlength="3" maxlength="64" pattern="^[a-zA-Z0-9_-]+$" />',
      '<input name="mqtt.keepalive" value="60" type="number" min="1" max="65535" step="5" />',
      '<input name="notifications.sender" value="" type="email" required />',
    ].join('')
    window.__test.components = [{ id: 'mqtt', fields: [
      { key: 'client_id', type: 'text', label: 'Client ID', opts: {} },
      { key: 'keepalive', type: 'number', label: 'Keepalive', opts: {} },
    ]}, { id: 'notifications', fields: [
      { key: 'sender', type: 'email', label: 'Sender', opts: {} },
    ]}]
    window.__test.dirty = false
    window.setBaseline()
  })

  it('does not call reportValidity on blur (uses checkValidity instead)', () => {
    var input = document.querySelector('[name="mqtt.client_id"]')
    var reported = false
    var origReport = input.reportValidity
    input.reportValidity = function () { reported = true; return false }
    window.bindChangeListeners()
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(reported).toBe(false)
    input.reportValidity = origReport
  })

  it('does not send WS when field is invalid on blur', () => {
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.connectWS()
    window.__test.wsReady()
    var sendCalled = false
    var origSend = window.sendToServer
    window.sendToServer = function () { sendCalled = true }
    var input = document.querySelector('[name="mqtt.client_id"]')
    var origCheck = input.checkValidity
    input.checkValidity = function () { return false }
    window.bindChangeListeners()
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(sendCalled).toBe(false)
    window.sendToServer = origSend
    input.checkValidity = origCheck
  })

  it('sends WS when field becomes valid on blur', () => {
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
    window.connectWS()
    window.__test.wsReady()
    var input = document.querySelector('[name="mqtt.client_id"]')
    input.value = 'my-device'
    var origCheck = input.checkValidity
    input.checkValidity = function () { return true }
    window.bindChangeListeners()
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(window.__test.wsSent).toEqual({ action: 'apply', data: { mqtt: { client_id: ['text', 'Client ID', { value: 'my-device' }] } } })
    input.checkValidity = origCheck
  })

  it('hides save button when field violates minlength', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="mqtt.client_id"]')
    input.value = 'ab'
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('shows save button when field meets minlength', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="mqtt.client_id"]')
    input.value = 'abc'
    document.querySelector('[name="notifications.sender"]').value = 'dev@test.com'
    document.querySelector('[name="mqtt.keepalive"]').value = '61'
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
  })

  it('hides save button when field violates pattern', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="mqtt.client_id"]')
    input.value = 'invalid client!'
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('hides save button when field exceeds maxlength', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="mqtt.client_id"]')
    input.value = 'a'.repeat(65)
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('hides save button when field violates max constraint', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="mqtt.keepalive"]')
    input.value = '100000'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('hides save button when field violates step constraint', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="mqtt.keepalive"]')
    input.value = '62'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('hides save button when email field has invalid format', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    var input = document.querySelector('[name="notifications.sender"]')
    input.value = 'not-an-email'
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('shows save button when all fields are valid', () => {
    window.bindChangeListeners()
    window.__test.dirty = true
    document.querySelector('[name="mqtt.client_id"]').value = 'dev01'
    document.querySelector('[name="notifications.sender"]').value = 'dev@test.com'
    document.querySelector('[name="mqtt.keepalive"]').value = '61'
    document.querySelector('[name="mqtt.client_id"]').dispatchEvent(new Event('blur', { bubbles: true }))
    document.querySelector('[name="notifications.sender"]').dispatchEvent(new Event('blur', { bubbles: true }))
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
  })

  it('keeps details open when field is invalid on blur', () => {
    document.querySelector('#config-form').innerHTML = '<details open><input name="mqtt.client_id" value="" required minlength="3" /></details>'
    window.__test.components = [{ id: 'mqtt', fields: [{ key: 'client_id', type: 'text', label: 'Client ID', opts: {} }] }]
    window.__test.dirty = false
    window.bindChangeListeners()
    var input = document.querySelector('[name="mqtt.client_id"]')
    var details = input.closest('details')
    details.open = false
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(details.open).toBe(true)
  })

  it('updateUI skips checkValidity before first field interaction', () => {
    window.__test.formInteracted = false
    document.querySelector('#config-form').innerHTML = '<input name="mqtt.client_id" value="" required minlength="3" />'
    window.__test.components = [{ id: 'mqtt', fields: [{ key: 'client_id', type: 'text', label: 'Client ID', opts: {} }] }]
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
  })
})

describe('aria-invalid', function () {
  it('sets aria-invalid="false" on all named form fields after renderForm', function () {
    window.__test.components = [{ id: 'wifi', label: 'WiFi', fields: [
      { key: 'ssid', type: 'text', label: 'SSID', opts: {} }
    ]}]
    window.__test.statusComponents = []
    window.renderForm()
    var input = document.querySelector('[name="wifi.ssid"]')
    expect(input.getAttribute('aria-invalid')).toBe('false')
  })

  it('sets aria-invalid="true" on invalid field, "false" on valid field', function () {
    document.querySelector('#config-form').innerHTML = '<input name="mqtt.client_id" value="" required minlength="3" />'
    window.__test.components = [{ id: 'mqtt', fields: [
      { key: 'client_id', type: 'text', label: 'Client ID', opts: {} }
    ]}]
    window.__test.dirty = false
    window.setBaseline()
    window.bindChangeListeners()
    var input = document.querySelector('[name="mqtt.client_id"]')

    // Empty + required + minlength → invalid, aria-invalid should be "true"
    input.value = ''
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(input.getAttribute('aria-invalid')).toBe('true')

    // Fill with valid value → aria-invalid should become "false"
    input.value = 'my-device'
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    expect(input.getAttribute('aria-invalid')).toBe('false')
  })

  it('marks required-empty field as invalid on renderForm', function () {
    document.querySelector('#config-form').innerHTML = ''
    window.__test.components = [{ id: 'wifi', label: 'WiFi', fields: [
      { key: 'password', type: 'password', label: 'Password', opts: { attrs: { required: true }, value: '' } }
    ]}]
    window.__test.statusComponents = []
    window.renderForm()
    var input = document.querySelector('[name="wifi.password"]')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('opens details section on renderForm when it has aria-invalid child', function () {
    document.querySelector('#config-form').innerHTML = ''
    window.__test.components = [{ id: 'wifi', label: 'WiFi', fields: [
      { key: 'password', type: 'password', label: 'Password', opts: { attrs: { required: true }, value: '' } }
    ]}]
    window.__test.statusComponents = []
    window.renderForm()
    var details = document.getElementById('wifi')
        expect(details.open).toBe(true)
  })
})

describe('checkbox indeterminate validation', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = [
      '<input type="checkbox" name="notifications.confirm" required />',
    ].join('')
    window.__test.components = [{ id: 'notifications', fields: [
      { key: 'confirm', type: 'checkbox', label: 'Confirm Alerts', opts: { attrs: { required: true } } },
    ]}]
    window.__test.dirty = false
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.onWSSend = function () {}
    window.setBaseline()
    window.connectWS()
    window.__test.wsReady()
  })

  it('blocks send when indeterminate and required', function () {
    var el = document.querySelector('[name="notifications.confirm"]')
    el.indeterminate = true
    window.bindChangeListeners()
    el.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(window.__test.lastSent['notifications.confirm']).toBeUndefined()
  })

  it('allows send when indeterminate and not required', function () {
    document.querySelector('#config-form').innerHTML = [
      '<input type="checkbox" name="notifications.confirm" />',
    ].join('')
    window.__test.components = [{ id: 'notifications', fields: [
      { key: 'confirm', type: 'checkbox', label: 'Confirm Alerts', opts: {} },
    ]}]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.onWSSend = function () {}
    window.connectWS()
    window.__test.wsReady()
    var el = document.querySelector('[name="notifications.confirm"]')
    el.indeterminate = true
    window.bindChangeListeners()
    el.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el.getAttribute('aria-invalid')).toBe('false')
    expect(window.__test.lastSent['notifications.confirm']).toBe(null)
  })
})

describe('falsey values through echo matching', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML =
      '<input type="number" name="wifi.channel" value="0" />'
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'channel', type: 'number', label: 'Channel', opts: { value: 0 } },
      ]},
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
  })

  it('echo matches number 0 correctly', function () {
    window.__test.lastSent['wifi.channel'] = 0
    window.__test.inFlight['wifi.channel'] = true
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { channel: ['number', 'Channel', { value: 0 }] },
      }),
    })
    expect(window.__test.inFlight['wifi.channel']).toBe(false)
  })

  it('echo matches empty string correctly', function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="" />'
    window.__test.components[0].fields[0] =
      { key: 'ssid', type: 'text', label: 'SSID', opts: { value: '' } }
    window.__test.lastSent['wifi.ssid'] = ''
    window.__test.inFlight['wifi.ssid'] = true
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: '' }] },
      }),
    })
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
  })

  it('echo matches false boolean correctly', function () {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="gpio.enabled" />'
    window.__test.components[0].fields[0] =
      { key: 'enabled', type: 'switch', label: 'Enabled', opts: { value: false } }
    window.__test.lastSent['gpio.enabled'] = false
    window.__test.inFlight['gpio.enabled'] = true
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        gpio: { enabled: ['switch', 'Enabled', { value: false }] },
      }),
    })
    expect(window.__test.inFlight['gpio.enabled']).toBe(false)
  })

  it('echo matches null correctly', function () {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="notifications.confirm" />'
    var el = document.querySelector('[name="notifications.confirm"]')
    el.indeterminate = true
    window.__test.components[0].fields[0] =
      { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: { value: null } }
    window.__test.lastSent['notifications.confirm'] = null
    window.__test.inFlight['notifications.confirm'] = true
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        notifications: { confirm: ['checkbox', 'Confirm', { value: null }] },
      }),
    })
    expect(window.__test.inFlight['notifications.confirm']).toBe(false)
  })
})

describe('partial server update', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = [
      '<input name="wifi.ssid" value="Net" />',
      '<input name="wifi.password" value="" />',
      '<input name="gpio.pin" value="2" />',
    ].join('')
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'Net' } },
        { key: 'password', type: 'password', label: 'Password', opts: { value: '' } },
      ]},
      { id: 'gpio', fields: [
        { key: 'pin', type: 'number', label: 'Pin', opts: { value: 2 } },
      ]},
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    document.getElementById('server-changed').hidden = true
    document.getElementById('notif-load').hidden = true
    document.getElementById('notif-keep').hidden = true
    document.getElementById('notif-keep-local').hidden = true
    document.getElementById('notif-accept-server').hidden = true
  })

  it('partial update only changes specified fields', function () {
    // Server sends only wifi.ssid, not wifi.password or gpio.pin
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: true,
        wifi: { ssid: ['text', 'SSID', { value: 'NewNet' }] },
      }),
    })
    expect(window.__test.components[0].fields[0].opts.value).toBe('NewNet')
    expect(window.__test.components[0].fields[1].opts.value).toBe('')
    expect(window.__test.components[1].fields[0].opts.value).toBe(2)
  })
})

describe('rapid blur events across different fields', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = [
      '<input name="wifi.ssid" value="Net" />',
      '<input name="wifi.password" value="secret" />',
    ].join('')
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: '' } },
        { key: 'password', type: 'password', label: 'Password', opts: { value: '' } },
      ]},
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    window.connectWS()
    window.__test.wsReady()
    window.__test.sentMessages = []
    window.__test.onWSSend = function (data) {
      window.__test.sentMessages.push(JSON.parse(data))
    }
  })

  it('multiple fields can be in-flight simultaneously', function () {
    window.onUserInput('wifi.ssid', 'NewNet')
    window.onUserInput('wifi.password', 'p@ss')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
    expect(window.__test.inFlight['wifi.password']).toBe(true)
    expect(window.__test.sentMessages.length).toBe(2)
    expect(window.__test.sentMessages[0].data.wifi.ssid[2].value).toBe('NewNet')
    expect(window.__test.sentMessages[1].data.wifi.password[2].value).toBe('p@ss')
  })

  it('same field rapid blur does not send while in-flight', function () {
    window.onUserInput('wifi.ssid', 'val1')
    var count = window.__test.sentMessages.length
    window.onUserInput('wifi.ssid', 'val2')
    expect(window.__test.sentMessages.length).toBe(count)
  })
})
