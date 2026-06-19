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
      { id: 'wifi', fields: [['ssid', 'text'], ['mode', 'select'], ['hidden', 'switch'], ['channel', 'range']] },
    ]
  })

  it('returns current form values', () => {
    const data = window.serialize()
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
    const data = window.serialize()
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
      { id: 'wifi', fields: [['ssid', 'text'], ['channel', 'range']] },
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
      { id: 'wifi', fields: [['ssid', 'text']] },
    ]
    window.setBaseline()
  })

  it('disables buttons when no pending changes', () => {
    window.updateUI()
    expect(document.getElementById('btn-apply').disabled).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('enables buttons when changes exist and form is valid', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-apply').disabled).toBe(false)
  })

  it('updates pending count text', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('pending-count').textContent).toBe('1 pending change(s)')
  })
})

describe('createField', () => {
  it('creates text input with attributes', () => {
    const field = window.createField('wifi', ['ssid', 'text', 'SSID', {
      attrs: { maxlength: '32', placeholder: 'MyNetwork' },
      tooltip: 'WiFi network name',
    }])
    expect(field.tagName).toBe('LABEL')
    const input = field.querySelector('input')
    expect(input.type).toBe('text')
    expect(input.name).toBe('wifi.ssid')
    expect(input.maxLength).toBe(32)
    expect(input.placeholder).toBe('MyNetwork')
  })

  it('creates select with options', () => {
    const field = window.createField('wifi', ['mode', 'select', 'Mode', {
      options: [['station', 'Station'], ['ap', 'AP']],
      default: 'station',
    }])
    const select = field.querySelector('select')
    expect(select.options.length).toBe(2)
    expect(select.options[0].value).toBe('station')
    expect(select.options[1].value).toBe('ap')
    expect(select.value).toBe('station')
  })

  it('creates switch (checkbox with role)', () => {
    const field = window.createField('wifi', ['hidden', 'switch', 'Hidden', {
      attrs: { role: 'switch' },
      default: true,
    }])
    const input = field.querySelector('input')
    expect(input.type).toBe('checkbox')
    expect(input.role).toBe('switch')
    expect(input.checked).toBe(true)
  })

  it('creates range with output display', () => {
    const field = window.createField('wifi', ['channel', 'range', 'Channel', {
      attrs: { min: '1', max: '13', step: '1' },
      default: '6',
    }])
    expect(field.querySelector('input[type="range"]')).not.toBeNull()
    expect(field.querySelector('output')).not.toBeNull()
  })

  it('creates number input', () => {
    const field = window.createField('gpio', ['pin', 'number', 'Pin', {
      attrs: { min: '0', max: '39' },
      default: '2',
    }])
    const input = field.querySelector('input[type="number"]')
    expect(input.min).toBe('0')
    expect(input.max).toBe('39')
    expect(input.value).toBe('2')
  })

  it('creates radio group', () => {
    const field = window.createField('gpio', ['pull', 'radio', 'Pull', {
      options: [['none', 'None'], ['up', 'Up'], ['down', 'Down']],
      default: 'none',
    }])
    expect(field.tagName).toBe('FIELDSET')
    const radios = field.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    expect(radios[0].value).toBe('none')
    expect(radios[1].value).toBe('up')
    expect(radios[2].value).toBe('down')
  })

  it('sets tooltip attribute on label', () => {
    const field = window.createField('wifi', ['ssid', 'text', 'SSID', {
      tooltip: 'Network name',
    }])
    expect(field.getAttribute('data-tooltip')).toBe('Network name')
  })

  it('returns null for invalid field spec', () => {
    expect(window.createField('x', [])).toBeNull()
    expect(window.createField('x', ['k', 'unknown', 'L'])).toBeNull()
  })
})

describe('applyAttrs', () => {
  it('sets multiple attributes on an element', () => {
    const el = document.createElement('input')
    window.applyAttrs(el, { maxlength: '32', placeholder: 'Name', min: '0' })
    expect(el.getAttribute('maxlength')).toBe('32')
    expect(el.getAttribute('placeholder')).toBe('Name')
    expect(el.getAttribute('min')).toBe('0')
  })

  it('handles null/undefined attrs gracefully', () => {
    const el = document.createElement('input')
    expect(() => window.applyAttrs(el, null)).not.toThrow()
    expect(() => window.applyAttrs(el, undefined)).not.toThrow()
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

  it('sets form values from components data', () => {
    window.populateFromComponents([
      {
        id: 'wifi',
        fields: [
          ['ssid', 'text', 'SSID', { default: 'new-ssid' }],
          ['mode', 'select', 'Mode', { default: 'station' }],
          ['hidden', 'switch', 'Hidden', { default: false }],
        ],
      },
    ])
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('new-ssid')
    expect(document.querySelector('[name="wifi.mode"]').value).toBe('station')
    expect(document.querySelector('[name="wifi.hidden"]').checked).toBe(false)
  })

  it('handles empty fields gracefully', () => {
    expect(() => window.populateFromComponents([])).not.toThrow()
    expect(() => window.populateFromComponents([{ id: 'x' }])).not.toThrow()
  })
})
