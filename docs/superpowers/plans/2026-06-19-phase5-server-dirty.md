# Phase 5: Server-Owned `_dirty` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JS uses the server's `_dirty` flag to drive the Save & Apply button state, and `_modified` (FV ≠ AV) to drive the Apply button state, with the test server tracking `_dirty` internally.

**Architecture:** The ESP32 test server already computes `_dirty` as `nvs_store != applied_store` and includes it in the `/api/settings` response. The JS needs to (1) capture `_dirty` from the response, (2) use it in `updateUI()` to control `btnSaveApply` independently from `btnApply`, and (3) handle the edge case where `handleSaveApply()` is called with no local pending changes but `_dirty` is true. Unit and e2e tests verify the new button logic and dirty transitions.

**Tech Stack:** Vanilla JS (no dependencies), vitest (unit tests), Playwright (e2e), FastAPI (test server), pytest (server tests)

---

## File Structure

| File | Role | Change |
|---|---|---|
| `app.js` | Main JS application | Add `dirty` var, capture from server, separate button logic, update save handler |
| `tests/unit/app.test.js` | Vitest unit tests | Update for new button logic, add dirty tracking tests |
| `tests/e2e/app.test.js` | Playwright e2e tests | Add dirty transition tests |
| `test_server/test_main.py` | Pytest server tests | Add dirty transition tests + auto-reset fixture |
| `test_server/main.py` | FastAPI test server | No changes needed (already computes `_dirty`) |

---

### Task 1: Add `_dirty` server tests and auto-reset fixture

**Files:**
- Modify: `test_server/test_main.py`

**Goal:** Verify `_dirty` transitions correctly through the apply → save → reset lifecycle, with tests isolated by an auto-reset fixture.

- [ ] **Step 1: Add auto-reset fixture and dirty tests**

Add to `test_server/test_main.py`. Insert imports and fixture at the top, then add test functions at the bottom:

```python
import pytest

# Add after existing imports (no duplicate imports of TestClient/app)
# Replace the `from fastapi.testclient import TestClient` line with:
from fastapi.testclient import TestClient
from test_server.main import app
import pytest

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_before_each():
    client.get("/api/settings/reset")
    yield


# ... all existing tests remain unchanged ...


def test_dirty_false_initially():
    data = client.get("/api/settings").json()
    assert data["_dirty"] is False


def test_dirty_true_after_apply():
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is True


def test_dirty_false_after_save():
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is True
    client.post("/api/settings/save", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is False


def test_dirty_false_after_reset():
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is True
    client.get("/api/settings/reset")
    data = client.get("/api/settings").json()
    assert data["_dirty"] is False
```

- [ ] **Step 2: Run server tests to verify**

Run: `pip install -q fastapi uvicorn pytest httpx && python -m pytest test_server/test_main.py -v`

Expected: all 11 tests pass (4 new + 7 existing).

- [ ] **Step 3: Commit**

```bash
git add test_server/test_main.py
git commit -m "test: add _dirty transition tests to test server"
```

---

### Task 2: Add `dirty` variable and capture from server response in JS

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add module-level `dirty` variable**

Insert after line 13 (`var components = [];`):

```javascript
var dirty = false;
```

- [ ] **Step 2: Capture `_dirty` in `loadSettings`**

In `loadSettings`, after `var data = await res.json();` (line 203), before the `var comps = [];` line:

```javascript
      dirty = data._dirty === true;
```

The `_dirty` key is skipped by the `if (key[0] === '_') continue;` guard that follows, so this must be done before the iteration loop.

- [ ] **Step 3: Capture `_dirty` in `refreshComponents`**

In `refreshComponents`, after `var data = await res.json();` (line 83), before the components loop:

```javascript
      dirty = data._dirty === true;
```

- [ ] **Step 4: Expose `dirty` for test access**

Add to the test-expose line (line ~422), inserting `dirty` into `__test`:

```javascript
Object.defineProperty(window.__test,'dirty',{get:function(){return dirty},set:function(v){dirty=v}});
```

