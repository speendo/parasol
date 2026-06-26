# Checkbox Three-State Revival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `checkbox` field type supporting three wire values (true/false/null) with indeterminate state, plus CSS fix for helper text layout.

**Architecture:** The `checkbox` type reuses the same DOM structure as `switch` (input[type="checkbox"] + label in a div) but without `role="switch"`. The indeterminate HTML property distinguishes it: `el.indeterminate` = true means null on the wire. `readFormValue` is the shared read path — safe for both switch and checkbox since switches are never set to indeterminate.

**Tech Stack:** Vanilla JS (no framework), vitest (unit), Playwright (e2e), PicoCSS v2.1.1, terser (minify)

---

### Task 1: Docs update — add checkbox to field-format.md

**Files:**
- Modify: `docs/reference/field-format.md`

- [ ] **Step 1: Add checkbox row to supported types table**

After the `switch` row (line 32), insert the `checkbox` row. Then add a row to the value coercion table (after the `switch` row at line 52).

The changes are two insertions in `docs/reference/field-format.md`:

**In the Supported Types table** — after line 32 (`| `switch` | ... | settings, status |`), add:
```
| `checkbox` | `<input type="checkbox">` | yes | settings, status |
```

**In the value Coercion table** — after line 52 (`| `switch` | boolean (`el.checked`) |`), add:
```
| `checkbox` | boolean or null (`el.indeterminate ? null : el.checked`) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/reference/field-format.md
git commit -m "docs: add checkbox row to supported types and value coercion tables"
```

---

### Task 2: Rename `tooltip` JSON key to `help`

**Files:**
- Modify: `test_server/main.py`
- Modify: `app.js`
- Modify: `docs/reference/field-format.md`
- Modify: `tests/unit/app.test.js`
- Modify: `tests/e2e/app.test.js`

> This is a mechanical rename. The JSON key `"tooltip"` is replaced with `"help"` everywhere. `opts.tooltip` becomes `opts.help`. No logic changes.

- [ ] **Step 1: Replace in test_server/main.py**

Replace every `"tooltip":` with `"help":` in `test_server/main.py` (28 occurrences in SETTINGS and STATUS dicts).

```bash
sed -i 's/"help":/"help":/g' test_server/main.py
```

- [ ] **Step 2: Replace in app.js**

Replace 3 occurrences of `opts.help` with `opts.help`:

```bash
sed -i 's/opts\.tooltip/opts.help/g' app.js
```

- [ ] **Step 3: Replace in docs/reference/field-format.md**

In the opts table (around line 46), change:

**From:**
```
| `tooltip` | string | all | Helper text shown below the field |
```

**To:**
```
| `help` | string | all | Helper text shown below the field |
```

- [ ] **Step 4: Replace in tests/unit/app.test.js**

Replace all `tooltip:` in test data, and rename test descriptions "tooltip" → "helper text":

```bash
sed -i "s/help: '/help: '/g" tests/unit/app.test.js
```

Also update test description strings that say "tooltip" in test names — replace:
- `it('sets tooltip as small helper after input'` → `it('sets helper text as small after input'`
- `it('does not create small helper when tooltip is omitted'` → `it('does not create small helper when help is omitted'`
- `it('does not create small helper when tooltip is empty'` → `it('does not create small helper when help is empty'`
- `it('radio tooltip is outside fieldset inside the container div'` → `it('radio helper text is outside fieldset inside the container div'`
- `help: 'Network name'` in `processSettings` test → `help: 'Network name'`

- [ ] **Step 5: Replace in tests/e2e/app.test.js**

```bash
sed -i "s/test('tooltip is rendered'/test('helper text is rendered'/g" tests/e2e/app.test.js
```

