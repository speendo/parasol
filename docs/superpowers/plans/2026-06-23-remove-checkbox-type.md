# Remove `checkbox` Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `checkbox` wire-format type from `app.js`, `index.html`, test server, and tests. `switch` is the sole boolean field type moving forward.

**Architecture:** Simplify three expressions in `app.js` — the `|| type === 'switch'` dual-type guards become single-type guards. Remove dead CSS from `index.html`. Convert test server GPIO fields from `"checkbox"` to `"switch"`. Capture the pre-cleanup state on branch `checkpoint/checkbox` with an archival note, then clean main.

**Tech Stack:** JS (no frameworks), ES5, FastAPI test server, vitest unit tests, Playwright e2e tests.

---

### Task 1: Create archive branch with note

**Files:**
- Create: `docs/superpowers/archive/checkbox.md`
- Branch: `checkpoint/checkbox`

- [ ] **Step 1: Stash any uncommitted changes, then create the archive branch**

```bash
git stash
git checkout -b checkpoint/checkbox
```

- [ ] **Step 2: Create the archive note**

```bash
mkdir -p docs/superpowers/archive
```

Write to `docs/superpowers/archive/checkbox.md`:

```markdown
# Checkbox Type (archived)

## Why removed

`checkbox` and `switch` are redundant — both represent boolean values.
`switch` is the Pico-CSS-native on/off toggle and is visually more
appropriate for ESP32 settings. Keeping both added bytes to `app.js`
(dual-type guards) and `index.html` (checkbox-specific CSS workaround).

Removed in 2026-06-23. See `docs/superpowers/specs/2026-06-23-remove-checkbox-type.md`
for the full design.

## Future revival

If a multi-boolean group (dict of labeled booleans) is needed later, it
would warrant a new field type (e.g. `checkgroup`) with its own wire format:

```json
["checkgroup", "Features", {
  "options": [["verbose", "Verbose Logging", true],
              ["telnet", "Telnet", false]]
}]
```

This would render as a group of checkboxes under one legend. The current
`checkbox` type was a single boolean field — not this.
```

- [ ] **Step 3: Commit and push the archive branch**

```bash
git add docs/superpowers/archive/checkbox.md
git commit -m "arch: save checkbox state before removal"
```

- [ ] **Step 4: Switch back to master**

```bash
git checkout master
git stash pop
```

---

### Task 2: Remove dead CSS from `index.html`

**Files:**
- Modify: `index.html:34-39`

- [ ] **Step 1: Remove the checkbox-specific CSS rule**

In `index.html`, remove lines 34-39:

Old:

```css
      #config-form div:has(> [type="checkbox"]) > small {
        display: block;
        width: 100%;
        margin-bottom: var(--pico-spacing);
        color: var(--pico-muted-color);
      }
```

New: nothing (delete those 6 lines).

- [ ] **Step 2: Verify the file still parses**

