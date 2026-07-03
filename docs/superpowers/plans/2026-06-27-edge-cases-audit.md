# Edge Cases & Concurrent Update Harden

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs (WS disconnect data loss, prompt overwrite, aria-busy never cleared), three code smells (comparison inconsistency, serialize type mismatch, missing null-guards), and add coverage for 6 untested edge cases.

**Architecture:** All client logic lives in a single 912-line IIFE (`app.js`). Tests are vitest+jsdom in `tests/unit/app.test.js` — the setup file evals `app.js` with `__TEST_MODE=true`, exposing all functions via `window.*` and state via `window.__test.*`. The WebSocket mock supports `window.__test.receiveWSMessage(msg)` and `window.__test.onWSSend` capture. The Python test server at `test_server/main.py` serves as the e2e backend.

**Tech Stack:** Vanilla JS (ES5), vitest+jsdom, PicoCSS v2, Python test server (FastAPI), Playwright e2e.

**Spec references:**
- Backlog item 5: `docs/superpowers/specs/2026-06-23-backlog-triage.md` lines 70-79
- State machine design: `docs/superpowers/specs/2026-06-18-unified-settings-design.md` lines 167-276

---

## File Structure

| File | Change |
|---|---|
| `app.js` | Fix bugs + smells (~25 changed lines net) |
| `tests/unit/app.test.js` | Add tests (~180 lines new) |

No new files. No docs changes.

**Task dependency note:** Tasks 1-3 all modify `onWSMessage` and must be executed in order. Tasks 4-7 are independent of each other and of Tasks 1-3 (they modify different functions/areas). Task 8 runs last as a full regression check.

---

### Task 1: Fix WS disconnect data loss (+ tests)

**Context:** When WS drops while a field has `inFlight=true`, the stale `inFlight`/`lastSent` state survives. On reconnect, the settings push hits echo resolution (no match because the echo never came), then hits `hasInFlight=true` check at line 372 and returns — silently discarding the server push. The user's form shows their pending change, but it was never applied and will never be re-sent.

**Fix:** Replace lines 370-372 (`if (hasInFlight) return;`) with a reconciliation block that clears `inFlight`/`lastSent`, updates AV from server data, re-sends any fields whose form value differs from the server, and re-baselines.

**Files:**
- Modify: `app.js:370-372`
- Test: `tests/unit/app.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// In tests/unit/app.test.js, after the 'WS reconnect' block (line 1024),
// add a new describe block:

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

  it('clears inFlight on reconnect with stale tracking', function () {
    // Server pushes settings with the same AV as before (our change was lost)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'serverVal' }] },
      }),
    })
    expect(window.__test.inFlight['wifi.ssid']).toBe(false)
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
    // After re-sending "userChange", lastSent should be updated
    expect(window.__test.lastSent['wifi.ssid']).toBe('userChange')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "WS disconnect while in-flight"
```

Expected: All 4 tests FAIL — the WS reconnect path drops the message and our `inFlight` stays true.

- [ ] **Step 3: Implement the fix in app.js**

Replace lines 370-372 in `app.js` (the `hasInFlight` check + return):

```js
    var hasInFlight = false;
    for (var k in inFlight) { if (inFlight[k]) { hasInFlight = true; break; } }
    if (hasInFlight) {
      dirty = msg._dirty;
      updateAV(data);
      for (var ci = 0; ci < components.length; ci++) {
        var comp = components[ci];
        if (!comp.fields) continue;
        for (var fi = 0; fi < comp.fields.length; fi++) {
          var field = comp.fields[fi];
          var key = comp.id + '.' + field.key;
          var fv = readFormValue([comp.id, field.key]);
          if (fv !== undefined && String(fv) !== String(field.opts.value)) {
            sendToServer(key, fv);
          }
        }
      }
      for (var sk in inFlight) { inFlight[sk] = false; }
      for (var sk in lastSent) { lastSent[sk] = undefined; }
      setBaseline();
      updateUI();
      configForm.removeAttribute('aria-busy');
      return;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "WS disconnect while in-flight"
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "fix: recover pending form changes on WS reconnect"
```

