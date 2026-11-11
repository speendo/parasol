import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
    window.__test.groups = [
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
    window.__test.groups[0].fields.push(
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
    window.__test.groups[0].fields[0] =
      { key: 'channel', type: 'number', label: 'Channel', opts: {} }
    var data = window.serialize()
    expect(data['wifi.channel']).toBe(7)
  })

  it('returns number for range input (not string)', function () {
    document.querySelector('#config-form').innerHTML =
      '<input type="range" name="wifi.power" value="50" />'
    window.__test.groups[0].fields[0] =
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
    window.__test.groups = [
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
    window.__test.groups = [
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

  it('reset hidden when not dirty and showReset is false', () => {
    window.__test.dirty = false
    window.__test.showReset = false
    window.updateUI()
    expect(document.getElementById('btn-reset').hidden).toBe(true)
  })

  it('reset visible when dirty and callback registered', () => {
    window.__test.dirty = true
    window.__test.showReset = true
    window.updateUI()
    expect(document.getElementById('btn-reset').hidden).toBe(false)
  })

  it('reset hidden when dirty but no callback registered', () => {
    window.__test.dirty = true
    window.__test.showReset = false
    window.updateUI()
    expect(document.getElementById('btn-reset').hidden).toBe(true)
  })

  it('reset hidden when clean even if showReset is true', () => {
    window.__test.dirty = false
    window.__test.showReset = true
    window.updateUI()
    expect(document.getElementById('btn-reset').hidden).toBe(true)
  })

  it('reset visible when clean only if alwaysShowSave', () => {
    window.__test.dirty = false
    window.__test.showReset = true
    document.querySelector('meta[name="parasol-always-show-save"]')
      .setAttribute('content', '1')
    window.updateUI()
    expect(document.getElementById('btn-reset').hidden).toBe(false)
    document.querySelector('meta[name="parasol-always-show-save"]')
      .setAttribute('content', '0')
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

  it('createField does not preset value on text inputs', function () {
    var field = window.createField('grp', {
      key: 'test', type: 'text', label: 'Test', opts: { value: 'hello' },
    });
    var input = field.querySelector('input');
    expect(input.value).toBe('');
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
    expect(input.checked).toBe(false)
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
    expect(input.value).toBe('')
    expect(input.id).toBe('gpio.pin')
  })

  it('creates color input', () => {
    var field = window.createField('gpio', {
      key: 'led_color', type: 'color', label: 'LED Color',
      opts: { value: '#ff9500', help: 'RGB LED color' },
    })
    expect(field.querySelector('label').getAttribute('for')).toBe('gpio.led_color')
    var input = field.querySelector('input[type="color"]')
    expect(input.value).toBe('#000000')
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

function fakeFile(name, type, size) {
  var f = new File(['x'], name, { type: type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function selectFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
}

describe('createField: file', () => {
  it('renders a file input, Upload button, current label, help, accept, attrs', () => {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { value: 'beep.mp3', accept: '.mp3,audio/*', max_size: 1024,
              help: 'MP3, up to 1 KiB', attrs: { title: 'Clip' } },
    })
    var input = field.querySelector('input[type=file]')
    expect(input.name).toBe('audio.clip')
    expect(input.id).toBe('audio.clip')
    expect(input.getAttribute('accept')).toBe('.mp3,audio/*')
    expect(input.title).toBe('Clip')
    expect(field.querySelector('#audio\\.clip-upload').textContent).toBe('Upload')
    expect(field.querySelector('#audio\\.clip-upload').disabled).toBe(true)
    expect(field.querySelector('#audio\\.clip-current').textContent).toContain('beep.mp3')
    expect(field.querySelector('#audio\\.clip-helper').textContent).toContain('MP3')
    expect(field.querySelector('progress').hidden).toBe(true)
    expect(field.querySelector('#audio\\.clip-cancel').hidden).toBe(true)
  })

  it('shows "No file" when value is missing', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip', opts: {},
    })
    expect(field.querySelector('#audio\\.clip-current').textContent).toBe('No file')
  })

  it('renders the progress element at zero and hidden by default', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip', opts: {},
    })
    var progress = field.querySelector('#audio\\.clip-progress')
    expect(progress.max).toBe(100)
    expect(progress.value).toBe(0)
    expect(progress.hidden).toBe(true)
  })

  it('enables Upload for a valid selected file', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { accept: '.bin', max_size: 100 },
    })
    var input = field.querySelector('input[type=file]')
    selectFile(input, fakeFile('fw.bin', 'application/octet-stream', 10))
    expect(field.querySelector('#audio\\.clip-upload').disabled).toBe(false)
    expect(field.querySelector('#audio\\.clip-msg').textContent).toBe('')
  })

  it('shows the reason inline and keeps Upload disabled for an invalid file', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { accept: '.bin', max_size: 100 },
    })
    var input = field.querySelector('input[type=file]')
    selectFile(input, fakeFile('fw.bin', 'application/octet-stream', 200))
    expect(field.querySelector('#audio\\.clip-upload').disabled).toBe(true)
    expect(field.querySelector('#audio\\.clip-msg').textContent).toContain('too large')
  })

  it('disables Upload and clears the message when the selection is cleared', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { accept: '.bin', max_size: 100 },
    })
    var input = field.querySelector('input[type=file]')
    selectFile(input, fakeFile('fw.bin', 'application/octet-stream', 10))
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    input.dispatchEvent(new Event('change'))
    expect(field.querySelector('#audio\\.clip-upload').disabled).toBe(true)
    expect(field.querySelector('#audio\\.clip-msg').textContent).toBe('')
  })

  it('follows existing field conventions and adds no new class names', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { value: 'beep.mp3', accept: '.mp3', help: 'MP3' },
    })
    expect(field.tagName).toBe('DIV')
    var input = field.querySelector('input[type=file]')
    expect(field.querySelector('label').getAttribute('for')).toBe(input.id)
    var row = field.querySelector('[role="group"]')
    expect(row).not.toBeNull()
    expect(row.contains(input)).toBe(true)
    expect(row.contains(field.querySelector('#audio\\.clip-upload'))).toBe(true)
    expect(field.querySelector('#audio\\.clip-msg').getAttribute('role')).toBe('status')
    expect(field.querySelector('#audio\\.clip-helper').id).toBe('audio.clip-helper')

    var custom = []
    var els = field.querySelectorAll('[class]')
    for (var i = 0; i < els.length; i++) {
      var names = els[i].className.split(/\s+/)
      for (var j = 0; j < names.length; j++) {
        if (names[j].indexOf('file-') === 0) custom.push(names[j])
      }
    }
    expect(custom.sort()).toEqual(['file-msg', 'file-status'])
    expect(field.querySelectorAll('style, link').length).toBe(0)
  })
})

describe('acceptsFile', function () {
  it('matches extensions case-insensitively', function () {
    expect(window.__test.acceptsFile(fakeFile('FW.BIN', '', 10), '.bin')).toBe(true)
  })

  it('matches a MIME wildcard', function () {
    expect(window.__test.acceptsFile(fakeFile('beep.mp3', 'audio/mpeg', 10), 'audio/*')).toBe(true)
  })

  it('matches an exact MIME type', function () {
    expect(window.__test.acceptsFile(fakeFile('a.png', 'image/png', 10), 'image/png')).toBe(true)
  })

  it('accepts any file when accept is empty or */*', function () {
    expect(window.__test.acceptsFile(fakeFile('a.txt', 'text/plain', 10), '')).toBe(true)
    expect(window.__test.acceptsFile(fakeFile('a.txt', 'text/plain', 10), '*/*')).toBe(true)
  })

  it('rejects a wrong extension', function () {
    expect(window.__test.acceptsFile(fakeFile('a.txt', 'text/plain', 10), '.bin')).toBe(false)
  })

  it('rejects a wrong MIME type', function () {
    expect(window.__test.acceptsFile(fakeFile('a.png', 'image/png', 10), 'audio/*,image/jpeg')).toBe(false)
  })

  it('matches any entry in a comma-separated list', function () {
    expect(window.__test.acceptsFile(fakeFile('a.mp3', 'audio/mpeg', 10), '.bin, audio/*')).toBe(true)
  })
})