Run: `node -e "require('fs').readFileSync('index.html','utf8'); console.log('ok')"` — should print `ok`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "remove dead checkbox CSS rule from index.html"
```

---

### Task 3: Simplify `serialize()` and `populateFromComponents()` in `app.js`

**Files:**
- Modify: `app.js:45`, `app.js:86`

- [ ] **Step 1: Simplify `serialize()` — drop `|| field.type === 'switch'`**

In `app.js` line 45, change:

```javascript
data[comp.id + '.' + field.key] = field.type === 'checkbox' || field.type === 'switch' ? el.checked
```

to:

```javascript
data[comp.id + '.' + field.key] = field.type === 'switch' ? el.checked
```

- [ ] **Step 2: Simplify `populateFromComponents()` — same change**

In `app.js` line 86, change:

```javascript
if (field.type === 'checkbox' || field.type === 'switch') {
```

to:

```javascript
if (field.type === 'switch') {
```

- [ ] **Step 3: Run unit tests to confirm nothing broke**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "remove checkbox dual-type guards from serialize/populateFromComponents"
```

---

### Task 4: Simplify `createField()` in `app.js`

**Files:**
- Modify: `app.js:690-693`

- [ ] **Step 1: Remove the conditional in `createField()`**

In `app.js`, the block at lines 690-704:

```javascript
if (type === 'checkbox' || type === 'switch') {
  var input = document.createElement('input');
  input.type = 'checkbox';
  if (type === 'switch') input.role = 'switch';
  input.name = input.id = namePrefix + '.' + key;
  if (opts.value) input.checked = true;
  applyAttrs(input, opts.attrs);
  var label = document.createElement('label');
  label.setAttribute('for', input.id);
  label.textContent = ' ' + labelText + (required ? '*' : '');
  var container = document.createElement('div');
  container.appendChild(input);
  container.appendChild(label);
  addHelperText(container, input.id, opts.tooltip, input);
  return container;
}
```

Change to:

```javascript
if (type === 'switch') {
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.role = 'switch';
  input.name = input.id = namePrefix + '.' + key;
  if (opts.value) input.checked = true;
  applyAttrs(input, opts.attrs);
  var label = document.createElement('label');
  label.setAttribute('for', input.id);
  label.textContent = ' ' + labelText + (required ? '*' : '');
  var container = document.createElement('div');
  container.appendChild(input);
  container.appendChild(label);
  addHelperText(container, input.id, opts.tooltip, input);
  return container;
}
```

Key changes:
- `if (type === 'checkbox' || type === 'switch')` → `if (type === 'switch')`
- `if (type === 'switch') input.role = 'switch'` → `input.role = 'switch'` (unconditional)

- [ ] **Step 2: Run unit tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all tests pass, especially `'creates switch (checkbox with role)'`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "remove checkbox code path from createField"
```

---

### Task 5: Update test server GPIO fields

**Files:**
- Modify: `test_server/main.py:25-26`

- [ ] **Step 1: Change GPIO fields from `"checkbox"` to `"switch"`**

Lines 25-26:

```python
        "enabled": ["checkbox", "GPIO Enabled", {"value": True, "tooltip": "Enable this GPIO pin"}],
        "inverted": ["checkbox", "Inverted", {"value": False, "tooltip": "Invert GPIO signal level"}],
```

Change to:

```python
        "enabled": ["switch", "GPIO Enabled", {"value": True, "tooltip": "Enable this GPIO pin"}],
        "inverted": ["switch", "Inverted", {"value": False, "tooltip": "Invert GPIO signal level"}],
```

- [ ] **Step 2: Verify Python test server still parses**

Run: `python3 -c "import json; from pathlib import Path; exec(open('test_server/main.py').read().split('@app')[0]); print('ok')"`

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add test_server/main.py
git commit -m "change GPIO fields from checkbox to switch in test server"
```

---

### Task 6: Update unit tests

**Files:**
- Modify: `tests/unit/app.test.js:1104-1131`

- [ ] **Step 1: Update the checkbox echo resolution test**

Replace the entire describe block at lines 1104-1132:

Old:

```javascript
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
```

New:

```javascript
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
```

Changes:
- `type: 'checkbox'` → `type: 'switch'` (field definition)
- `['checkbox', ...` → `['switch', ...` (server push payload)
- `'echo resolution with checkbox...'` → `'echo resolution with switch...'`
- `'echo match with checkbox...'` → `'echo match with switch...'`

- [ ] **Step 2: Run unit tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "update unit tests: checkbox -> switch"
```

---

### Task 7: Update e2e test description

**Files:**
- Modify: `tests/e2e/app.test.js:82`

- [ ] **Step 1: Update test description**

Line 82, change:

```javascript
  test('Save appears after toggling checkbox', async ({ page }) => {
```

to:

```javascript
  test('Save appears after toggling switch', async ({ page }) => {
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "update e2e test description: checkbox -> switch"
```

---

### Task 8: Update spec document

**Files:**
- Modify: `docs/superpowers/specs/2026-06-18-unified-settings-design.md:58`

- [ ] **Step 1: Remove `checkbox` from supported types list**

Line 58, change:

```
  `checkbox`, `switch`, `radio`, `select`, `range`, `textarea`
```

to:

```
  `switch`, `radio`, `select`, `range`, `textarea`
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-18-unified-settings-design.md
git commit -m "remove checkbox from supported types in design spec"
```

---

### Task 9: Build and final verification

- [ ] **Step 1: Run the full build**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run build
```

Expected: exits 0, produces `app.min.js`.

- [ ] **Step 2: Run all unit tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run test:unit
```

Expected: all pass.

- [ ] **Step 3: Run e2e tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npx playwright install chromium && npm run test:e2e
```

Expected: all pass.

- [ ] **Step 4: Verify the archive branch exists**

```bash
git branch --list checkpoint/checkbox
```

Expected: shows `checkpoint/checkbox`.
