# Fix Radio Button Dirty State Tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Save button disappearing after clicking a second radio button, caused by two bugs: `readFormValue` returns the wrong value for radio groups, and `dirty` is corrupted by dropped WebSocket messages. Also add a checkbox field to the test server and verify checkbox handling in `readFormValue`.

**Architecture:** Two changes in `app.js`: (1) add `:checked` handling for radio inputs in `readFormValue`, matching `serialize()` line 46; (2) move `dirty = dirtyFlag` to after the inFlight guard so dropped messages don't corrupt state, and inline `msg._dirty` to eliminate the `dirtyFlag` temp variable. Add a `checkbox` field to the GPIO component in `test_server/main.py`. Tests added in unit and e2e suites covering radio, checkbox, and the dirty-flag cascade.

**Tech Stack:** Vanilla JS, Vitest (unit), Playwright (e2e)

---

### Task 1: Fix `readFormValue` to return the checked radio value

**Files:**
- Modify: `app.js:451-457`
- Test: `tests/unit/app.test.js` (append new `describe` block)

- [ ] **Step 1: Add unit tests for `readFormValue` with radio inputs**

Append this to `tests/unit/app.test.js` just before the footer visibility test (before line 999):

```js
describe('readFormValue', () => {
  beforeEach(() => {
    document.querySelector('#config-form').innerHTML = [
      '<input type="radio" name="gpio.pull" value="none" checked />',
      '<input type="radio" name="gpio.pull" value="up" />',
      '<input type="radio" name="gpio.pull" value="down" />',
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
```

- [ ] **Step 2: Run unit tests to verify the new tests fail**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: The radio tests in `readFormValue` fail because `readFormValue` returns the first radio's value, not the checked one.

- [ ] **Step 3: Implement the fix in `app.js`**

Replace `readFormValue` (lines 451-457):
```js
  function readFormValue(parts) {
    var el = document.querySelector('[name="' + parts.join('.') + '"]');
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  }
```

With:
```js
  function readFormValue(parts) {
    var nameSel = '[name="' + parts.join('.') + '"]';
    var el = document.querySelector(nameSel);
    if (!el) return undefined;
    if (el.type === 'radio') {
      var checked = document.querySelector(nameSel + ':checked');
      return checked ? checked.value : undefined;
    }
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  }
```

- [ ] **Step 4: Run unit tests to verify the new tests pass and nothing else broke**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: All tests pass, including the 4 new `readFormValue` tests.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "fix: readFormValue returns checked radio value, not first radio; add radio/checkbox unit tests"
```

---

### Task 2: Defer `dirty` assignment and remove `dirtyFlag` temp variable

**Files:**
- Modify: `app.js:252-254,272,302,307`

- [ ] **Step 1: Ensure Task 1 is committed and tests pass**

```bash
npx vitest run 2>&1 | tail -10
```

- [ ] **Step 2: Add defense-in-depth unit test for dirty flag not corrupted by dropped WS messages**

Append this to `tests/unit/app.test.js` after the `readFormValue` describe block:

```js
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
```

- [ ] **Step 3: Run unit tests to verify the new test fails**

```bash
npx vitest run --reporter verbose 2>&1 | grep -A 5 "dirty flag survives"
```

Expected: FAIL — `dirty` is set to `false` because line 254 runs unconditionally before the message is dropped.

- [ ] **Step 4: Defer `dirty` assignment and eliminate `dirtyFlag` variable**

In `onWSMessage` (`app.js`), make four changes:

**Change 1:** Drop the `dirtyFlag` temp variable and the unconditional `dirty` assignment. Change lines 252-254 from:
```js
    var dirtyFlag = msg._dirty;
    var data = msg.data || msg;
    dirty = dirtyFlag;
```
To:
```js
    var data = msg.data || msg;