describe('checkFile', function () {
  var opts = { accept: '.bin', max_size: 100 }

  it('rejects an empty file', function () {
    expect(window.__test.checkFile(fakeFile('a.bin', 'application/octet-stream', 0), opts)).toBe('Empty file')
  })

  it('rejects a file over max_size', function () {
    expect(window.__test.checkFile(fakeFile('a.bin', 'application/octet-stream', 101), opts)).toBe('File too large')
  })

  it('rejects a file of the wrong type', function () {
    expect(window.__test.checkFile(fakeFile('a.txt', 'text/plain', 10), opts)).toBe('File type not allowed')
  })

  it('returns an empty string for a valid file', function () {
    expect(window.__test.checkFile(fakeFile('a.bin', 'application/octet-stream', 100), opts)).toBe('')
  })

  it('allows any size when max_size is unset', function () {
    expect(window.__test.checkFile(fakeFile('a.bin', 'application/octet-stream', 999999), { accept: '.bin' })).toBe('')
  })
})

describe('populateFromGroups: file', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = ''
  })

  it('updates the current label instead of assigning input.value', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip', opts: { value: 'old.mp3' },
    })
    document.querySelector('#config-form').appendChild(field)
    expect(function () {
      window.populateFromGroups([{
        id: 'audio',
        fields: [{ key: 'clip', type: 'file', label: 'Clip', opts: { value: 'new.mp3' } }],
      }])
    }).not.toThrow()
    expect(document.getElementById('audio.clip-current').textContent).toContain('new.mp3')
    expect(field.querySelector('input[type=file]').value).toBe('')
  })

  it('renders "No file" when the pushed value is null', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip', opts: { value: 'old.mp3' },
    })
    document.querySelector('#config-form').appendChild(field)
    window.populateFromGroups([{
      id: 'audio',
      fields: [{ key: 'clip', type: 'file', label: 'Clip', opts: { value: null } }],
    }])
    expect(document.getElementById('audio.clip-current').textContent).toBe('No file')
  })
})

describe('file field change handling', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = ''
    window.__test.formInteracted = false
  })

  it('does not treat a file change as a form value edit', function () {
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip', opts: { accept: '.bin' },
    })
    document.querySelector('#config-form').appendChild(field)
    window.bindChangeListeners()
    selectFile(field.querySelector('input[type=file]'), fakeFile('a.bin', 'application/octet-stream', 10))
    expect(window.__test.formInteracted).toBe(false)
    expect(field.querySelector('#audio\\.clip-upload').disabled).toBe(false)
  })
})

describe('upload flow', function () {
  var xhr, xhrs, file, field
  var realFetch = window.fetch
  var realXHR = window.XMLHttpRequest

  function makeField() {
    document.querySelector('#config-form').innerHTML = ''
    window.__test.fileFields = {}
    field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { accept: '.mp3,audio/*', max_size: 1000 },
    })
    document.querySelector('#config-form').appendChild(field)
    file = fakeFile('beep.mp3', 'audio/mpeg', 100)
    selectFile(field.querySelector('input[type=file]'), file)
  }

  function upload() {
    field.querySelector('#audio\\.clip-upload').click()
  }

  function msg() {
    return field.querySelector('#audio\\.clip-msg').textContent
  }

  function progress() {
    return field.querySelector('#audio\\.clip-progress')
  }

  function cancelBtn() {
    return field.querySelector('#audio\\.clip-cancel')
  }

  async function flush() {
    for (var i = 0; i < 5; i++) await Promise.resolve()
  }

  beforeEach(function () {
    window.__test.localUploading = false
    window.__test.serverUploading = false
    window.__test.fileFields = {}
    document.querySelector('#config-form').innerHTML = ''
    xhr = undefined
    xhrs = 0
    window.XMLHttpRequest = function () {
      xhrs++
      xhr = this
      this.upload = {}
      this.open = vi.fn()
      this.setRequestHeader = vi.fn()
      this.send = vi.fn()
      this.abort = vi.fn(function () { if (xhr.onabort) xhr.onabort() })
    }
    window.fetch = vi.fn(function () {
      return Promise.resolve({ ok: true, text: function () { return Promise.resolve('OK') } })
    })
  })

  afterEach(function () {
    window.fetch = realFetch
    window.XMLHttpRequest = realXHR
    window.__test.localUploading = false
    window.__test.serverUploading = false
  })

  it('posts preflight metadata, then PUTs the file', async function () {
    makeField()
    upload()
    await flush()
    expect(window.fetch).toHaveBeenCalledTimes(1)
    var args = window.fetch.mock.calls[0]
    expect(args[0]).toBe('/api/upload/audio/clip')
    expect(args[1].method).toBe('POST')
    expect(JSON.parse(args[1].body)).toEqual({ name: 'beep.mp3', size: 100, type: 'audio/mpeg' })
    expect(xhr.open).toHaveBeenCalledWith('PUT', '/api/upload/audio/clip?name=beep.mp3&type=audio%2Fmpeg')
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream')
    expect(xhr.send).toHaveBeenCalledWith(file)
    expect(window.__test.localUploading).toBe(true)
  })

  it('shows the preflight response text and skips the PUT on failure', async function () {
    window.fetch = vi.fn(function () {
      return Promise.resolve({ ok: false, status: 413, text: function () { return Promise.resolve('File too large') } })
    })
    makeField()
    upload()
    await flush()
    expect(msg()).toBe('File too large')
    expect(xhrs).toBe(0)
    expect(window.__test.localUploading).toBe(false)
    expect(progress().hidden).toBe(true)
  })

  it('shows Upload failed when the preflight request rejects', async function () {
    window.fetch = vi.fn(function () { return Promise.reject(new Error('Network error')) })
    makeField()
    upload()
    await flush()
    expect(msg()).toBe('Upload failed')
    expect(window.__test.localUploading).toBe(false)
  })

  it('updates progress from upload.onprogress while visible', async function () {
    makeField()
    upload()
    await flush()
    expect(progress().hidden).toBe(false)
    expect(cancelBtn().hidden).toBe(false)
    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 })
    expect(progress().value).toBe(50)
  })

  it('shows Uploaded and clears the upload state on 2xx', async function () {
    makeField()
    upload()
    await flush()
    xhr.status = 200
    xhr.onload()
    expect(msg()).toBe('Uploaded')
    expect(window.__test.localUploading).toBe(false)
    expect(progress().hidden).toBe(true)
    expect(cancelBtn().hidden).toBe(true)
  })

  it('shows the response text and clears the lock on a non-2xx', async function () {
    makeField()
    upload()
    await flush()
    xhr.status = 415
    xhr.responseText = 'File type not allowed'
    xhr.onload()
    expect(msg()).toBe('File type not allowed')
    expect(window.__test.localUploading).toBe(false)
  })

  it('shows Upload failed on a transport error', async function () {
    makeField()
    upload()
    await flush()
    xhr.onerror()
    expect(msg()).toBe('Upload failed')
    expect(window.__test.localUploading).toBe(false)
  })

  it('shows Device restarting... when the device vanishes at 100%', async function () {
    makeField()
    upload()
    await flush()
    progress().value = 100
    xhr.onerror()
    expect(msg()).toBe('Device restarting...')
    expect(window.__test.localUploading).toBe(false)
  })

  it('aborts and shows Upload cancelled when Cancel is clicked', async function () {
    makeField()
    upload()
    await flush()
    cancelBtn().click()
    expect(xhr.abort).toHaveBeenCalled()
    expect(msg()).toBe('Upload cancelled')
    expect(window.__test.localUploading).toBe(false)
    expect(progress().hidden).toBe(true)
    expect(cancelBtn().hidden).toBe(true)
  })
})