Also update the test body: change `toHaveText('WiFi network name — required, 1–32 characters')` if the test server help string changed (it didn't — only the key name changes, not the value).

- [ ] **Step 6: Run unit tests to verify nothing broke**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all existing tests PASS. The rename is transparent — only keys changed, not values.

- [ ] **Step 7: Commit**

```bash
git add test_server/main.py app.js docs/reference/field-format.md tests/unit/app.test.js tests/e2e/app.test.js
git commit -m "refactor: rename tooltip JSON key to help"
```

---

### Task 3: Test server — convert GPIO switches to checkboxes, add null-valued checkbox

**Files:**
- Modify: `test_server/main.py`

- [ ] **Step 1: Convert GPIO enabled/inverted from switch to checkbox**

In `test_server/main.py`, the GPIO component (around line 27-28) currently has `enabled` and `inverted` as `switch` type. Change both to `checkbox`:

**From (lines 27-28):**
```python
        "enabled": ["switch", "GPIO Enabled", {"value": True, "help": "Enable this GPIO pin"}],
        "inverted": ["switch", "Inverted", {"value": False, "help": "Invert GPIO signal level"}],
```

**To:**
```python
        "enabled": ["checkbox", "GPIO Enabled", {"value": True, "help": "Enable this GPIO pin"}],
        "inverted": ["checkbox", "Inverted", {"value": False, "help": "Invert GPIO signal level"}],
```

These were checkbox originally (commit `dfb8cd4`) before being converted to switch. Both have non-null default values — they exercise the checked/unchecked states.

- [ ] **Step 2: Add a checkbox with null value for indeterminate testing**

In the `"notifications"` component (around line 46), add a `checkbox` field after the existing `"enabled"` switch. The `null` value exercises the indeterminate state:

Insert this line after the `"enabled"` line:
```python
        "confirm":      ["checkbox", "Confirm Alerts", {"value": None, "help": "Explicitly enable or disable alerts"}],
```

- [ ] **Step 3: Commit**

```bash
git add test_server/main.py
git commit -m "test: convert GPIO enabled/inverted to checkbox, add null-valued checkbox"
```

---

### Task 4: readFormValue — return null for indeterminate checkboxes

**Files:**
- Modify: `tests/unit/app.test.js`
- Modify: `app.js`

- [ ] **Step 1: Write the failing test**

In `tests/unit/app.test.js`, inside the `describe('readFormValue', ...)` block (ends around line 1194), add a new test before the closing `});` at line 1194:

```js
  it('returns null for indeterminate checkbox', () => {
    document.querySelector('#config-form').innerHTML =
      '<input type="checkbox" name="gpio.confirm" />'
    var el = document.querySelector('[name="gpio.confirm"]')
    el.indeterminate = true
    expect(window.readFormValue(['gpio', 'confirm'])).toBe(null)
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "readFormValue"
```

Expected: the new test FAILS because `readFormValue` returns `false` for an indeterminate checkbox (current code: `return el.checked`).

- [ ] **Step 3: Write minimal implementation**

In `app.js`, find the `readFormValue` function (around line 508). Change line 516:

**From:**
```js
    if (el.type === 'checkbox') return el.checked;
```

**To:**
```js
    if (el.type === 'checkbox') return el.indeterminate ? null : el.checked;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "readFormValue"
```

Expected: all `readFormValue` tests PASS (the new one and existing ones).

Then run the full test suite to confirm nothing is broken:

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: readFormValue returns null for indeterminate checkboxes"
```

---

### Task 5: createField — add checkbox field type

**Files:**
- Modify: `tests/unit/app.test.js`
- Modify: `app.js`

- [ ] **Step 1: Write the failing test**

In `tests/unit/app.test.js`, inside the `describe('createField', ...)` block (ends around line 322), add two new tests before the closing `});` at line 322.

**Test A — basic checkbox creation:**

```js
  it('creates checkbox (input type=checkbox without role=switch)', () => {
    var field = window.createField('gpio', {
      key: 'confirm', type: 'checkbox', label: 'Confirm',
      opts: { value: null },
    })
    expect(field.tagName).toBe('DIV')
    expect(field.querySelector('label').getAttribute('for')).toBe('gpio.confirm')
    var input = field.querySelector('input')
    expect(input.type).toBe('checkbox')
    expect(input.role).toBe('')
    expect(input.checked).toBe(false)
    expect(input.indeterminate).toBe(false)
    expect(input.id).toBe('gpio.confirm')
    expect(input.disabled).toBe(false)
  })
```

**Test B — checkbox with helper text:**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "createField"
```

Expected: the two new tests FAIL. `createField` returns `null` for unknown types (the `checkbox` type falls through to the else branch at the bottom of `createField`).

- [ ] **Step 3: Write minimal implementation**