```

**Change 2:** Set `dirty` from `msg._dirty` at the start of the echo-matched block. Change lines 272-273 from:
```js
    if (echoMatched) {
      // Case 7: Echo received + user already changed value again → send queued input
      var queuedKeys = [];
```
To:
```js
    if (echoMatched) {
      dirty = msg._dirty;
      // Case 7: Echo received + user already changed value again → send queued input
      var queuedKeys = [];
```

**Change 3:** Set `dirty` from `msg._dirty` after the Phase 2 return guard, before Phase 3. Change lines 298-302 from:
```js
    // ━━━ Phase 2: In-flight defer ━━━ (Cases 8-10)
    // Cases 8-10: Ignore packet while waiting for echo
    var hasInFlight = false;
    for (var k in inFlight) { if (inFlight[k]) { hasInFlight = true; break; } }
    if (hasInFlight) return;
```
To:
```js
    // ━━━ Phase 2: In-flight defer ━━━ (Cases 8-10)
    // Cases 8-10: Ignore packet while waiting for echo
    var hasInFlight = false;
    for (var k in inFlight) { if (inFlight[k]) { hasInFlight = true; break; } }
    if (hasInFlight) return;

    dirty = msg._dirty;
```

**Change 4:** In the initial-load path, replace `dirtyFlag` with `msg._dirty`. Change line 307 from:
```js
      processSettings(data, dirtyFlag);
```
To:
```js
      processSettings(data, msg._dirty);
```

- [ ] **Step 5: Run unit tests to verify the new test passes and nothing else broke**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: All tests pass, including the new defense-in-depth test.

- [ ] **Step 6: Rebuild minified JS and verify build succeeds**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add app.js app.min.js tests/unit/app.test.js
git commit -m "fix: defer dirty assignment after inFlight guard; remove dirtyFlag temp var"
```

---

### Task 3: Add echo-resolution unit test for radio (no spurious queued keys)

**Files:**
- Test: `tests/unit/app.test.js` (append new `describe` block)

- [ ] **Step 1: Add unit test that simulates the full echo cycle with radio**

Append this to `tests/unit/app.test.js`:

```js
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
```

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx vitest run --reporter verbose 2>&1 | grep -A 5 "echo resolution with radio"
```

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npx vitest run 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: verify echo resolution does not trigger spurious queued keys for radio"
```

---

### Task 4: Add e2e test for radio save button visibility

**Files:**
- Test: `tests/e2e/app.test.js` (append new test case)

- [ ] **Step 1: Add e2e test for radio click sequence**

Insert this test inside the `test.describe('Save & Apply button', ...)` block in `tests/e2e/app.test.js`, after the existing `Save & Apply clears dirty after save` test (after line 64):

```js
  test('Save stays visible after multiple radio changes', async ({ page }) => {
    await page.goto('/#gpio')
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeHidden()
    await page.locator('#gpio\\.pull\\.up').check()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeVisible()
    await page.locator('#gpio\\.pull\\.down').check()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeVisible()
  })
```

- [ ] **Step 2: Run e2e tests**

```bash
npm run test:e2e 2>&1 | tail -30
```

Expected: The new test passes — Save button stays visible after second radio click.

- [ ] **Step 3: Run the full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: All unit and e2e tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "test: e2e test for save button visibility across multiple radio changes"
```

---

### Task 5: Add checkbox field to test server GPIO component

**Files:**
- Modify: `test_server/main.py:21-26`
- Test: `tests/unit/app.test.js` (append new `describe` block)
- Test: `tests/e2e/app.test.js` (append new test case)

- [ ] **Step 1: Add `enabled` checkbox field to GPIO in `test_server/main.py`**

Add a new field `"enabled"` after the `"pull"` field definition (line 24), so the GPIO group is:

```python
    "gpio": {
        "pin": ["number", "Pin Number", {"attrs": {"min": 0, "max": 39, "placeholder": "0"}, "value": 2, "tooltip": "GPIO pin number"}],
        "direction": ["select", "Direction", {"options": [["input", "Input"], ["output", "Output"]], "value": "output", "tooltip": "Pin direction"}],
        "pull": ["radio", "Pull Resistor", {"options": [["none", "None"], ["up", "Pull Up"], ["down", "Pull Down"]], "value": "none", "tooltip": "Internal pull resistor"}],
        "enabled": ["checkbox", "GPIO Enabled", {"value": True, "tooltip": "Enable this GPIO pin"}],
        "initial": ["select", "Initial State", {"options": [["low", "Low"], ["high", "High"]], "value": "low", "tooltip": "Initial output state"}],
    },
```

- [ ] **Step 2: Add unit test for checkbox echo resolution (no spurious queued keys)**

Append this to `tests/unit/app.test.js`:

```js
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

- [ ] **Step 3: Add e2e test for checkbox toggle and save button**

Insert this test inside `test.describe('Save & Apply button', ...)` in `tests/e2e/app.test.js`:

```js
  test('Save appears after toggling checkbox', async ({ page }) => {
    await page.goto('/#gpio')
    await page.waitForTimeout(500)
    await expect(page.locator('[name="gpio.enabled"]')).toBeChecked()
    await page.locator('[name="gpio.enabled"]').uncheck()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeVisible()
  })
```

- [ ] **Step 4: Run unit and e2e tests for checkbox**

```bash
npx vitest run 2>&1 | tail -20
npm run test:e2e 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add test_server/main.py tests/unit/app.test.js tests/e2e/app.test.js
git commit -m "feat: add checkbox field to GPIO; add checkbox tests for readFormValue and echo resolution"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite one final time**

```bash
npm test
```

- [ ] **Step 2: Verify build produces correct minified output**

```bash
npm run build
ls -la app.min.js
```

- [ ] **Step 3: Verify no `console.log` or debug code remains**

```bash
grep -n 'console\.log' app.js || echo "No console.log found — clean"
```