describe('beforeunload during upload', function () {
  var sock
  var realWS = window.WebSocket

  beforeEach(function () {
    window.__test.localUploading = false
    window.__test.serverUploading = false
    sock = { readyState: 1, close: vi.fn() }
    window.WebSocket = function () { return sock }
  })

  afterEach(function () {
    window.WebSocket = realWS
    window.__test.localUploading = false
    window.__test.serverUploading = false
  })

  it('warns while a local upload is active', function () {
    window.__test.localUploading = true
    window.connectWS()
    var e = { preventDefault: vi.fn(), returnValue: '' }
    window.__test.onBeforeUnload(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.returnValue).toBe('')
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('warns while the server reports an upload', function () {
    window.__test.serverUploading = true
    window.connectWS()
    var e = { preventDefault: vi.fn(), returnValue: '' }
    window.__test.onBeforeUnload(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('disconnects the WebSocket when idle', function () {
    window.connectWS()
    var e = { preventDefault: vi.fn(), returnValue: '' }
    window.__test.onBeforeUnload(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(sock.close).toHaveBeenCalled()
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

describe('populateFromGroups', () => {
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

  it('sets form values from groups data using opts.value', () => {
    window.populateFromGroups([
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
    window.populateFromGroups([
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
    window.populateFromGroups([
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
    window.populateFromGroups([
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
    expect(function () { window.populateFromGroups([]) }).not.toThrow()
    expect(function () { window.populateFromGroups([{ id: 'x' }]) }).not.toThrow()
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
    window.__test.groups = [
      { id: 'wifi', label: 'Wifi' },
      { id: 'gpio', label: 'Gpio' },
    ]
    window.__test.statusGroups = [
      { id: 'system', label: 'System' },
    ]
  })

  it('renders nav links for each group (status first, no secondary class)', () => {
    window.renderNav()
    var links = document.querySelectorAll('#nav-list a')
    expect(links.length).toBe(3)
    expect(links[0].textContent).toBe('System')
    expect(links[0].getAttribute('href')).toBe('#system')
    expect(links[0].hasAttribute('class')).toBe(false)
    expect(links[1].textContent).toBe('Wifi')
    expect(links[2].textContent).toBe('Gpio')
  })

  it('deduplicates nav links when status and settings share an ID', () => {
    window.__test.statusGroups = [{ id: 'wifi', label: 'Wifi Status' }]
    window.__test.groups = [{ id: 'wifi', label: 'Wifi Settings' }]
    window.renderNav()
    var links = document.querySelectorAll('#nav-list a')
    expect(links.length).toBe(1)
    expect(links[0].textContent).toBe('Wifi Status')
  })
})

describe('renderForm', () => {
  beforeEach(() => {
    document.getElementById('config-form').innerHTML = ''
    window.__test.groups = [
      {
        id: 'wifi',
        label: 'Wifi',
        fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { help: 'Network name' } }],
      },
      {
        id: 'system',
        label: 'System',
        fields: [{ key: 'uptime', type: 'text', label: 'Uptime' }],
      },
    ]
    window.__test.statusGroups = []
  })

  it('renders accordion details for each group', () => {
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

  it('merges status and settings group with same ID', () => {
    window.__test.statusGroups = [
      {
        id: 'system',
        label: 'System Status',
        fields: [{ key: 'uptime', type: 'text', label: 'Uptime', opts: { value: '42h' } }],
      },
    ]
    window.renderForm()
    var details = document.querySelectorAll('#config-form details')
    expect(details.length).toBe(2)
    var sysDetails = document.getElementById('system')
    expect(sysDetails.querySelector('summary').textContent).toBe('System Status')
    var sysFields = sysDetails.querySelectorAll('input')
    expect(sysFields.length).toBe(2)
    expect(sysFields[0].disabled).toBe(true)
    expect(sysFields[1].disabled).toBe(false)
  })

  it('status fields are disabled, settings fields are enabled', () => {
    window.__test.statusGroups = [
      {
        id: 'system',
        label: 'System',
        fields: [{ key: 'uptime', type: 'text', label: 'Uptime', opts: { value: '42h' } }],
      },
    ]
    window.renderForm()
    var statusField = document.querySelector('[name="st-system.uptime"]')
    expect(statusField).not.toBeNull()
    expect(statusField.disabled).toBe(true)
  })

  it('status summary has secondary class', () => {
    window.__test.statusGroups = [
      {
        id: 'network',
        label: 'Network',
        fields: [{ key: 'ip', type: 'text', label: 'IP' }],
      },
    ]
    window.__test.groups = []
    window.renderForm()
    var summary = document.querySelector('#network summary')
    expect(summary).not.toBeNull()
    expect(summary.className).toContain('secondary')
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
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID' }] }]
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
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'new' } }] }]
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
    window.__test.groups = []
  })

  it('builds groups from settings data', () => {
    var data = {
      wifi: { ssid: ['text', 'SSID', { value: 'MyNet' }] },
      gpio: { pin: ['number', 'Pin', { value: 5 }], led_color: ['color', 'LED Color', { value: '#ff9500' }] },
    }
    window.processSettings(data, false)
    expect(window.__test.groups.length).toBe(2)
    expect(window.__test.groups[0].id).toBe('wifi')
    expect(window.__test.groups[1].id).toBe('gpio')
    var colorField = window.__test.groups[1].fields.find(function (f) { return f.key === 'led_color' })
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
    expect(window.__test.groups.length).toBe(1)
    expect(window.__test.groups[0].label).toBe('Wi-Fi')
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
    expect(window.__test.groups.length).toBe(1)
    var hasLabelField = window.__test.groups[0].fields.some(function (f) { return f.key === 'label' })
    expect(hasLabelField).toBe(false)
    expect(window.__test.groups[0].fields.length).toBe(2)
  })

  it('sets showReset to true when _show_reset: true', function () {
    window.__test.showReset = false;
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _dirty: false,
      _show_reset: true,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } }
    })});
    expect(window.__test.showReset).toBe(true);
  });

  it('sets showReset to false when _show_reset: false', function () {
    window.__test.showReset = true;
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _dirty: false,
      _show_reset: false,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } }
    })});
    expect(window.__test.showReset).toBe(false);
  });

  it('reset button visible when dirty and callback registered', function () {
    var btn = document.getElementById('btn-reset');
    // clean + no showReset → hidden
    window.__test.dirty = false;
    window.__test.showReset = false;
    window.updateUI();
    expect(btn.hidden).toBe(true);

    // dirty without callback → still hidden (no reset endpoint)
    window.__test.dirty = true;
    window.updateUI();
    expect(btn.hidden).toBe(true);

    // dirty + callback → visible
    window.__test.showReset = true;
    window.updateUI();
    expect(btn.hidden).toBe(false);

    // clean + showReset but no alwaysShowSave → still hidden
    window.__test.dirty = false;
    window.__test.showReset = true;
    window.updateUI();
    expect(btn.hidden).toBe(true);
  });
})

describe('_show_reset propagation through WS branches', function () {
  it('_show_reset propagates through echo match path', function () {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="sentVal" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    window.__test.lastSent = { 'wifi.ssid': 'sentVal' };
    window.__test.inFlight = { 'wifi.ssid': true };
    window.__test.dirty = false;
    window.__test.showReset = false;

    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      _show_reset: true,
      wifi: { ssid: ['text', 'SSID', { value: 'sentVal' }] }
    })});
    expect(window.__test.showReset).toBe(true);
  });

  it('_show_reset propagates through stale inFlight path', function () {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    window.__test.lastSent = { 'wifi.ssid': 'old-val' };
    window.__test.inFlight = { 'wifi.ssid': true };
    window.__test.dirty = false;
    window.__test.showReset = false;
    document.getElementById('config-form').setAttribute('aria-busy', 'true');

    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      _show_reset: true,
      wifi: { ssid: ['text', 'SSID', { value: 'differentVal' }] }
    })});
    expect(window.__test.showReset).toBe(true);
  });

  it('_show_reset propagates through conflict/re-prompt path', function () {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="form-local" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    window.__test.lastSent = {};
    window.__test.inFlight = {};
    window.__test.dirty = false;
    window.__test.showReset = false;

    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      _show_reset: true,
      wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] }
    })});
    expect(window.__test.showReset).toBe(true);
  });
})

describe('showReboot state', function () {
  it('sets showReboot to true when _show_reboot: true', function () {
    window.__test.showReboot = false;
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _dirty: false,
      _show_reboot: true,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } }
    })});
    expect(window.__test.showReboot).toBe(true);
  });

  it('sets showReboot to false when _show_reboot: false', function () {
    window.__test.showReboot = true;
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _dirty: false,
      _show_reboot: false,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } }
    })});
    expect(window.__test.showReboot).toBe(false);
  });

  it('showReboot unchanged when _show_reboot is missing', function () {
    window.__test.showReboot = true;
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _dirty: false,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } }
    })});
    expect(window.__test.showReboot).toBe(true);
  });
});