---

### Task 2: Fix settings push overwriting visible prompt (+ test)

**Context:** When a conflict or external notification prompt is already visible (e.g. Case 5 or Case 3), a subsequent settings push calls `showConflictPrompt`/`showExternalNotification`, replacing the current prompt's text and buttons. This confuses the user — the prompt shifts under them.

**Fix:** Before showing a new prompt, check if the notification bar (`#server-changed`) is already visible. If so, skip showing the new prompt — the `updateAV()` call at line 402 already updated the in-memory AV, and the user's pending decision on the current prompt will correctly reconcile state when clicked.

**Files:**
- Modify: `app.js:415-422`
- Test: `tests/unit/app.test.js`

- [ ] **Step 1: Write the failing test**

Add to existing test suite, after the 'dirty flag survives dropped WS messages' block:

```js
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
    // First push: triggers conflict prompt (Case 5)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'externalVal' }] },
      }),
    })
    // Conflict prompt should now be visible with keep-local button
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)

    // Second push: another external change while prompt is visible
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'thirdVal' }] },
      }),
    })
    // AV was updated silently (field.opts.value = 'thirdVal')
    expect(window.__test.components[0].fields[0].opts.value).toBe('thirdVal')
    // But the prompt should still show the original conflict (keep-local still visible)
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)
  })

  it('does not overwrite visible external notification with a conflict prompt', function () {
    // Set up idle state: FV == oldAV
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="oldVal" />'
    // First push: external notification (Case 3)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'extVal' }] },
      }),
    })
    expect(document.getElementById('notif-load').hidden).toBe(false)

    // Second push: would be a conflict if shown (FV oldVal !== newAV thirdVal)
    window.__test.receiveWSMessage({
      data: JSON.stringify({
        _dirty: false,
        wifi: { ssid: ['text', 'SSID', { value: 'thirdVal' }] },
      }),
    })
    // Original load/keep buttons still visible, not overwritten by conflict prompt
    expect(document.getElementById('notif-load').hidden).toBe(false)
    expect(document.getElementById('notif-keep').hidden).toBe(false)
    // Conflict buttons still hidden
    expect(document.getElementById('notif-keep-local').hidden).toBe(true)
    expect(document.getElementById('notif-accept-server').hidden).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "settings push during visible prompt"
```

Expected: Both tests FAIL — the second push overwrites the prompt.

- [ ] **Step 3: Implement the fix in app.js**

Modify the if/else chain at lines 415-422:

```js
    var notifBar = document.getElementById('server-changed');
    var promptActive = notifBar && !notifBar.hidden;

    if (conflicts.length > 0) {
      if (!promptActive) showConflictPrompt(conflicts);
    } else if (externalFields.length > 0) {
      if (!promptActive) showExternalNotification(externalFields);
    } else {
      applyAV();
      syncLS();
    }
```

Note: `updateAV(data)` already ran at line 402, so even when the prompt is active the AV in memory is up-to-date. When the user clicks a button on the current prompt, the resolution handler will use the correct latest AV.

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "settings push during visible prompt"
```

Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "fix: prevent settings push from overwriting visible prompt"
```

---

### Task 3: Fix `aria-busy` never cleared on reconnect (+ test)

**Context:** `configForm.removeAttribute('aria-busy')` only runs in `processSettings()` (line 264), which is called only on initial load (line 377: `if (components.length === 0)`). On reconnect, the normal state machine path runs, but none of those paths remove `aria-busy`. PicoCSS v2 excludes `<form>` from the spinner (`:not(...form)` in CSS), so it's not visually stuck, but it's semantically wrong and e2e tests that wait on `#config-form:not([aria-busy])` would fail on reconnect.

**Fix:** Remove `aria-busy` in three reconnect paths: (1) echo-matched path, (2) stale inFlight reconciliation (already added in Task 1), (3) after normal `applyAV()`.

