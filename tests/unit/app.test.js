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