Append it to the existing `window.__test={};Object.defineProperty...` expression:

```javascript
/* test-expose */if(window.__TEST_MODE){window.serialize=serialize;window.setBaseline=setBaseline;window.getPending=getPending;window.createField=createField;window.populateFromComponents=populateFromComponents;window.applyAttrs=applyAttrs;window.updateUI=updateUI;window.showError=showError;window.clearError=clearError;window.postJSON=postJSON;window.loadSettings=loadSettings;window.refreshComponents=refreshComponents;window.syncThen=syncThen;window.handleSaveApply=handleSaveApply;window.handleApply=handleApply;window.handleReset=handleReset;window.renderNav=renderNav;window.renderForm=renderForm;window.handleHash=handleHash;window.wireButtons=wireButtons;window.bindChangeListeners=bindChangeListeners;window.init=init;window.buildPatch=buildPatch;window.__test={};Object.defineProperty(window.__test,'components',{get:function(){return components},set:function(v){components=v}});Object.defineProperty(window.__test,'dirty',{get:function(){return dirty},set:function(v){dirty=v}});}
```

- [ ] **Step 5: Verify build still works**

Run: `npm run build`

Expected: `app.min.js` generated without errors.

- [ ] **Step 6: Run unit tests to verify no regressions**

Run: `npm run test:unit`

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add app.js app.min.js
git commit -m "feat: add dirty var and capture from /api/settings response"
```

---

### Task 3: Separate Save & Apply button state from Apply/Reset

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Update `updateUI` for independent button logic**

Replace the `updateUI` function (lines 103-112) with:

```javascript
  function updateUI() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    var modified = count > 0;
    var formOk = configForm.checkValidity();
    btnApply.disabled = btnReset.disabled = !(modified && formOk);
    btnSaveApply.disabled = !(dirty && formOk);
    footer.classList.toggle('pending', modified && formOk);
    pendingCount.textContent = modified ? count + ' pending change(s)' : '';
  }
```

Key changes:
- `btnSaveApply` is driven by `dirty && formOk` instead of `modified && formOk`
- `btnApply` and `btnReset` remain driven by `modified && formOk`
- `footer.pending` class still tracks local modifications only

- [ ] **Step 2: Update `handleSaveApply` for dirty-without-pending edge case**

Replace the `handleSaveApply` function (lines 167-175) with:

```javascript
  function handleSaveApply() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    if (count === 0 && !dirty) return;
    var body = count > 0 ? buildPatch(changes) : buildPatch(serialize());
    postJSON('/api/settings/save', body).then(function (ok) {
      if (ok) syncThen(true);
    });
  }