**Files:**
- Modify: `app.js:264, 367`
- Test: `tests/unit/app.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
    // lastSent differs from push value, so echo matching fails
    // and the stale inFlight reconciliation (Task 1) runs instead
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
    // echo matching clears inFlight
    expect(document.getElementById('config-form').hasAttribute('aria-busy')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "aria-busy lifecycle"
```

Expected: All 3 tests FAIL.

- [ ] **Step 3: Implement the fix in app.js**

Four additions — each covers a different return path in `onWSMessage`:

**Place 1 — echo-matched path** (add between `updateUI()` and `return` in the `if (echoMatched)` block at line 367):

```js
      updateAV(data);
      setBaseline();
      updateUI();
      configForm.removeAttribute('aria-busy');
      return;
```

**Place 2 — stale inFlight reconciliation** (already included in Task 1's replacement code — `configForm.removeAttribute('aria-busy')` is called right before `return` in the `hasInFlight` block). No separate edit needed.

**Place 3 — no changed fields on reconnect** (the early return at line 400 needs to clear aria-busy first):

Change:
```js
    if (Object.keys(changedFields).length === 0) return;
```

To:
```js
    if (Object.keys(changedFields).length === 0) {
      configForm.removeAttribute('aria-busy');
      return;
    }
```

**Place 4 — normal state machine path** (add after the if/else chain at line 422, before the function's closing `}`):

```js
    if (conflicts.length > 0) {
      if (!promptActive) showConflictPrompt(conflicts);
    } else if (externalFields.length > 0) {
      if (!promptActive) showExternalNotification(externalFields);
    } else {
      applyAV();
      syncLS();
    }
    configForm.removeAttribute('aria-busy');
```

This position runs after all three branches (conflict, notification, or quiet apply), which is correct — the form is done loading even when a prompt is shown. The echo-matched, stale-inFlight, and no-changed-fields paths have their own `return` statements, so they're handled by Places 1, 2, and 3.

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "aria-busy lifecycle"
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "fix: clear aria-busy on all reconnect paths"
```

---

### Task 4: Fix comparison inconsistency in `onUserInput`

**Context:** `onUserInput` at line 494 uses `JSON.stringify()` to compare form values with `lastSent`. The echo matching at line 342 uses `String()`. For all current value types (string, number, boolean, null) both produce identical comparison results, but `JSON.stringify` is slower, adds bytes, and the inconsistency is a maintenance trap.

**Fix:** Replace `JSON.stringify` with `String` in `onUserInput`. No behavioral change — this is a pure refactor. Existing `onUserInput` tests verify no regression.

**Files:**
- Modify: `app.js:494`

- [ ] **Step 1: Implement the fix**

In `app.js` line 494, change:

```js
if (JSON.stringify(newValue) === JSON.stringify(ls)) return;
```

to:

```js
if (String(newValue) === String(ls)) return;
```

- [ ] **Step 2: Run existing tests to verify no regression**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "onUserInput"
```

Expected: All 4 existing `onUserInput` tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "refactor: normalize onUserInput comparison to String (consistent with echo matching)"
```

---

### Task 5: Refactor `serialize` to use `readFormValue` for type consistency

**Context:** `serialize()` returns `el.value` for number/range fields (always strings). `readFormValue()` returns `parseFloat(el.value)` for number/range (numbers). They're never directly compared (both systems are internally consistent), but `handleSaveApply` sends strings for number fields via `buildPatch` while `sendToServer` sends numbers via `readFormValue` — an inconsistent wire format. Also, the hand-rolled type dispatch in `serialize` (15 lines) duplicates the logic in `readFormValue`.

**Fix:** Refactor `serialize` to delegate to `readFormValue`, with a fallback for radio's `undefined` → `null`. This ensures consistent types in all code paths and saves 5 lines.

**Files:**
- Modify: `app.js:39-54`
- Test: `tests/unit/app.test.js`

- [ ] **Step 1: Write a test that will catch the improvement**

Add to the existing `serialize` describe block:

```js
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
```

- [ ] **Step 2: Run the failing test**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "serialize"
```

Expected: The two new tests FAIL — current `serialize` returns `"7"` (string) not `7` (number).

- [ ] **Step 3: Implement the refactor**

Replace the entire `serialize` function (lines 39-54):

```js
  function serialize() {
    var data = {};
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var val = readFormValue([comp.id, field.key]);
        data[comp.id + '.' + field.key] = val === undefined
          ? (field.type === 'radio' ? null : '')
          : val;
      }
    }
    return data;
  }
```

This replaces 15 lines with 10 lines. The `readFormValue` handles all type coercion:
- checkbox: `indeterminate ? null : el.checked`
- radio: `checked ? checked.value : undefined` → we convert `undefined` to `null`
- number/range: `parseFloat(el.value)`
- all others: `el.value`

- [ ] **Step 4: Update existing serialize test expectations**

The two existing tests expect string `'6'` for the range field. After the refactor, range fields return numbers. Update lines 32 and 48 in `tests/unit/app.test.js`:

Line 32 — in `'returns current form values'`, change:
```js
      'wifi.channel': '6',
```
to:
```js
      'wifi.channel': 6,
```

Line 48 — in `'returns updated values after input change'`, change:
```js
      'wifi.channel': '6',
```
to:
```js
      'wifi.channel': 6,
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit
```

Expected: All tests PASS including the two new ones. Existing tests still pass because `readFormValue` handles all the same field types, just with correct numeric types for range/number fields now.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "refactor: delegate serialize to readFormValue for type consistency"
```

---

### Task 6: Add missing `fields` null-guards in `syncLS` and `updateAV`

**Context:** `syncLS` (line 456) and `updateAV` (line 435) both access `comp.fields.length` without null-checking `fields`. In practice `fields` is always set (every component created via `processSettings` has `fields`), but accessing `.length` on `undefined` would throw a TypeError.

**Fix:** Add `if (!comp.fields) continue;` guards in both functions.

**Files:**
- Modify: `app.js:456, 435`
- Test: `tests/unit/app.test.js`

- [ ] **Step 1: Write the failing tests**

```js
describe('null-guard: syncLS and updateAV', function () {
  beforeEach(function () {
    window.__test.components = [
      { id: 'wifi', fields: null },  // No fields array
    ]
    window.__test.lastSent = {}
    window.__test.inFlight = {}
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "null-guard"
```

Expected: Both tests FAIL — `syncLS` and `updateAV` throw TypeError on `null.length`.

- [ ] **Step 3: Implement the fix**

In `syncLS` (line 456), add guard before the inner loop:

```js
  function syncLS() {
    for (var ci = 0; ci < components.length; ci++) {
      var fs = components[ci].fields;
      if (!fs) continue;
      for (var fi = 0; fi < fs.length; fi++) {
```

In `updateAV` (line 435), add guard before the inner loop:

```js
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "null-guard"
```

Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "fix: add null-guard for missing fields in syncLS and updateAV"
```

---

### Task 7: Add tests for remaining untested edge cases

**Context:** The audit identified 6 edge cases that are already handled correctly by the code but have zero test coverage. These tests validate that the behavior works and prevent regressions.

**Files:**
- Test: `tests/unit/app.test.js` (append all three describe blocks at end of file, after line 1781)

- [ ] **Step 1: Add falsey value tests**

```js
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
```

- [ ] **Step 2: Add partial update test**

```js
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
```

- [ ] **Step 3: Add rapid blur test**

```js
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
```

- [ ] **Step 4: Run all new tests**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit -- -t "falsey values through echo matching|partial server update|rapid blur events"
```

Expected: All tests PASS (these are all already handled by existing code, just untested).

- [ ] **Step 5: Run full test suite to confirm nothing is broken**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: add coverage for falsey values, partial updates, and rapid blur"
```

---

### Task 8: Run full test suite

Run full test suite to catch any regressions across all changes:

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:unit
```

Expected: All tests PASS.

If any tests fail, debug and fix.

- [ ] **Commit**

```bash
git add -A
git commit -m "chore: finalize edge case audit - all tests passing"
```