In `app.js`, find the `createField` function. The switch branch starts around line 762:

```js
    if (type === 'switch') {
```

Change it to match both `checkbox` and `switch`:

**From:**
```js
    if (type === 'switch') {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
```

**To:**
```js
    if (type === 'checkbox' || type === 'switch') {
      var input = document.createElement('input');
      input.type = 'checkbox';
      if (type === 'switch') input.role = 'switch';
```

All other lines inside this block remain unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "createField"
```

Expected: all `createField` tests PASS.

Then run the full test suite:

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: add checkbox field type to createField"
```

---

### Task 6: serialize — add checkbox to the ternary

**Files:**
- Modify: `tests/unit/app.test.js`
- Modify: `app.js`

- [ ] **Step 1: Write the failing test**

In `tests/unit/app.test.js`, inside the `describe('serialize', ...)` block (ends around line 51), add a new `it` block before the closing `});` at line 51:

```js
  it('returns null for indeterminate checkbox', () => {
    document.querySelector('#config-form').innerHTML +=
      '<input type="checkbox" name="gpio.confirm" />'
    window.__test.components[0].fields.push(
      { key: 'confirm', type: 'checkbox', label: 'Confirm', opts: {} }
    )
    var el = document.querySelector('[name="gpio.confirm"]')
    el.indeterminate = true
    var data = window.serialize()
    expect(data['gpio.confirm']).toBe(null)
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "serialize"
```

Expected: the new test FAILS because `serialize` doesn't have a `checkbox` branch and `el.value` returns `"on"` for a checkbox.

- [ ] **Step 3: Write minimal implementation**

In `app.js`, find the `serialize` function (around line 39). Change the ternary on lines 48-50:

**From:**
```js
        data[comp.id + '.' + field.key] = field.type === 'switch' ? el.checked
          : field.type === 'radio' ? (configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]:checked') || {}).value || null
          : el.value;
```

**To:**
```js
        data[comp.id + '.' + field.key] = field.type === 'checkbox' || field.type === 'switch' ? (field.type === 'checkbox' ? (el.indeterminate ? null : el.checked) : el.checked)
          : field.type === 'radio' ? (configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]:checked') || {}).value || null
          : el.value;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "serialize"
```

Expected: all `serialize` tests PASS.

Then run full suite:

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: add checkbox to serialize with indeterminate null handling"
```

---

### Task 7: populateFromComponents — add checkbox with indeterminate support

**Files:**
- Modify: `tests/unit/app.test.js`
- Modify: `app.js`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/app.test.js`, inside `describe('populateFromComponents', ...)` (ends around line 408), replace the entire describe block with expanded tests that include checkbox. The existing `beforeEach` stays but the tests are expanded:

Replace the content of the `describe('populateFromComponents', ...)` block (lines 376-408) with:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "populateFromComponents"
```

Expected: the checkbox tests FAIL because `populateFromComponents` doesn't handle `type === 'checkbox'`.

- [ ] **Step 3: Write minimal implementation**

In `app.js`, find the `populateFromComponents` function (around line 79). The switch branch starts at line 89:

```js
        if (field.type === 'switch') {
          el.checked = !!fopts.value;
        } else if (field.type === 'radio') {
```

Change it to handle checkbox separately:

**From:**
```js
        if (field.type === 'switch') {
          el.checked = !!fopts.value;
        } else if (field.type === 'radio') {
```

**To:**
```js
        if (field.type === 'checkbox') {
          if (fopts.value === null) {
            el.checked = false;
            el.indeterminate = true;
          } else {
            el.checked = !!fopts.value;
            el.indeterminate = false;
          }
        } else if (field.type === 'switch') {
          el.checked = !!fopts.value;
          el.indeterminate = false;
        } else if (field.type === 'radio') {
```

Note: the switch branch also needs `el.indeterminate = false` added so that a previously-indeterminate DOM element (reused) gets cleared when a switch takes its place.

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "populateFromComponents"
```

Expected: all `populateFromComponents` tests PASS.

Then run full suite:

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: add checkbox to populateFromComponents with indeterminate support"
```

---

### Task 8: bindChangeListeners — use readFormValue and add indeterminate validation

**Files:**
- Modify: `tests/unit/app.test.js`
- Modify: `app.js`

- [ ] **Step 1: Write the failing tests**

Add a new describe block before the final line of `tests/unit/app.test.js`. Insert before the file ends (there is no trailing newline after the last `});`). The last line is the closing of `describe('aria-invalid', ...)`. Add after it:

```js

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
    window.setBaseline()
    window.connectWS()
    window.__test.wsReady()
  })

  it('blocks send when indeterminate and required', function () {
    var sendCalled = false
    var origSend = window.sendToServer
    window.sendToServer = function () { sendCalled = true }
    var el = document.querySelector('[name="notifications.confirm"]')
    el.indeterminate = true
    window.bindChangeListeners()
    el.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(sendCalled).toBe(false)
    window.sendToServer = origSend
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
    window.connectWS()
    window.__test.wsReady()
    var el = document.querySelector('[name="notifications.confirm"]')
    el.indeterminate = true
    var sendCalled = false
    var origSend = window.sendToServer
    window.sendToServer = function () { sendCalled = true }
    window.bindChangeListeners()
    el.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el.getAttribute('aria-invalid')).toBe('false')
    expect(sendCalled).toBe(true)
    window.sendToServer = origSend
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "checkbox indeterminate"
```

Expected: tests FAIL because the handler doesn't check indeterminate and doesn't use `readFormValue`.

- [ ] **Step 3: Write minimal implementation**

Two changes in `app.js` inside the `bindChangeListeners` function (around line 670).

**Change A — use `readFormValue` for value extraction:**

In the handler closure (around line 677), change the value reading:

**From:**
```js
          var val = (el.type === 'checkbox') ? el.checked :
                    (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
```

**To:**
```js
          var val = readFormValue(key.split('.'));
```

**Change B — add indeterminate validation check:**

After the `var valid = el.checkValidity();` line (around line 679), add the indeterminate check:

**From:**
```js
          var valid = el.checkValidity();
```

**To:**
```js
          var valid = el.checkValidity();
          if (valid && el.indeterminate && el.required) valid = false;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run tests/unit/app.test.js -t "checkbox indeterminate"
```

Expected: the two new tests PASS.

Then run the full suite:

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: use readFormValue in change handler, add indeterminate required validation"
```

---

### Task 9: CSS — add helper text rule to index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the CSS rule**

In `index.html`, inside the `<style>` block (around line 39), add after the `details[open]:has(...)` block:

```css
      input[type="checkbox"] + label + small,
      fieldset + small {
        display: block;
        color: var(--pico-muted-color);
        margin-top: 0;
        margin-bottom: var(--pico-spacing);
      }
```

Insert after line 39 (after the `display: none;` line of the `details[open]:has([aria-invalid="true"]) summary::after` block).

- [ ] **Step 2: Run e2e tests to verify no regressions**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:e2e
```

Expected: all e2e tests PASS (the new CSS shouldn't break anything).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "style: add helper text CSS for checkbox/switch and radio fieldset"
```

---

### Task 10: Build and final verification

**Files:**
- Modify: `app.min.js` (generated)

- [ ] **Step 1: Run the build**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run build
```

Expected: terser minifies `app.js` → `app.min.js` with no errors.

- [ ] **Step 2: Run full test suite one final time**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all unit and e2e tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app.min.js
git commit -m "chore: rebuild app.min.js after checkbox revival"
```

---

### Self-Review

**Spec coverage:**
- [x] JSON key rename `tooltip` → `help` — Task 2
- [x] createField — Task 5
- [x] serialize — Task 6
- [x] populateFromComponents — Task 7
- [x] readFormValue — Task 4
- [x] bindChangeListeners (use readFormValue) — Task 8
- [x] Validation handler (indeterminate + required) — Task 8
- [x] CSS rule (index.html) — Task 9
- [x] Docs update (field-format.md) — Task 1
- [x] Test server checkbox fields — Task 3

**Placeholder scan:** No TBD, TODO, or vague instructions. Every step has concrete code.

**Type consistency:**
- `el.indeterminate` — used consistently across Tasks 3, 5, 6, 7
- `readFormValue` takes `['comp', 'field']` array — consistent in Task 7 where `key.split('.')` is used
- `fopts.value === null` strict check — consistent in Task 6