describe('renderNav device menu', function () {
  it('builds Reboot into #nav-actions when showReboot is true', function () {
    window.__test.showReboot = true;
    window.__test.groups = [];
    window.__test.statusGroups = [];
    window.renderNav();
    expect(document.getElementById('nav-system')).toBeNull();
    expect(document.getElementById('nav-actions').hasAttribute('hidden')).toBe(false);
    var rebootLink = document.getElementById('nav-reboot');
    expect(rebootLink).not.toBeNull();
    expect(rebootLink.textContent).toBe('Reboot');
    expect(document.getElementById('nav-actions').contains(rebootLink)).toBe(true);
  });

  it('hides #nav-actions and removes Reboot when showReboot is false', function () {
    window.__test.groups = [];
    window.__test.statusGroups = [];
    window.__test.showReboot = true;
    window.renderNav();
    expect(document.getElementById('nav-reboot')).not.toBeNull();
    window.__test.showReboot = false;
    window.renderNav();
    expect(document.getElementById('nav-reboot')).toBeNull();
    expect(document.getElementById('nav-actions').hasAttribute('hidden')).toBe(true);
  });
});

describe('processSettings clears resetInProgress', function () {
  it('clears resetInProgress and aria-busy', function () {
    document.getElementById('config-form').setAttribute('aria-busy', 'true');
    window.__test.resetInProgress = true;
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: 'Net' }] } }, false);
    expect(window.__test.resetInProgress).toBe(false);
    expect(document.getElementById('config-form').hasAttribute('aria-busy')).toBe(false);
  });

  it('does nothing when resetInProgress is false', function () {
    window.__test.resetInProgress = false;
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: 'Net' }] } }, false);
    expect(window.__test.resetInProgress).toBe(false);
  });
});

describe('_show_reboot propagation through WS branches', function () {
  it('_show_reboot propagates through echo match path', function () {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="sentVal" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    window.__test.lastSent = { 'wifi.ssid': 'sentVal' };
    window.__test.inFlight = { 'wifi.ssid': true };
    window.__test.showReboot = false;

    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      _show_reboot: true,
      wifi: { ssid: ['text', 'SSID', { value: 'sentVal' }] }
    })});
    expect(window.__test.showReboot).toBe(true);
  });

  it('_show_reboot propagates through stale inFlight path', function () {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    window.__test.lastSent = { 'wifi.ssid': 'old-val' };
    window.__test.inFlight = { 'wifi.ssid': true };
    window.__test.showReboot = false;
    document.getElementById('config-form').setAttribute('aria-busy', 'true');

    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      _show_reboot: true,
      wifi: { ssid: ['text', 'SSID', { value: 'differentVal' }] }
    })});
    expect(window.__test.showReboot).toBe(true);
  });

  it('_show_reboot propagates through conflict/re-prompt path', function () {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="form-local" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    window.__test.lastSent = {};
    window.__test.inFlight = {};
    window.__test.showReboot = false;

    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      _show_reboot: true,
      wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] }
    })});
    expect(window.__test.showReboot).toBe(true);
  });
});

describe('notif-keep sends each field via WS instead of direct AV mutation', function () {
  it('notif-keep click sends fields as WS apply, keeps AV shadow unchanged', function () {
    var sent = {};
    var originalValues = {};
    window.__test.onWSSend = function (data) {
      var msg = JSON.parse(data);
      if (msg.action === 'apply') {
        Object.assign(sent, msg.data);
      }
    };
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />';
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldVal' } }] }];
    for (var ci = 0; ci < window.__test.groups.length; ci++) {
      var grp = window.__test.groups[ci];
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        originalValues[grp.id + '.' + field.key] = field.opts.value;
      }
    }
    window.connectWS();
    window.__test.wsReady();
    window.wireButtons();
    document.getElementById('notif-keep').click();
    expect(Object.keys(sent).length).toBeGreaterThan(0);
    for (var ci2 = 0; ci2 < window.__test.groups.length; ci2++) {
      var grp2 = window.__test.groups[ci2];
      for (var fi2 = 0; fi2 < grp2.fields.length; fi2++) {
        var field2 = grp2.fields[fi2];
        expect(field2.opts.value).toBe(originalValues[grp2.id + '.' + field2.key]);
      }
    }
    // Clean up residual state so subsequent tests are not affected
    window.__test.groups = [];
    window.__test.lastSent = {};
    window.__test.inFlight = {};
    delete window.__test.onWSSend;
  });
})