```

When there are pending changes, only those are sent (same as before). When there are no pending changes but `_dirty` is true, the current form values (which equal the applied values) are sent so the server can persist them to NVS.

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: `app.min.js` generated.

- [ ] **Step 4: Run unit tests**

Run: `npm run test:unit`

Expected: tests may fail because unit tests check button states. They will be fixed in Task 4.

- [ ] **Step 5: Commit**

```bash
git add app.js app.min.js
git commit -m "feat: use server _dirty for Save & Apply, _modified for Apply"
```

---

### Task 4: Update unit tests for Phase 5 behavior

**Files:**
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Update `updateUI` tests**

Replace the `updateUI` describe block (lines 86-115) to test independent button states:

```javascript
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
    expect(document.getElementById('btn-apply').disabled).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })

  it('enables Apply and Reset when pending changes exist', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-apply').disabled).toBe(false)
    expect(document.getElementById('btn-reset').disabled).toBe(false)
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('enables Save & Apply when dirty is true', () => {
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(false)
    expect(document.getElementById('btn-apply').disabled).toBe(true)
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })

  it('enables both Save & Apply and Apply when dirty and pending', () => {
    window.__test.dirty = true
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(false)
    expect(document.getElementById('btn-apply').disabled).toBe(false)
  })

  it('disables buttons when form is invalid', () => {
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
    expect(document.getElementById('btn-apply').disabled).toBe(true)
  })

  it('disables Apply when pending is reverted', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-apply').disabled).toBe(false)
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.updateUI()
    expect(document.getElementById('btn-apply').disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Add `_dirty` capture test to `loadSettings`**

Add to the `loadSettings` describe block (after line 349, before the `renderNav` describe):

```javascript
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
```

- [ ] **Step 3: Add `_dirty` capture test to `refreshComponents`**

Add to the `refreshComponents` describe block (after line 467, before the `syncThen` describe):

```javascript
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
```

- [ ] **Step 4: Update `handleSaveApply` test**

Replace the `handleSaveApply` describe block (lines 546-567) with:

```javascript
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
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'saved' }] } }) } })
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
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: '' }] } }) } })
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
```

- [ ] **Step 5: Update mock responses that lack `_dirty`**

In `syncThen` tests (lines 470-495), update the mock fetch to include `_dirty: false`:

```javascript
    window.fetch = function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'new' }] } }) } })
    }
```

In `handleApply` test (lines 513-543), update the GET mock:

```javascript
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'changed' }] } }) } })
```

In `handleReset` test (lines 569-588), update the GET mock:

```javascript
    window.fetch = function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ _dirty: false, wifi: { ssid: ['text', 'SSID', { value: 'baseline' }] } }) } })
    }
```

In `init` test (lines 591-617), update the fetch mock's settings response to include `_dirty: false`:

```javascript
            _dirty: false,
            wifi: { ssid: ['text', 'SSID', { value: '', tooltip: 'Net name' }] },
```

It already has `_dirty: false` — no change needed. (Search the existing file. Line 603 already has `_dirty: false`.)

- [ ] **Step 6: Run unit tests**

Run: `npm run test:unit`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: update unit tests for _dirty button logic"
```

---

### Task 5: Update e2e tests for Phase 5 behavior

**Files:**
- Modify: `tests/e2e/app.test.js`

- [ ] **Step 1: Add `_dirty` transition tests**

Add after the `Button actions` describe block (after line 229):

```javascript
test.describe('Dirty flag behavior', () => {
  test('Save & Apply disabled initially (not dirty)', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
  })

  test('Save & Apply enabled after apply (dirty becomes true)', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('DirtyTest')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
  })

  test('Save & Apply clears dirty flag after save', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('DirtyTest')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await page.locator('#btn-save-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
  })

  test('Apply still works after dirty is set', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('First')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await page.locator('[name="wifi.ssid"]').fill('Second')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await expect(page.locator('#pending-count')).toHaveText('')
  })

  test('reset after save still works', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('SaveMe')
    await page.locator('#btn-apply').click()
    await page.waitForTimeout(500)
    await page.locator('#btn-save-apply').click()
    await page.waitForTimeout(500)
    await page.locator('[name="wifi.ssid"]').fill('ChangeAgain')
    await page.locator('#btn-reset').click()
    await page.waitForTimeout(500)
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('SaveMe')
  })
})
```

- [ ] **Step 2: Update `init` test expectation for `Save & Apply`**

In the `Form rendering` → `no pending changes initially` test (lines 123-129), the expectations already check all three buttons are disabled initially. Since `_dirty` is false on a fresh load, `btn-save-apply` should still be disabled. No change needed.

In the `Pending detection` tests, `btn-apply` should still enable/disable based on pending. No change needed since these tests only check Apply/Reset/pending-count, not Save & Apply state.

- [ ] **Step 3: Run e2e tests**

Run: `npm run test:e2e`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "test: add e2e tests for _dirty transitions"
```

---

### Task 6: Final build and verification

**Files:** (none — full verification run)

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: unit tests pass, e2e tests pass.

Run: `python -m pytest test_server/test_main.py -v`

Expected: 11 tests pass.

- [ ] **Step 2: Build minified JS**

Run: `npm run build`

Expected: `app.min.js` generated without errors.

- [ ] **Step 3: Commit any final changes**

If the build updated `app.min.js` and it's not already committed:

```bash
git add app.min.js
git commit -m "chore: rebuild app.min.js after Phase 5 changes"
```