describe('findField', function () {
  beforeEach(function () {
    window.__test.groups = [
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

  it('returns the field for a different group', function () {
    var field = window.findField('gpio', 'pin')
    expect(field).not.toBeNull()
    expect(field.key).toBe('pin')
    expect(field.opts.value).toBe(2)
  })

  it('returns null for unknown group ID', function () {
    expect(window.findField('nonexistent', 'ssid')).toBeNull()
  })

  it('returns null for unknown field key', function () {
    expect(window.findField('wifi', 'nonexistent')).toBeNull()
  })

  it('returns null for group with no fields', function () {
    window.__test.groups = [{ id: 'empty' }]
    expect(window.findField('empty', 'x')).toBeNull()
  })
})

describe('buildPatch', () => {
  beforeEach(() => {
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: {} }] }]
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
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID' }] }]
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

  it('shows aria-busy on Save while the POST is in flight', async () => {
    window.__test.dirty = true
    let resolvePost
    window.fetch = () => new Promise((r) => { resolvePost = r })
    window.handleSaveApply()
    expect(document.getElementById('btn-save-apply').getAttribute('aria-busy')).toBe('true')
    resolvePost({ ok: true, json: () => Promise.resolve({}) })
    await new Promise((r) => setTimeout(r, 0))
    expect(document.getElementById('btn-save-apply').getAttribute('aria-busy')).toBe(null)
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
    expect(window.__test.wsSent).toEqual({ action: 'apply', i: 1, data: { wifi: { ssid: ['text', 'SSID', { value: 'NewNet' }] } } })
  })

  it('sets lastSent and inFlight after sending', () => {
    window.__test.inFlight = {}
    window.__test.lastSent = {}
    window.onUserInput('wifi.ssid', 'NewNet')
    expect(window.__test.lastSent['wifi.ssid']).toBe('NewNet')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
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
    window.__test.groups = [
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
    window.__test.groups = []
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
    expect(window.__test.groups[0].fields[0].opts.value).toBe('hello')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('Case 3: shows external notification when server pushes new value while idle', () => {
    setupCase('oldVal', 'oldVal', 'oldVal', false)
    window.__test.receiveWSMessage({ data: serverPush('newServerVal') })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('newServerVal')
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
    expect(window.__test.groups[0].fields[0].opts.value).toBe('match')
    expect(window.__test.lastSent['wifi.ssid']).toBe('match')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('Case 5: shows conflict prompt when local and server both changed', () => {
    setupCase('myLocal', 'oldVal', 'oldVal', false)
    window.__test.receiveWSMessage({ data: serverPush('serverChanged') })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('serverChanged')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('myLocal')
    expect(document.getElementById('server-changed').hidden).toBe(false)
    expect(document.getElementById('notif-load').hidden).toBe(true)
    expect(document.getElementById('notif-keep').hidden).toBe(true)
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)
    expect(document.getElementById('notif-accept-server').hidden).toBe(false)
  })

  it('Case 8: ignores packet when inFlight and no echo match', () => {
    setupCase('local', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('unrelatedExternal') })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('oldVal')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('Case 9: ignores packet while inFlight even if user reverted (FV == oldAV)', () => {
    setupCase('oldVal', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('someExternal') })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('oldVal')
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('Case 10: ignores packet while inFlight even with conflicting local change', () => {
    setupCase('userChange', 'oldVal', 'sentVal', true)
    window.__test.receiveWSMessage({ data: serverPush('yetAnotherExt') })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('oldVal')
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
      // Drop the reconnect timer each attempt so no stray connectWS() fires
      // after this test (real timers are in use here).
      window.disconnectWS()
    }
    expect(document.getElementById('status-bar').textContent).toContain('Cannot connect')
    expect(document.getElementById('btn-ws-retry').hidden).toBe(false)
  })

  it('sets aria-busy on close', () => {
    window.onWSClose()
    window.disconnectWS()                     // clear the scheduled reconnect timer
    expect(document.getElementById('config-form').getAttribute('aria-busy')).toBe('true')
  })
})

describe('WS disconnect while in-flight', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="userChange" />'
    window.__test.groups = [
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
      i: 1,
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
    window.__test.groups = [
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
    origComponents = window.__test.groups;
    window.__test.groups = [
      { id: 'wifi', fields: null },
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
  })
  afterEach(function () {
    window.__test.groups = origComponents;
  })

  it('syncLS does not throw when group has no fields', function () {
    expect(function () { window.syncLS() }).not.toThrow()
  })

  it('updateAV does not throw when group has no fields', function () {
    expect(function () {
      window.updateAV({ wifi: { ssid: ['text', 'SSID', { value: 'x' }] } })
    }).not.toThrow()
  })
})

describe('populateFromGroups null safety', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />'
  })

  it('handles field without opts gracefully', () => {
    expect(function () {
      window.populateFromGroups([
        { id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID' }] },
      ])
    }).not.toThrow()
  })

  it('handles field with opts undefined gracefully', () => {
    expect(function () {
      window.populateFromGroups([
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
    window.__test.groups = [
      { id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: {} }] },
    ]
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    if (window.ws) window.ws.close()
    window.connectWS()
  })

  it('sends full field format with type and label from groups', () => {
    window.__test.wsReady()
    window.sendToServer('wifi.ssid', 'MyVal')
    expect(window.__test.wsSent).toEqual({
      action: 'apply',
      i: 1,
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
    window.__test.groups = [{
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

describe('settings push during visible prompt', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="myLocal" />'
    window.__test.groups = [
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
    expect(window.__test.groups[0].fields[0].opts.value).toBe('thirdVal')
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

describe('status rendering', () => {
  var origStatus;

  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = ''
    document.getElementById('nav-list').innerHTML = ''
    window.__test.groups = [
      { id: 'wifi', label: 'Wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'Net' } },
      ]},
    ]
    origStatus = window.__test.statusGroups
    window.__test.statusGroups = [
      { id: 'system', label: 'System', fields: [
        { key: 'uptime', type: 'text', label: 'Uptime', opts: { value: '1d 0h' } },
      ]},
    ]
  })

  afterEach(() => {
    window.__test.statusGroups = origStatus
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
    var input = document.querySelector('[name="st-system.uptime"]')
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
    window.__test.groups = []
    window.__test.statusGroups = []
    window.__test.dirty = false
  })

  it('routes type:status message to processStatus', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({ type: 'status', data: { network: { signal: ['range', 'Signal', { value: '75' }] } } }),
    })
    expect(window.__test.statusGroups.length).toBe(1)
    expect(window.__test.statusGroups[0].id).toBe('network')
    expect(window.__test.statusGroups[0].fields[0].key).toBe('signal')
  })

  it('does not route status message to settings handling', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({ type: 'status', data: { network: { signal: ['range', 'Signal', { value: '75' }] } } }),
    })
    expect(window.__test.dirty).toBe(false)
    expect(window.__test.groups.length).toBe(0)
  })

  it('routes type:settings messages correctly', () => {
    window.__test.receiveWSMessage({
      data: JSON.stringify({ type: 'settings', _dirty: true, data: { wifi: { ssid: ['text', 'SSID', { value: 'Net' }] } } }),
    })
    expect(window.__test.groups.length).toBeGreaterThan(0)
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
    window.__test.groups = [{ id: 'mqtt', fields: [
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
    expect(window.__test.wsSent).toEqual({ action: 'apply', i: 1, data: { mqtt: { client_id: ['text', 'Client ID', { value: 'my-device' }] } } })
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
    window.__test.groups = [{ id: 'mqtt', fields: [{ key: 'client_id', type: 'text', label: 'Client ID', opts: {} }] }]
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
    window.__test.groups = [{ id: 'mqtt', fields: [{ key: 'client_id', type: 'text', label: 'Client ID', opts: {} }] }]
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
  })
})

describe('aria-invalid', function () {
  it('sets aria-invalid="false" on all named form fields after renderForm', function () {
    window.__test.groups = [{ id: 'wifi', label: 'WiFi', fields: [
      { key: 'ssid', type: 'text', label: 'SSID', opts: {} }
    ]}]
    window.__test.statusGroups = []
    window.renderForm()
    window.revalidateAll()
    var input = document.querySelector('[name="wifi.ssid"]')
    expect(input.getAttribute('aria-invalid')).toBe('false')
  })

  it('sets aria-invalid="true" on invalid field, "false" on valid field', function () {
    document.querySelector('#config-form').innerHTML = '<input name="mqtt.client_id" value="" required minlength="3" />'
    window.__test.groups = [{ id: 'mqtt', fields: [
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
    window.__test.groups = [{ id: 'wifi', label: 'WiFi', fields: [
      { key: 'password', type: 'password', label: 'Password', opts: { attrs: { required: true }, value: '' } }
    ]}]
    window.__test.statusGroups = []
    window.renderForm()
    window.revalidateAll()
    var input = document.querySelector('[name="wifi.password"]')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('opens details section on renderForm when it has aria-invalid child', function () {
    document.querySelector('#config-form').innerHTML = ''
    window.__test.groups = [{ id: 'wifi', label: 'WiFi', fields: [
      { key: 'password', type: 'password', label: 'Password', opts: { attrs: { required: true }, value: '' } }
    ]}]
    window.__test.statusGroups = []
    window.renderForm()
    window.revalidateAll()
    var details = document.getElementById('wifi')
        expect(details.open).toBe(true)
  })
})

describe('checkbox indeterminate validation', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = [
      '<input type="checkbox" name="notifications.confirm" required />',
    ].join('')
    window.__test.groups = [{ id: 'notifications', fields: [
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
    window.__test.groups = [{ id: 'notifications', fields: [
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

describe('partial server update', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = [
      '<input name="wifi.ssid" value="Net" />',
      '<input name="wifi.password" value="" />',
      '<input name="gpio.pin" value="2" />',
    ].join('')
    window.__test.groups = [
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
    expect(window.__test.groups[0].fields[0].opts.value).toBe('NewNet')
    expect(window.__test.groups[0].fields[1].opts.value).toBe('')
    expect(window.__test.groups[1].fields[0].opts.value).toBe(2)
  })
})

describe('rapid blur events across different fields', function () {
  beforeEach(function () {
    document.querySelector('#config-form').innerHTML = [
      '<input name="wifi.ssid" value="Net" />',
      '<input name="wifi.password" value="secret" />',
    ].join('')
    window.__test.groups = [
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

describe('notif-keep-local sends only conflicting fields', () => {
  beforeEach(() => {
    document.getElementById('server-changed').hidden = true
    document.querySelector('#config-form').innerHTML = ''
    window.__test.groups = []
    window.__test.lastSent = {}
    window.__test.inFlight = {}
    window.__test.dirty = false
    document.getElementById('notif-load').hidden = true
    document.getElementById('notif-keep').hidden = true
    document.getElementById('notif-keep-local').hidden = true
    document.getElementById('notif-accept-server').hidden = true
  })

  it('sends only conflicting fields, not entire form', () => {
    window.__test.groups = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: 'oldSsid' } },
        { key: 'pwd', type: 'password', label: 'Pwd', opts: { value: 'oldPwd' } }
      ]}
    ]
    var ssidInput = document.createElement('input')
    ssidInput.name = 'wifi.ssid'
    ssidInput.value = 'localSsid'
    document.querySelector('#config-form').appendChild(ssidInput)
    var pwdInput = document.createElement('input')
    pwdInput.type = 'password'
    pwdInput.name = 'wifi.pwd'
    pwdInput.value = 'oldPwd'
    document.querySelector('#config-form').appendChild(pwdInput)

    window.__test.lastSent = { 'wifi.pwd': 'oldPwd' }
    window.__test.dirty = true

    var sentKeys = []
    window.__test.onWSSend = function (data) {
      var msg = JSON.parse(data)
      var keys = Object.keys(msg.data.wifi)
      for (var ki = 0; ki < keys.length; ki++) sentKeys.push('wifi.' + keys[ki])
    }
    window.__test.wsReady()

    var pushData = { wifi: { ssid: ['text', 'SSID', { value: 'serverSsid' }] } }
    window.__test.receiveWSMessage({ data: JSON.stringify({ type: 'settings', _dirty: false, data: pushData }) })

    expect(document.getElementById('notif-keep-local').hidden).toBe(false)

    sentKeys = []
    document.getElementById('notif-keep-local').click()

    expect(sentKeys).toEqual(['wifi.ssid'])
  })
})

describe('nav collapse/expand', function () {
  beforeEach(function () {
    window.__test.groups = [{ id: 'wifi', label: 'Wifi' }, { id: 'gpio', label: 'Gpio' }];
    window.__test.statusGroups = [];
    window.__test.showReboot = true;
    window.renderNav();
  });

  it('collapses section links into the device menu', function () {
    window.__test.setNavMode(true);
    expect(document.getElementById('nav-list').hasAttribute('hidden')).toBe(true);
    var labels = Array.prototype.map.call(
      document.querySelectorAll('#nav-actions a'),
      function (a) { return a.textContent; });
    expect(labels).toEqual(['Wifi', 'Gpio', 'Reboot']);
    expect(document.getElementById('nav-sep').hasAttribute('hidden')).toBe(false);
    expect(document.querySelectorAll('#nav-list a').length).toBe(0);
  });

  it('expands links back to inline', function () {
    window.__test.setNavMode(true);
    window.__test.setNavMode(false);
    expect(document.getElementById('nav-list').hasAttribute('hidden')).toBe(false);
    expect(document.querySelectorAll('#nav-list a').length).toBe(2);
    expect(document.getElementById('nav-reboot')).not.toBeNull();
    expect(document.getElementById('nav-sep').hasAttribute('hidden')).toBe(true);
  });

  it('shows a sections-only menu when collapsed with no device actions', function () {
    window.__test.showReboot = false;
    window.renderNav();
    window.__test.setNavMode(true);
    expect(document.getElementById('nav-list').hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('nav-actions').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('nav-reboot')).toBeNull();
    expect(document.getElementById('nav-sep').hasAttribute('hidden')).toBe(true);
    var labels = Array.prototype.map.call(
      document.querySelectorAll('#nav-actions a'),
      function (a) { return a.textContent; });
    expect(labels).toEqual(['Wifi', 'Gpio']);
  });
})

describe('upload lock and file-value exclusion', function () {
  function setupWifi() {
    document.querySelector('#config-form').innerHTML = '<input name="wifi.ssid" value="" />'
    window.__test.groups = [{ id: 'wifi', fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { value: '' } }] }]
  }

  function renderFileField() {
    document.querySelector('#config-form').innerHTML = ''
    window.__test.fileFields = {}
    var field = window.createField('audio', {
      key: 'clip', type: 'file', label: 'Clip',
      opts: { value: 'beep.mp3', accept: '.bin' },
    })
    document.querySelector('#config-form').appendChild(field)
    return field
  }

  function renderRebootLink() {
    document.getElementById('nav-list').innerHTML = ''
    window.__test.groups = []
    window.__test.statusGroups = []
    window.__test.showReboot = true
    window.renderNav()
  }

  beforeEach(function () {
    window.__test.dirty = false
    window.__test.showReset = false
    window.__test.showReboot = false
    window.__test.localUploading = false
    window.__test.serverUploading = false
    window.__test.fileFields = {}
    window.__test.inFlight = {}
    window.__test.lastSent = {}
    document.querySelector('#config-form').innerHTML = ''
    document.getElementById('nav-list').innerHTML = ''
    document.getElementById('server-changed').hidden = true
    document.getElementById('notif-load').hidden = true
    document.getElementById('notif-keep').hidden = true
    document.getElementById('notif-keep-local').hidden = true
    document.getElementById('notif-accept-server').hidden = true
  })

  afterEach(function () {
    window.__test.localUploading = false
    window.__test.serverUploading = false
  })

  it('locks Save, Reset, Reboot and Upload when serverUploading', function () {
    renderRebootLink()
    var field = renderFileField()
    selectFile(field.querySelector('input[type=file]'), fakeFile('a.bin', 'application/octet-stream', 10))
    window.__test.dirty = true
    window.__test.showReset = true
    window.__test.serverUploading = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
    expect(document.getElementById('btn-reset').hidden).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
    expect(document.getElementById('nav-reboot').getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById('reboot-confirm').disabled).toBe(true)
    expect(field.querySelector('#audio\\.clip-upload').disabled).toBe(true)
  })

  it('does not show Save on a _meta.uploading push even when dirty', function () {
    setupWifi()
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { dirty: true, uploading: true },
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(true)
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('restores Save on a _meta.uploading:false push when dirty', function () {
    setupWifi()
    window.__test.serverUploading = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { dirty: true, uploading: false },
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(false)
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
  })

  it('serialize and getPending omit file fields', function () {
    document.querySelector('#config-form').innerHTML =
      '<input name="audio.clip" type="file" /><input name="audio.volume" type="range" value="50" />'
    window.__test.groups = [{ id: 'audio', fields: [
      { key: 'clip', type: 'file', label: 'Clip', opts: {} },
      { key: 'volume', type: 'range', label: 'Volume', opts: {} },
    ]}]
    var data = window.serialize()
    expect(data['audio.clip']).toBeUndefined()
    expect(data['audio.volume']).toBe(50)
    window.setBaseline()
    expect(window.getPending()).toEqual({})
  })

  it('buildPatch omits file fields', function () {
    window.__test.groups = [{ id: 'audio', fields: [
      { key: 'clip', type: 'file', label: 'Clip', opts: {} },
      { key: 'volume', type: 'range', label: 'Volume', opts: {} },
    ]}]
    var patch = window.buildPatch({ 'audio.clip': 'evil.mp3', 'audio.volume': 50 })
    expect(patch).toEqual({ audio: { volume: ['range', 'Volume', { value: 50 }] } })
  })

  it('readFormValue returns undefined for a file field', function () {
    document.querySelector('#config-form').innerHTML = '<input name="audio.clip" type="file" />'
    window.__test.groups = [{ id: 'audio', fields: [
      { key: 'clip', type: 'file', label: 'Clip', opts: {} },
    ]}]
    expect(window.readFormValue(['audio', 'clip'])).toBeUndefined()
  })

  it('silently updates the file label without a conflict bar', function () {
    var field = renderFileField()
    window.__test.groups = [{ id: 'audio', fields: [
      { key: 'clip', type: 'file', label: 'Clip', opts: { value: 'old.mp3', accept: '.bin' } },
    ]}]
    window.__test.receiveWSMessage({ data: JSON.stringify({
      _dirty: false,
      audio: { clip: ['file', 'Clip', { value: 'new.mp3' }] },
    })})
    expect(document.getElementById('audio.clip-current').textContent).toContain('new.mp3')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('restores controls on _meta.uploading:false when no local upload', function () {
    setupWifi()
    window.__test.showReset = true
    window.__test.serverUploading = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { dirty: true, uploading: false },
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(false)
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
    expect(document.getElementById('btn-reset').hidden).toBe(false)
    expect(document.getElementById('btn-reset').disabled).toBe(false)
  })

  it('keeps controls locked on _meta.uploading:false while a local upload runs', function () {
    setupWifi()
    window.__test.localUploading = true
    window.__test.serverUploading = true
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { dirty: true, uploading: false },
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(false)
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
  })

  it('prefers _meta.uploading over legacy _uploading', function () {
    setupWifi()
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { uploading: false },
      _uploading: true,
      _dirty: false,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(false)
  })

  it('falls back to legacy _uploading when _meta is absent', function () {
    setupWifi()
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _uploading: true,
      _dirty: false,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(true)
  })

  it('shows Save after a deferred dirty push once the local upload ends', function () {
    setupWifi()
    window.__test.localUploading = true
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { dirty: true, uploading: false },
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    window.__test.localUploading = false
    window.updateUI()
    expect(document.getElementById('btn-save-apply').hidden).toBe(false)
  })

  it('warns on beforeunload when _meta.uploading is true', function () {
    setupWifi()
    window.__test.receiveWSMessage({ data: JSON.stringify({
      type: 'settings',
      _meta: { uploading: true },
      _dirty: false,
      data: { wifi: { ssid: ['text', 'SSID', { value: '' }] } },
    })})
    expect(window.__test.serverUploading).toBe(true)
    var e = { preventDefault: vi.fn(), returnValue: '' }
    window.__test.onBeforeUnload(e)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('locks controls immediately when a local upload starts', function () {
    renderRebootLink()
    var field = renderFileField()
    selectFile(field.querySelector('input[type=file]'), fakeFile('a.bin', 'application/octet-stream', 10))
    window.__test.dirty = true
    window.__test.showReset = true
    var realFetch = window.fetch
    window.fetch = function () { return new Promise(function () {}) }
    window.__test.startUpload('audio.clip')
    expect(window.__test.localUploading).toBe(true)
    expect(document.getElementById('btn-save-apply').hidden).toBe(true)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
    expect(document.getElementById('nav-reboot').getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById('reboot-confirm').disabled).toBe(true)
    window.fetch = realFetch
  })
})

describe('ack correlation', () => {
  function setup(av) {
    document.getElementById('config-form').removeAttribute('aria-busy')
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="' + av + '" />' +
      '<input name="wifi.pass" value="" />'
    window.__test.groups = [{ id: 'wifi', fields: [
      { key: 'ssid', type: 'text', label: 'SSID', opts: { value: av } },
      { key: 'pass', type: 'text', label: 'Pass', opts: { value: '' } },
    ]}]
    window.__test.pending = {}
    window.__test.inFlight = {}
    window.__test.lastSent = {}
    window.__test.nextId = 1
    window.__test.sent = []
    window.__test.onWSSend = function (d) { window.__test.sent.push(JSON.parse(d)) }
    document.getElementById('server-changed').hidden = true
    window.connectWS()
    window.__test.wsReady()
    // connectWS() sets aria-busy; clear it again so settings pushes are
    // classified normally instead of taking the reconnect force-reset branch.
    document.getElementById('config-form').removeAttribute('aria-busy')
  }
  /* Simulate a user edit: put the value in the widget FIRST, then send it.
   * writeBack() only rewrites a widget that still holds the value that was
   * sent, so a bare onUserInput() call would suppress every write-back. */
  function type(key, val) {
    var el = document.querySelector('[name="' + key + '"]')
    if (el.type === 'checkbox') { el.checked = !!val; el.indeterminate = false }
    else el.value = val
    window.onUserInput(key, val)
  }
  function recv(msg) {
    window.__test.receiveWSMessage({ data: JSON.stringify(msg) })
  }

  beforeEach(() => setup('old'))

  it('sends an incrementing i and records the batch', () => {
    type('wifi.ssid', 'new')
    expect(window.__test.sent[0]).toEqual({
      action: 'apply', i: 1,
      data: { wifi: { ssid: ['text', 'SSID', { value: 'new' }] } },
    })
    expect(window.__test.pending[1].keys).toEqual(['wifi.ssid'])
    expect(window.__test.pending[1].sent).toEqual({ 'wifi.ssid': 'new' })
    expect(window.__test.nextId).toBe(2)
  })

  it('ack settles the batch and adopts the decided value', () => {
    type('wifi.ssid', 'new')
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'decided' } })
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
    expect(window.__test.lastSent['wifi.ssid']).toBe('decided')
    expect(window.__test.pending[1]).toBeUndefined()
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('decided')
    expect(window.__test.groups[0].fields[0].opts.value).toBe('decided')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('an ack that omits a key leaves AV and widget unchanged', () => {
    type('wifi.ssid', 'new')
    recv({ type: 'ack', i: 1, d: {} })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('old')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('new')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('a same-value ack writes nothing and shows no prompt', () => {
    type('wifi.ssid', 'same')
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'same' } })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('same')
    expect(window.__test.lastSent['wifi.ssid']).toBe('same')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('same')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  it('adopts a falsey decided value', () => {
    type('wifi.ssid', 'x')
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': '' } })
    expect(window.__test.groups[0].fields[0].opts.value).toBe('')
    expect(window.__test.lastSent['wifi.ssid']).toBe('')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('')
  })

  it('a settings push with i != syncId keeps normal handling', () => {
    recv({ type: 'settings', i: 5, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'external' }] }}})
    expect(window.__test.groups[0].fields[0].opts.value).toBe('external')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('old')
    expect(document.getElementById('server-changed').hidden).toBe(false)
    expect(document.getElementById('notif-load').hidden).toBe(false)
  })

  it('does not rewrite a widget the user has typed into', () => {
    type('wifi.ssid', 'sent')
    document.querySelector('[name="wifi.ssid"]').value = 'typed'
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'decided' } })
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('typed')
    // the decided value is adopted into the applied value even though the
    // widget is left alone; lastSent is then overwritten by the flush below
    expect(window.__test.groups[0].fields[0].opts.value).toBe('decided')
    // the queued typed value is flushed as a fresh batch
    expect(window.__test.sent[1].data.wifi.ssid[2].value).toBe('typed')
  })

  it('rejection reverts, reports, and stays retryable', () => {
    type('wifi.ssid', 'bad')
    recv({ type: 'ack', i: 1, e: { 'wifi.ssid': 'rejected' } })
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('old')
    expect(document.getElementById('status-bar').textContent).toBe('Rejected: SSID')
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
    window.__test.sent = []
    type('wifi.ssid', 'bad')
    expect(window.__test.sent.length).toBe(1)
    expect(window.__test.sent[0].i).toBe(2)
  })

  it('a higher ack settles lower batches with no decided values', () => {
    type('wifi.ssid', 'a')      // id 1
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'a' } })
    type('wifi.ssid', 'b')      // id 2
    type('wifi.pass', 'p')      // id 3
    recv({ type: 'ack', i: 3, d: { 'wifi.pass': 'p' } })
    expect(window.__test.pending[2]).toBeUndefined()
    expect(window.__test.pending[3]).toBeUndefined()
    expect(window.__test.inFlight['wifi.pass']).toBe(false)
  })

  it('an ack for an id that was never sent changes nothing', () => {
    type('wifi.ssid', 'new')                  // id 1; nextId is 2
    recv({ type: 'ack', i: 99, d: { 'wifi.ssid': 'ghost' } })
    expect(window.__test.pending[1]).not.toBeUndefined()
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
    expect(window.__test.lastSent['wifi.ssid']).toBe('new')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('new')
  })

  it('ignores a duplicate ack', () => {
    type('wifi.ssid', 'a')
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'a' } })
    window.__test.sent = []
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'a' } })
    expect(window.__test.sent).toEqual([])
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
  })

  it('ack bypasses the in-flight guard', () => {
    type('wifi.ssid', 'a')      // id 1
    type('wifi.pass', 'p')      // id 2
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'a' } })
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
    expect(window.__test.pending[1]).toBeUndefined()
    expect(window.__test.pending[2]).not.toBeUndefined()
  })

  it('applies _meta while a batch is pending', () => {
    type('wifi.ssid', 'a')
    recv({ type: 'settings', _meta: { dirty: true }, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'old' }],
    }}})
    expect(window.__test.dirty).toBe(true)
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
  })

  it('renders a null decided value as indeterminate', () => {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="wifi.confirm" />'
    window.__test.groups[0].fields.push(
      { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: { value: false } })
    type('wifi.confirm', true)                // the box is checked before sending
    recv({ type: 'ack', i: 1, d: { 'wifi.confirm': null } })
    var el = document.querySelector('[name="wifi.confirm"]')
    expect(el.indeterminate).toBe(true)
    expect(el.checked).toBe(false)
    expect(window.__test.lastSent['wifi.confirm']).toBeNull()
    window.__test.sent = []
    window.onUserInput('wifi.confirm', null)  // next blur: no re-send
    expect(window.__test.sent.length).toBe(0)
  })

  it('reconnect resets ids and pending batches', () => {
    type('wifi.ssid', 'a')
    window.onWSClose()                        // no __test hook exists for this
    window.disconnectWS()                     // clear the scheduled reconnect timer
    expect(window.__test.pending).toEqual({})
    expect(window.__test.nextId).toBe(1)
  })

  it('does not resend an unchanged value after a transform ack', () => {
    type('wifi.ssid', '5')
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': '10' } })
    window.__test.sent = []
    type('wifi.ssid', '10')
    expect(window.__test.sent.length).toBe(0)
  })

  it('flushes a typed value without settling another batch', () => {
    type('wifi.ssid', 'a')                    // id 1
    type('wifi.pass', 'p')                    // id 2
    recv({ type: 'ack', i: 1, e: { 'wifi.ssid': 'rejected' } })
    // the rejection settles only its own key
    expect(window.__test.pending[2]).not.toBeUndefined()
    expect(window.__test.inFlight['wifi.pass']).toBe(true)
    // a newer local value on the rejected key is queued by the flush, not lost
    document.querySelector('[name="wifi.ssid"]').value = 'retry'
    recv({ type: 'ack', i: 2, d: { 'wifi.pass': 'p' } })
    var last = window.__test.sent[window.__test.sent.length - 1]
    expect(last.data.wifi.ssid[2].value).toBe('retry')
  })
})

describe('ack timeout and recovery', () => {
  function setup(av) {
    document.getElementById('config-form').removeAttribute('aria-busy')
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="' + av + '" />' +
      '<input name="wifi.pass" value="" />'
    window.__test.groups = [{ id: 'wifi', fields: [
      { key: 'ssid', type: 'text', label: 'SSID', opts: { value: av } },
      { key: 'pass', type: 'text', label: 'Pass', opts: { value: '' } },
    ]}]
    window.__test.pending = {}
    window.__test.inFlight = {}
    window.__test.lastSent = {}
    window.__test.nextId = 1
    window.__test.sent = []
    window.__test.onWSSend = function (d) { window.__test.sent.push(JSON.parse(d)) }
    document.getElementById('server-changed').hidden = true
    window.connectWS()
    window.__test.wsReady()
    // connectWS() sets aria-busy; clear it again so settings pushes are
    // classified normally instead of taking the reconnect force-reset branch.
    document.getElementById('config-form').removeAttribute('aria-busy')
    window.__test.recovering = {}
    window.__test.syncId = 0
  }
  /* Simulate a user edit: put the value in the widget FIRST, then send it.
   * writeBack() only rewrites a widget that still holds the value that was
   * sent, so a bare onUserInput() call would suppress every write-back. */
  function type(key, val) {
    var el = document.querySelector('[name="' + key + '"]')
    if (el.type === 'checkbox') { el.checked = !!val; el.indeterminate = false }
    else el.value = val
    window.onUserInput(key, val)
  }
  function recv(msg) {
    window.__test.receiveWSMessage({ data: JSON.stringify(msg) })
  }

  beforeEach(() => { vi.useFakeTimers(); setup('old') })
  afterEach(() => { vi.useRealTimers() })

  it('timeout clears inFlight and enters recovery', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
    expect(window.__test.pending[1]).toBeUndefined()
    expect(window.__test.recovering['wifi.ssid']).toEqual({ sent: 'sent', retried: false })
    expect(window.__test.sent[1]).toEqual({ action: 'sync', i: 2 })
  })

  it('timeout then landed reply sends no resend', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)
    window.__test.sent = []
    recv({ type: 'settings', i: 2, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'sent' }] }}})
    expect(window.__test.sent).toEqual([])
    expect(window.__test.recovering).toEqual({})
    expect(window.__test.lastSent['wifi.ssid']).toBe('sent')
  })

  it('timeout then missing reply resends exactly once', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)
    window.__test.sent = []
    recv({ type: 'settings', i: 2, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'old' }] }}})
    expect(window.__test.sent.length).toBe(1)
    expect(window.__test.sent[0].i).toBe(3)
    expect(window.__test.sent[0].data.wifi.ssid[2].value).toBe('sent')
    expect(window.__test.pending[3].retried).toBe(true)
    expect(window.__test.recovering).toEqual({})
  })

  it('a timed-out retry adopts the store value and stops', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)              // i:1 timed out → sync i:2
    recv({ type: 'settings', i: 2, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'old' }] }}})   // not landed → resend i:3
    vi.advanceTimersByTime(5000)              // retry timed out → sync i:4
    window.__test.sent = []
    recv({ type: 'settings', i: 4, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'old' }] }}})
    expect(window.__test.sent).toEqual([])
    expect(window.__test.recovering).toEqual({})
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('old')
    expect(window.__test.lastSent['wifi.ssid']).toBe('old')
  })

  it('a typed value is not overwritten by recovery', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)
    document.querySelector('[name="wifi.ssid"]').value = 'typed'
    recv({ type: 'settings', i: 2, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'old' }] }}})
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('typed')
    var applies = window.__test.sent.filter(function (m) { return m.action === 'apply' })
    expect(applies.length).toBe(2)                // original + newer typed value
    expect(applies[1].data.wifi.ssid[2].value).toBe('typed')
    expect(window.__test.recovering).toEqual({})
  })

  it('sync is deferred until pending drains', () => {
    type('wifi.ssid', 'a')                    // i:1
    type('wifi.pass', 'p')                    // i:2
    vi.advanceTimersByTime(5000)
    var syncs = window.__test.sent.filter(function (m) { return m.action === 'sync' })
    expect(syncs.length).toBe(1)
    expect(syncs[0].i).toBe(3)
    expect(window.__test.sent[window.__test.sent.length - 1].action).toBe('sync')
  })

  it('sync timeout is terminal', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)              // sync i:2
    window.__test.sent = []
    vi.advanceTimersByTime(5000)              // reply never comes
    expect(window.__test.syncId).toBe(0)
    expect(window.__test.recovering).toEqual({})
    expect(window.__test.sent).toEqual([])
  })

  it('reconnect clears recovery and timers', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)
    window.__test.sent = []
    window.onWSClose()                        // no __test hook exists for this
    expect(window.__test.recovering).toEqual({})
    expect(window.__test.syncId).toBe(0)
    expect(window.__test.pending).toEqual({})
    vi.advanceTimersByTime(60000)             // backoff reconnect must not send
    expect(window.__test.sent).toEqual([])
  })

  it('a broadcast resolves recovery without a prompt', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)
    window.__test.sent = []
    recv({ type: 'settings', _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'sent' }] }}})
    expect(window.__test.sent).toEqual([])
    expect(document.getElementById('server-changed').hidden).toBe(true)
    expect(window.__test.recovering).toEqual({})
  })

  it('a broadcast while a batch is pending does not settle it', () => {
    type('wifi.ssid', 'a')
    recv({ type: 'settings', _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'external' }] }}})
    expect(window.__test.inFlight['wifi.ssid']).toBe(true)
    expect(window.__test.groups[0].fields[0].opts.value).toBe('old')
  })

  it('a sync reply does not prompt for an in-flight key', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)              // ssid recovering, sync i:2
    type('wifi.pass', 'p')                    // i:3, in flight
    recv({ type: 'settings', i: 2, _meta: {}, data: { wifi: {
      ssid: ['text', 'SSID', { value: 'old' }],
      pass: ['text', 'Pass', { value: '' }] }}})
    expect(document.getElementById('server-changed').hidden).toBe(true)
    expect(window.__test.inFlight['wifi.pass']).toBe(true)
  })

  it('a late ack for a timed-out batch changes nothing', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)              // i:1 timed out; sync i:2
    window.__test.sent = []
    recv({ type: 'ack', i: 1, d: { 'wifi.ssid': 'ghost' } })
    expect(window.__test.sent).toEqual([])
    expect(window.__test.recovering['wifi.ssid']).toEqual({ sent: 'sent', retried: false })
    expect(window.__test.lastSent['wifi.ssid']).toBe('old')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('sent')
  })

  it('ack_timeout_ms comes from the meta tag with a fallback', () => {
    var m = document.querySelector('meta[name="parasol-ack-timeout"]')
    m.content = '2500'
    window.__test.readAckTimeout()
    expect(window.__test.ackTimeout).toBe(2500)
    m.content = ''
    window.__test.readAckTimeout()
    expect(window.__test.ackTimeout).toBe(5000)
  })

  it('an old-firmware push that never acks degrades to terminal', () => {
    type('wifi.ssid', 'sent')
    vi.advanceTimersByTime(5000)              // sync i:2
    vi.advanceTimersByTime(5000)              // no reply → terminal
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('sent')
    expect(window.__test.recovering).toEqual({})
    expect(document.querySelector('#config-form').getAttribute('aria-busy')).not.toBe('true')
  })
})
