# Phase 6: WebSocket Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HTTP fetch for settings with a WebSocket connection. Apply-on-blur over WS. Server-push for external changes. Remove the Apply button. WS reconnect with error/retry UI.

**Architecture:** The test server gets a WS endpoint at `/api/settings/ws`. On connect it pushes full settings. On `apply` messages it updates applied state and broadcasts. The JS adds per-field state tracking (LS, inFlight, AV) and a state machine handling 10 cases (idle, local input, external update, coincidental sync, collision, echo, queued input, stale packet, revert, conflict). The Apply button is removed; Save & Apply remains HTTP POST. A notification bar and conflict prompt appear on server push events.

**Tech Stack:** Vanilla JS (no dep — browser native WebSocket API), FastAPI/Starlette built-in WebSocket support (no additional pip dep), vitest (unit tests), Playwright (e2e), pytest (server tests)

---

## File Structure

| File | Role | Change |
|---|---|---|
| `test_server/main.py` | FastAPI test server | Add WebSocket endpoint + external-change simulation endpoint |
| `test_server/test_main.py` | Server tests | Add WS endpoint tests |
| `index.html` | Static HTML | Remove Apply button, add notification bar, add aria-busy |
| `app.js` | Main JS application | WS connect, per-field state, apply-on-blur, server-push, notification UI, remove Apply, reconnect |
| `tests/unit/app.test.js` | Vitest unit tests | Remove/mock Apply button, add WS tests, update all button state tests |
| `tests/e2e/app.test.js` | Playwright e2e tests | Remove Apply button tests, add WS notification tests |
| `tests/setup.js` | Test environment | Mock WebSocket |

**IMPORTANT — execution order:** Task 2 (JS button cleanup) must run BEFORE Task 3 (HTML element removal). This prevents crashes from JS referencing DOM elements (`pendingCount`, `btnApply`) that have been removed.

---

### Task 1: Add WebSocket endpoint to test server

**Files:**
- Modify: `test_server/main.py`
- Modify: `test_server/test_main.py`

- [ ] **Step 1: Add WebSocket handler to test server**

Add WebSocket import and the WS endpoint to `test_server/main.py`. After the last POST endpoint, before the static file handler:

```python
from fastapi import WebSocket, WebSocketDisconnect

connected = set()

@app.websocket("/api/settings/ws")
async def settings_ws(ws: WebSocket):
    await ws.accept()
    connected.add(ws)
    try:
        # Push full settings on connect
        await ws.send_json(build_settings())
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            if msg.get("action") == "apply":
                for group_key, fields in msg.get("data", {}).items():
                    for field_key, field_arr in fields.items():
                        schema_entry = SETTINGS.get(group_key, {}).get(field_key)
                        if schema_entry is None:
                            continue
                        _, _, opts = schema_entry
                        opts["value"] = field_arr[2]["value"]
                # Broadcast updated state to all connected clients
                payload = build_settings()
                for client in list(connected):
                    try:
                        await client.send_json(payload)
                    except Exception:
                        connected.discard(client)
    except WebSocketDisconnect:
        pass
    finally:
        connected.discard(ws)
```

The `build_settings()` helper extracts the JSON body construction from `GET /api/settings` into a reusable function. Refactor the GET handler to use it:

```python
def build_settings():
    result = {}
    result["_dirty"] = nvs_store != applied_store
    for group_key, fields in SETTINGS.items():
        group = {}
        for field_key, (ftype, flabel, fopts) in fields.items():
            applied_val = applied_store.get(group_key, {}).get(field_key)
            entry = applied_store[group_key].get(field_key)
            value = entry if entry is not None else fopts.get("value")
            new_opts = dict(fopts)
            new_opts["value"] = value
            group[field_key] = [ftype, flabel, new_opts]
        result[group_key] = group
    return result


@app.get("/api/settings")
async def get_settings():
    return build_settings()
```

Change `@app.get("/api/settings")` to call `build_settings()` instead of inlining the construction.

- [ ] **Step 2: Add external-change simulation endpoint for testing**

Add to `test_server/main.py`:

```python
@app.post("/api/settings/external-change")
async def external_change(body: dict):
    """Simulate an external config change (for e2e testing of server-push)."""
    for group_key, fields in body.items():
        if group_key not in applied_store:
            continue
        for field_key, field_arr in fields.items():
            applied_store[group_key][field_key] = field_arr[2]["value"]
    payload = build_settings()
    for client in list(connected):
        try:
            await client.send_json(payload)
        except Exception:
            connected.discard(client)
    return {"ok": True}
```

- [ ] **Step 3: Write WS endpoint tests**

Add to `test_server/test_main.py`:

```python
def test_ws_connect_receives_settings():
    with client.websocket_connect("/api/settings/ws") as ws:
        data = ws.receive_json()
        assert "_dirty" in data
        assert "wifi" in data
        assert "gpio" in data


def test_ws_apply_updates_applied():
    with client.websocket_connect("/api/settings/ws") as ws:
        ws.receive_json()  # initial push
        ws.send_json({"action": "apply", "data": {"wifi": {"ssid": ["text", "SSID", {"value": "WSTest"}]}}})
        pushed = ws.receive_json()
        assert pushed["wifi"]["ssid"][2]["value"] == "WSTest"


def test_ws_apply_makes_dirty():
    with client.websocket_connect("/api/settings/ws") as ws:
        ws.receive_json()  # initial push
        ws.send_json({"action": "apply", "data": {"wifi": {"ssid": ["text", "SSID", {"value": "DirtyMaker"}]}}})
        pushed = ws.receive_json()
        assert pushed["_dirty"] is True


def test_external_change_broadcasts_to_all_clients():
    with client.websocket_connect("/api/settings/ws") as ws1, \
         client.websocket_connect("/api/settings/ws") as ws2:
        ws1.receive_json()
        ws2.receive_json()
        client.post("/api/settings/external-change", json={"wifi": {"ssid": ["text", "SSID", {"value": "ExtChange"}]}})
        data1 = ws1.receive_json()
        data2 = ws2.receive_json()
        assert data1["wifi"]["ssid"][2]["value"] == "ExtChange"
        assert data2["wifi"]["ssid"][2]["value"] == "ExtChange"
```

Run: `python -m pytest test_server/test_main.py -v`
Expected: 15 tests pass (4 new + existing).

- [ ] **Step 4: Commit**

```bash
git add test_server/main.py test_server/test_main.py
git commit -m "feat: add WebSocket endpoint and external-change simulation to test server"
```

---

### Task 2: Update button logic — remove Apply, update Save & Apply

**Files:**
- Modify: `app.js`
- Modify: `tests/unit/app.test.js`

**IMPORTANT:** This task runs BEFORE the HTML changes in Task 3. It removes all JS references to `btnApply` and `pendingCount` so those elements can be safely removed from the DOM in Task 3 without causing crashes.

- [ ] **Step 1: Remove Apply button references from updateUI**

Replace `updateUI`:

```javascript
  // Drives button states. Two independent conditions:
  //   btnReset:  enabled when there are pending local changes (FV != AV) AND form is valid
  //   btnSaveApply: enabled when server _dirty flag is true AND form is valid
  function updateUI() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    var modified = count > 0;
    var formOk = configForm.checkValidity();
    btnReset.disabled = !(modified && formOk);
    btnSaveApply.disabled = !(dirty && formOk);
  }
```

- [ ] **Step 2: Remove handleApply function**

Delete the entire `handleApply` function.

- [ ] **Step 3: Remove Apply button from btnApply variable binding**

In init, remove `btnApply` from the button references. The init section has:

```javascript
    btnSaveApply = document.getElementById('btn-save-apply');
    btnApply = document.getElementById('btn-apply');
    btnReset = document.getElementById('btn-reset');
```

Remove the `btnApply` line and remove `btnApply` from the `var` declaration at the top of the IIFE.

- [ ] **Step 4: Remove Apply button from wireButtons**

Remove `btnApply.addEventListener('click', handleApply);` from wireButtons.

- [ ] **Step 5: Remove pendingCount variable**

Remove `var pendingCount = document.getElementById('pending-count');` from the `var` declarations at the top of the IIFE, since it's no longer referenced by `updateUI`.

- [ ] **Step 6: Update unit tests for new button logic**

Replace the `updateUI` describe block:

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
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })

  it('enables Reset when pending changes exist', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(false)
  })

  it('disables Reset when form is invalid', () => {
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })

  it('enables Save & Apply when dirty is true', () => {
    window.__test.dirty = true
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(false)
  })

  it('disables Save & Apply when dirty is false', () => {
    window.updateUI()
    expect(document.getElementById('btn-save-apply').disabled).toBe(true)
  })

  it('disables Reset when pending is reverted', () => {
    document.querySelector('[name="wifi.ssid"]').value = 'Net'
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(false)
    document.querySelector('[name="wifi.ssid"]').value = ''
    window.updateUI()
    expect(document.getElementById('btn-reset').disabled).toBe(true)
  })
})
```

Update the `init` test to not reference `btnApply` or `pendingCount`:

In the init test, remove the lines:
```javascript
expect(document.getElementById('btn-apply').disabled).toBe(true)
```
and:
```javascript
expect(document.getElementById('pending-count')).toHaveText('')
```

- [ ] **Step 7: Update mock responses to use `data` wrapper**

Update `handleSaveApply` tests: the syncThen mock no longer needs to return settings (syncThen just re-baselines). Simplify:

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
```

- [ ] **Step 8: Remove handleApply from test expose line**

Remove `window.handleApply=handleApply` from the test-expose line in `app.js`.

- [ ] **Step 9: Run unit tests**

Run: `npm run test:unit`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: remove Apply button references from JS, update button logic"
```

---

### Task 3: Update HTML — remove Apply button, add notification bar

**Files:**
- Modify: `index.html`

**Prerequisite:** Task 2 already removed all JS references to `btnApply` and `pendingCount`, so removing these DOM elements is safe.

- [ ] **Step 1: Remove Apply button from index.html**

Replace the button group in `index.html`:

Before (the button group inside `<footer>`):
```html
      <menu>
        <li><button id="btn-save-apply" disabled>Save &amp; Apply</button></li>
        <li><button id="btn-apply" disabled>Apply</button></li>
        <li><button id="btn-reset" disabled>Reset</button></li>
      </menu>
```

After:
```html
      <menu>
        <li><button id="btn-save-apply" disabled>Save &amp; Apply</button></li>
        <li><button id="btn-reset" disabled>Reset</button></li>
      </menu>
```

- [ ] **Step 2: Remove pending-count element from footer**

Remove the pending-count line from the footer HTML:

```html
      <small id="pending-count"></small>
```

- [ ] **Step 3: Add notification bar below header**

Insert after the closing `</header>` tag, before `<main>`:

```html
  <mark id="server-changed" role="alert" hidden>
    <span id="notif-text"></span>
    <button id="notif-load" hidden>Load</button>
    <button id="notif-keep" hidden>Keep</button>
    <button id="notif-keep-local" hidden>Keep all local</button>
    <button id="notif-accept-server" hidden>Accept all server</button>
  </mark>
```

The notification bar is informational for Case 3 (external update, user idle) — footer buttons remain active. For Case 5 (conflict), the notification replaces the footer since the user must decide.

- [ ] **Step 4: Add `aria-busy` to form container**

Add `aria-busy="true"` to `<form id="config-form">`:

```html
    <form id="config-form" aria-busy="true">
```

- [ ] **Step 5: Add sticky-bar CSS + conflict visual**

Replace the existing `footer.pending` CSS block with sticky-bar classes. Also add a `.pending` visual indicator for conflict state:

```css
    .sticky-bar {
      position: sticky;
      z-index: 10;
      background: var(--pico-background-color);
      box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
    }
    .sticky-bar.top { top: 0; }
    .sticky-bar.bottom { bottom: 0; }
    .sticky-bar.pending {
      border-top: 3px solid var(--pico-color-red);
    }
    #server-changed[hidden] { display: none; }
```

Add `class="sticky-bar bottom"` to the `<footer>` tag so sticky is always-on (not just when pending). The `.sticky-bar.pending` class provides a visual indicator when there's a conflict — the notification buttons in `showConflictPrompt` toggle this class on the footer via `footer.classList.add('pending')`.

- [ ] **Step 6: Build and verify index.html is valid**

Run: `npm run build`
Expected: `app.min.js` generated (no HTML-related errors).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: remove Apply button, add server-changed notification bar, add aria-busy"
```

---

### Task 4: Add WS connection, per-field state, and WS init flow

**Files:**
- Modify: `app.js`
- Modify: `tests/setup.js`
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Add per-field state variables and WS connection**

Add after the `var dirty = false;` line:

```javascript
// Per-field WebSocket state: lastSent[key] tracks the last value we sent to the
// server for field "comp.fieldKey". inFlight[key] is true while we're waiting
// for the server to echo our change back. wsReconnectTimer holds the setTimeout
// id for exponential-backoff reconnect attempts.
var ws = null;
var lastSent = {};
var inFlight = {};
var wsReconnectTimer = null;
```

- [ ] **Step 2: Add connectWS and disconnectWS functions**

Add after `postJSON` definition:

```javascript
  // Opens a WebSocket connection to /api/settings/ws. Sets aria-busy on the
  // form container immediately so Pico CSS shows a loading indicator. The
  // server pushes full settings on connect, which onWSMessage processes to
  // render the form and remove aria-busy.
  function connectWS() {
    configForm.setAttribute('aria-busy', 'true');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/api/settings/ws');
    ws.onopen = function () {};
    ws.onmessage = onWSMessage;
    ws.onclose = onWSClose;
    ws.onerror = function () { if (ws) ws.close(); };
  }

  // Cleanly tears down the WS connection: clears any pending reconnect timer,
  // prevents onclose from firing during intentional close, and nulls the ref.
  function disconnectWS() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  // Called when WS closes unexpectedly. Sets aria-busy back on (we're loading
  // again), shows an error in the status bar, and schedules a reconnect attempt.
  // Backoff and retry-UI are added in Task 7.
  function onWSClose() {
    ws = null;
    configForm.setAttribute('aria-busy', 'true');
    showError('Connection lost. Retrying\u2026');
    wsReconnectTimer = setTimeout(connectWS, 3000);
  }
```

- [ ] **Step 3: Add processSettings function (replaces HTTP loadSettings body)**

Add after `onWSClose`:

```javascript
  // Called by onWSMessage (initial push or reconnect) to build the component
  // tree from the server's settings JSON. Replaces the old loadSettings()
  // HTTP fetch logic. Renders nav, form, populates fields from server values,
  // records the baseline (AV), clears aria-busy, and wires up the UI state.
  function processSettings(data, dirtyFlag) {
    dirty = dirtyFlag === true;
    var comps = [];
    for (var key in data) {
      if (key[0] === '_') continue; // skip meta keys like _dirty
      var group = data[key];
      var fields = [];
      for (var fieldKey in group) {
        var arr = group[fieldKey];
        fields.push({key: fieldKey, type: arr[0], label: arr[1], opts: arr[2]});
      }
      comps.push({id: key, label: key, fields: fields});
    }
    components = comps;
    renderNav();
    renderForm();
    populateFromComponents();
    setBaseline();
    configForm.removeAttribute('aria-busy');
    clearError();
    updateUI();
    handleHash();
  }
```

- [ ] **Step 4: Add onWSMessage handler (stub, echo handling only)**

Add after `processSettings`:

```javascript
  // Incoming WS message handler. Parses the JSON, strips the _dirty/type/data
  // envelope to get the raw settings object, then routes based on whether any
  // in-flight fields match (echo resolution). For the initial connect push
  // (no inFlight keys) and echoes, it updates AV and applies it to the form.
  // Complex routing for server-pushed changes (Cases 3/4/5) is added in Task 6.
  function onWSMessage(event) {
    var msg = JSON.parse(event.data);
    if (msg.type === 'error') { showError(msg.message); return; }
    if (msg.type !== 'settings') return;
    // Unwrap the envelope: the server may send {_dirty, type, data} or
    // {_dirty, type, wifi: ..., gpio: ...} depending on the transport layer.
    var data = msg.data || msg;
    if (msg.data === undefined && msg._dirty !== undefined && msg.type === 'settings') {
      data = {};
      for (var k in msg) {
        if (k[0] !== '_' && k !== 'type') data[k] = msg[k];
      }
    }
    // Echo resolution: for every in-flight field, check if the server's value
    // matches what we last sent. If so, the server confirmed our change.
    var anyMatched = false;
    for (var key in inFlight) {
      if (!inFlight[key]) continue;
      var parts = key.split('.');
      var serverVal = resolveNested(data, parts);
      if (serverVal !== undefined && String(serverVal) === String(lastSent[key])) {
        inFlight[key] = false;
        anyMatched = true;
      }
    }
    if (anyMatched) {
      // Echo received — apply the server's confirmed values to AV and form.
      updateAV(data);
      applyAV();
      return;
    }
    // No echo matched — either we have no in-flight keys (initial push, or
    // server-push while idle) or we still have in-flight keys (ignore — Cases
    // 8/9/10, handled in Task 6). For the initial push case, apply directly.
    updateAV(data);
    applyAV();
    syncLS();
  }

  // Updates internal component values (Applied Value / AV) from server data
  // WITHOUT touching the form. This lets us store the server's view of the
  // world while keeping the form's Form Value (FV) intact for Cases 3/5.
  function updateAV(data) {
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var sGroup = data[comp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var sField = sGroup[field.key];
        if (!sField) continue;
        field.opts.value = sField[2].value;
      }
    }
  }

  // Pushes the current AV (component opts.value) to the DOM, records baseline,
  // and updates button states. Used after silent syncs (Cases 1/4) and when
  // the user clicks "Load" or "Accept server" in notification handlers.
  function applyAV() {
    populateFromComponents();
    setBaseline();
    updateUI();
  }

  // Syncs lastSent to match AV for every field. Called after cases where the
  // server state is confirmed to match what the client should consider
  // "sent" — initial load (Case 1), coincidental sync (Case 4), and after
  // user accepts server values via notification buttons.
  function syncLS() {
    for (var ci = 0; ci < components.length; ci++) {
      for (var fi = 0; fi < components[ci].fields.length; fi++) {
        var key = components[ci].id + '.' + components[ci].fields[fi].key;
        lastSent[key] = components[ci].fields[fi].opts.value;
      }
    }
  }

  // Walk a nested object following an array of path parts (e.g. ["wifi","ssid"]).
  // Returns undefined if any intermediate key is missing.
  function resolveNested(obj, parts) {
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
```

- [ ] **Step 5: Modify init to connect WS instead of HTTP GET**

Replace the `loadSettings().then(...)` call in init with:

```javascript
    connectWS();
```

Remove the `loadSettings` call entirely. The WS initial push triggers `onWSMessage` → `processSettings` which renders everything.

- [ ] **Step 6: Modify handleReset to request fresh settings via WS**

Replace `handleReset`:

```javascript
  // Reset discards local changes and re-fetches server state. In Phase 6 this
  // is done by tearing down and re-establishing the WS connection — the server
  // pushes full fresh settings on every connect.
  function handleReset() {
    clearError();
    disconnectWS();
    connectWS();
  }
```

- [ ] **Step 7: Modify syncThen (no more HTTP GET refresh)**

Replace `syncThen`:

```javascript
  // Called after a successful POST /api/settings/save. In Phase 6 there's no
  // need to re-fetch from the server — the WS echo push will arrive and update
  // everything. We just re-baseline from current form values (which match what
  // we just saved) and update button states.
  function syncThen() {
    setBaseline();
    updateUI();
  }
```

- [ ] **Step 8: Add WebSocket mock to test setup**

Add to `tests/setup.js` before the `eval(appjs)` line:

```javascript
// Mock WebSocket for Phase 6 tests
window.WebSocket = function (url) {
  this.url = url;
  this.readyState = 0; // CONNECTING
  var self = this;
  setTimeout(function () {
    self.readyState = 1; // OPEN
    if (self.onopen) self.onopen();
  }, 0);
};
window.WebSocket.prototype.send = function (data) {
  if (window.__test.onWSSend) window.__test.onWSSend(data);
};
window.WebSocket.prototype.close = function () {
  this.readyState = 3; // CLOSED
  if (this.onclose) this.onclose();
};
```

- [ ] **Step 9: Expose WS functions for testing**

Append to the test-expose line in `app.js`, adding the new Phase 6 functions defined in this task:

```javascript
window.connectWS=connectWS;window.disconnectWS=disconnectWS;window.processSettings=processSettings;window.onWSMessage=onWSMessage;window.updateAV=updateAV;window.applyAV=applyAV;window.syncLS=syncLS;window.resolveNested=resolveNested;
```

Functions defined in later tasks (`sendToServer`, `onUserInput`, `readFormValue`, `showExternalNotification`, `showConflictPrompt`, `hideNotification`) will be added to the expose line in those tasks.

- [ ] **Step 10: Write unit tests for WS init flow**

Add to `tests/unit/app.test.js`:

```javascript
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
    expect(document.getElementById('config-form').getAttribute('aria-busy')).toBe('false')
  })

  it('clears error on successful load', () => {
    document.getElementById('status-bar').textContent = 'Previous error'
    window.processSettings({ wifi: { ssid: ['text', 'SSID', { value: '' }] } }, false)
    expect(document.getElementById('status-bar').textContent).toBe('')
  })
})
```

- [ ] **Step 11: Add notification bar DOM elements to test setup**

The tests for `processSettings` don't need the notification bar. But tests in Task 6 will. Add notification bar HTML to `tests/setup.js` so those DOM elements exist:

```javascript
// In setup.js, add to the innerHTML block after the existing elements:
//   <mark id="server-changed" hidden>
//     <span id="notif-text"></span>
//     <button id="notif-load" hidden></button>
//     <button id="notif-keep" hidden></button>
//     <button id="notif-keep-local" hidden></button>
//     <button id="notif-accept-server" hidden></button>
//   </mark>
```

- [ ] **Step 12: Run unit tests**

Run: `npm run test:unit`
Expected: all existing tests pass (may need minor mock adjustments) + new tests pass.

- [ ] **Step 13: Commit**

```bash
git add app.js tests/setup.js tests/unit/app.test.js
git commit -m "feat: add WebSocket connection and per-field state tracking"
```

---

### Task 5: Implement apply-on-blur via WS (onUserInput)

**Files:**
- Modify: `app.js`
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Add sendToServer and onUserInput**

Add after `syncLS`:

```javascript
  // Sends a single field change to the server via WebSocket. Records the value
  // in lastSent and marks the field as inFlight so onUserInput won't resend
  // while we're waiting for the echo. The payload is a partial settings object
  // matching the structure of /api/settings but with only the changed key.
  function sendToServer(key, value) {
    if (!ws || ws.readyState !== 1) return;
    lastSent[key] = value;
    inFlight[key] = true;
    var parts = key.split('.');
    var patch = {};
    var cur = patch;
    for (var i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    ws.send(JSON.stringify({action: 'apply', data: patch}));
  }

  // Called when the user blurs a field. Implements the state machine for user
  // input events (Cases 1 and 2 from the spec):
  //   Case 1 (Idle): FV equals LS — nothing changed, do nothing.
  //   Case 2 (Local Input): FV differs from LS — send the new value via WS.
  // If inFlight is true, we skip because we're already waiting for an echo
  // (the queued input will be handled when the echo arrives — Case 7).
  function onUserInput(key, newValue) {
    if (inFlight[key]) return; // already waiting for echo
    var ls = lastSent[key];
    if (JSON.stringify(newValue) === JSON.stringify(ls)) return; // Case 1: no change
    // Case 2: local input
    sendToServer(key, newValue);
  }
```

- [ ] **Step 2: Bind blur events to onUserInput**

Modify `bindChangeListeners`:

```javascript
  // Binds change/blur listeners to all form fields. Text-like inputs (text,
  // password, email, tel, url, textarea) use blur so we don't send on every
  // keystroke. Select/checkbox/radio/range use change (fires after selection).
  // Every field also gets an input listener to update button state live.
  // On blur/change, we validate first, then call onUserInput which may send
  // the value over WS (apply-on-blur).
  function bindChangeListeners() {
    configForm.querySelectorAll('input, select, textarea').forEach(function (el) {
      var key = el.name;
      if (!key) return;
      var handler = function () {
        if (!el.checkValidity()) { updateUI(); return; }
        // Normalize the form value — checkboxes return boolean, numbers parse
        // to float, everything else is a string.
        var val = (el.type === 'checkbox') ? el.checked :
                  (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
        onUserInput(key, val);
        updateUI();
      };
      // Text inputs send on blur (not on every keystroke) to avoid flooding
      // the server. Non-text inputs (select, checkbox, etc.) fire on change.
      if (el.type === 'text' || el.type === 'password' || el.type === 'email' ||
          el.type === 'tel' || el.type === 'url' || el.type === 'textarea') {
        el.addEventListener('blur', handler);
      } else {
        el.addEventListener('change', handler);
      }
      el.addEventListener('input', function () { updateUI(); });
    });
  }
```

- [ ] **Step 3: Expose new functions for testing**

Append to the test-expose line in `app.js`:

```javascript
window.sendToServer=sendToServer;window.onUserInput=onUserInput;
```

- [ ] **Step 4: Write unit tests for onUserInput**

Add to `tests/unit/app.test.js`:

```javascript
describe('onUserInput', () => {
  beforeEach(() => {
    window.lastSent = {}
    window.inFlight = {}
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
  })

  it('sends value over WS when field changes', () => {
    window.onUserInput('wifi.ssid', 'NewNet')
    expect(window.__test.wsSent).toEqual({ action: 'apply', data: { wifi: { ssid: 'NewNet' } } })
  })

  it('sets lastSent and inFlight after sending', () => {
    window.onUserInput('gpio.pin', 7)
    expect(window.lastSent['gpio.pin']).toBe(7)
    expect(window.inFlight['gpio.pin']).toBe(true)
  })

  it('does not send when value unchanged from lastSent', () => {
    window.lastSent['wifi.ssid'] = 'SameNet'
    window.onUserInput('wifi.ssid', 'SameNet')
    expect(window.__test.wsSent).toBeNull()
  })

  it('does not send when inFlight is true', () => {
    window.inFlight['wifi.ssid'] = true
    window.onUserInput('wifi.ssid', 'NewNet')
    expect(window.__test.wsSent).toBeNull()
  })
})
```

- [ ] **Step 5: Run unit tests**

Run: `npm run test:unit`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: implement apply-on-blur via WebSocket"
```

---

### Task 6: Implement server-push notification (onServerMessage full state machine)

**Files:**
- Modify: `app.js`
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Implement full onServerMessage state machine**

Replace the stub `onWSMessage` with the full implementation:

```javascript
  // ── Incoming WebSocket message handler ──
  // Implements the full 10-case state machine from the spec.
  //
  // Three tracked values per field:
  //   FV = Form Value    (current DOM value, read live)
  //   LS = Last Sent     (lastSent[key], what we last sent to server)
  //   AV = Applied Value (component opts.value, last confirmed server state)
  //
  // Plus: inFlight[key] = true while waiting for server echo of our change.
  //
  // Flow:
  //   1. Parse and unwrap the message envelope.
  //   2. Echo resolution: check if any inFlight field matches the server
  //      response (LS == AV). If so, clear inFlight.
  //   3. Routing:
  //      a. Echo matched + queued input (Case 7): send new values immediately.
  //      b. Echo matched + no queued input (Case 6): apply and return.
  //      c. Still in-flight (Cases 8,9,10): ignore packet entirely.
  //      d. Not in-flight: classify changed fields as external update (Case 3),
  //         conflict (Case 5), or coincidental sync (Case 4).
  function onWSMessage(event) {
    var msg = JSON.parse(event.data);
    // Server error messages — display in status bar and stop.
    if (msg.type === 'error') { showError(msg.message); return; }
    // Ignore non-settings messages (e.g. keep-alive pongs).
    if (msg.type !== 'settings' && msg._dirty === undefined) return;

    var dirtyFlag = msg._dirty;
    // Unwrap the envelope. Server may send {_dirty, type, data:{...}} or
    // {_dirty, type, wifi:{...}} depending on WS vs HTTP heritage.
    var data = msg.data || msg;
    if (msg.data === undefined && msg._dirty !== undefined && msg.type === 'settings') {
      data = {};
      for (var k in msg) {
        if (k[0] !== '_' && k !== 'type') data[k] = msg[k];
      }
    }

    // ── Step 1: Echo resolution ──
    // Walk every inFlight field and check if the server's value matches
    // what we lastSent. If it does, the server has accepted our change.
    var echoMatched = false;
    for (var key in inFlight) {
      if (!inFlight[key]) continue;
      var parts = key.split('.');
      var serverVal = resolveNested(data, parts);
      if (serverVal !== undefined && String(serverVal) === String(lastSent[key])) {
        inFlight[key] = false;
        echoMatched = true;
      }
    }

    if (echoMatched) {
      // One or more in-flight fields were confirmed by the server.

      // Check for queued user input (Case 7): the user changed a field
      // again while we were waiting for the echo. FV !== LS for those fields.
      var queuedKeys = [];
      for (var key in inFlight) {
        // Skip fields still inFlight (their echo hasn't arrived yet — this
        // can happen if multiple fields were sent and only some echoed).
        if (inFlight[key]) continue;
        var parts = key.split('.');
        var fv = readFormValue(parts);
        if (fv !== undefined && String(fv) !== String(lastSent[key])) {
          queuedKeys.push({key: key, value: fv});
        }
      }
      if (queuedKeys.length > 0) {
        // Case 7: Echo + Queued Input — send the user's latest values
        // immediately, then sync AV from the server's confirmed state.
        for (var qi = 0; qi < queuedKeys.length; qi++) {
          sendToServer(queuedKeys[qi].key, queuedKeys[qi].value);
        }
        updateAV(data);
        applyAV();
        return;
      }
      // Case 6: Clean Echo — server confirmed, no queued input.
      updateAV(data);
      applyAV();
      return;
    }

    // ── Step 2: Still have in-flight keys that didn't match? ──
    // Cases 8, 9, 10: we're waiting for an echo and this packet is
    // unrelated or stale. Ignore it entirely — the inFlight fields will
    // be resolved when the real echo arrives.
    var hasInFlight = false;
    for (var k in inFlight) { if (inFlight[k]) { hasInFlight = true; break; } }
    if (hasInFlight) return;

    // ── Step 3: Not in-flight — evaluate Cases 1, 3, 4, 5 ──
    // Collect every field where the server's value differs from our AV.
    // Compare FV, oldAV, and newAV to classify the change.
    var changedFields = {};
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var sGroup = data[comp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var sField = sGroup[field.key];
        if (!sField) continue;
        var newAV = sField[2].value;           // server's new value
        var oldAV = field.opts.value;           // our current AV (pre-update)
        if (String(newAV) === String(oldAV)) continue; // no change at all
        var el = document.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        var fv = (el.type === 'checkbox') ? el.checked :
                 (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
        changedFields[comp.id + '.' + field.key] = {newAV: newAV, oldAV: oldAV, fv: fv, label: field.label};
      }
    }

    // Case 1: Synced — no fields changed on the server. Nothing to do.
    if (Object.keys(changedFields).length === 0) return;

    // Update internal AV for all changed fields (the server's version is now
    // the authoritative AV), but do NOT touch the form yet. The form (FV)
    // stays as-is until the user decides what to do.
    updateAV(data);

    // Classify each changed field:
    var conflicts = [];
    var externalFields = [];
    for (var key in changedFields) {
      var cf = changedFields[key];
      if (String(cf.fv) === String(cf.oldAV)) {
        // Case 3: External Update — user hasn't touched this field since
        // the last sync (FV == oldAV == LS). Show informational notification.
        externalFields.push({key: key, label: cf.label, newValue: cf.newAV});
      } else if (String(cf.fv) !== String(cf.newAV)) {
        // Case 5: Collision — user has local changes (FV differs from both
        // oldAV and newAV). Show conflict prompt.
        conflicts.push({key: key, label: cf.label, localValue: cf.fv, serverValue: cf.newAV});
      }
      // Case 4: Coincidental Sync — FV happens to equal newAV (user entered
      // the same value the server is pushing). No user action needed.
    }

    if (conflicts.length > 0) {
      // Case 5: AV updated internally, form (FV) untouched.
      // User must choose via conflict prompt buttons.
      showConflictPrompt(conflicts);
    } else if (externalFields.length > 0) {
      // Case 3: AV updated internally, form (FV) untouched.
      // User can read notification and click Load or Keep.
      showExternalNotification(externalFields);
    } else {
      // Cases 1 & 4: Silent sync — apply AV to the form, update baseline,
      // and sync LS = AV so the next send doesn't re-send coincidental values.
      applyAV();
      syncLS();
    }
  }
```

- [ ] **Step 2: Add readFormValue helper**

`resolveNested` was already defined in Task 4 step 4. Only the new `readFormValue` function is needed:

```javascript
  // Reads the current form value for a field identified by dotted path parts.
  // Normalizes checkbox to boolean, number/range to float, all else to string.
  // Returns undefined if the element doesn't exist in the DOM.
  function readFormValue(parts) {
    var el = document.querySelector('[name="' + parts.join('.') + '"]');
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  }
```

- [ ] **Step 3: Add notification UI functions**

```javascript
  // Shows the informational "Server settings changed" bar for Case 3.
  // Displays "Load" (accept server values) and "Keep" (dismiss, keep FV) buttons.
  // Does NOT block the footer — the user can safely ignore the notification and
  // keep editing other fields. The AV was already updated internally by updateAV;
  // clicking Load applies AV to the form via applyAV().
  function showExternalNotification(fields) {
    var bar = document.getElementById('server-changed');
    var text = document.getElementById('notif-text');
    text.textContent = 'Server settings changed: ' + fields.map(function (f) { return f.label; }).join(', ');
    document.getElementById('notif-load').hidden = false;
    document.getElementById('notif-keep').hidden = false;
    document.getElementById('notif-keep-local').hidden = true;
    document.getElementById('notif-accept-server').hidden = true;
    bar.hidden = false;
  }

  // Shows the blocking conflict prompt for Case 5. The user has local changes
  // AND the server has conflicting changes — they must pick a side ("Keep all
  // local" or "Accept all server"). Footer gets a visual red border via the
  // .sticky-bar.pending CSS class to indicate the user needs to respond.
  function showConflictPrompt(conflicts) {
    var bar = document.getElementById('server-changed');
    var text = document.getElementById('notif-text');
    text.textContent = 'Conflict: ' + conflicts.map(function (f) { return f.label; }).join(', ');
    document.getElementById('notif-load').hidden = true;
    document.getElementById('notif-keep').hidden = true;
    document.getElementById('notif-keep-local').hidden = false;
    document.getElementById('notif-accept-server').hidden = false;
    bar.hidden = false;
    footer.classList.add('pending'); // visual red border via .sticky-bar.pending
  }

  // Hides the notification bar and removes the footer conflict state.
  function hideNotification() {
    document.getElementById('server-changed').hidden = true;
    footer.classList.remove('pending');
  }
```

- [ ] **Step 4: Wire notification buttons**

Add to `wireButtons`:

```javascript
    // "Load" button (Case 3): accept the server's new values. The AV was
    // already updated by updateAV; applyAV() pushes it to the form and
    // re-baselines. syncLS() updates lastSent so we don't resend coincidentally.
    document.getElementById('notif-load').addEventListener('click', function () {
      hideNotification();
      applyAV();   // push internal AV to form, re-baseline, update UI
      syncLS();    // LS = AV so next blur won't re-send server values
    });
    // "Keep" button (Case 3): dismiss the notification and keep the user's
    // local form values (FV). Since updateAV already changed internal component
    // values to server values, we must revert AV back to FV, then re-baseline.
    document.getElementById('notif-keep').addEventListener('click', function () {
      hideNotification();
      // Revert component values (AV) to match the current form values (FV).
      for (var ci = 0; ci < components.length; ci++) {
        var comp = components[ci];
        for (var fi = 0; fi < comp.fields.length; fi++) {
          var field = comp.fields[fi];
          var el = document.querySelector('[name="' + comp.id + '.' + field.key + '"]');
          if (!el) continue;
          var fv = (el.type === 'checkbox') ? el.checked :
                   (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
          field.opts.value = fv;
        }
      }
      syncLS();    // LS = FV (user's choice), so future blurs send expected diffs
      setBaseline();
      updateUI();
    });
    // "Keep all local" button (Case 5): the user wants to overwrite the
    // server's conflicting changes with their local values. Send all current
    // form values to the server via WS (onUserInput skip via inFlight guard
    // is bypassed by calling sendToServer directly).
    document.getElementById('notif-keep-local').addEventListener('click', function () {
      hideNotification();
      var changes = serialize();
      for (var key in changes) {
        sendToServer(key, changes[key]);
      }
    });
    // "Accept all server" button (Case 5): the user accepts the server's
    // version. Push AV to the form, re-baseline, and sync LS.
    document.getElementById('notif-accept-server').addEventListener('click', function () {
      hideNotification();
      applyAV();
      syncLS();
    });
```

- [ ] **Step 5: Expose new functions for testing**

Append to the test-expose line in `app.js`:

```javascript
window.readFormValue=readFormValue;window.showExternalNotification=showExternalNotification;window.showConflictPrompt=showConflictPrompt;window.hideNotification=hideNotification;
```

- [ ] **Step 6: Write unit tests for all 10 state machine cases**

The state machine has 10 cases. Cases 1-5 are "not in-flight" scenarios, Cases 6-10 are "in-flight" scenarios. Case 2 (Local Input) is already tested in Task 5's `onUserInput` tests. The remaining 9 are tested here.

Add to `tests/unit/app.test.js`:

```javascript
// Tests for the full onWSMessage state machine covering all 10 cases.
// Per-field state abbreviations:
//   FV = Form Value (DOM), LS = Last Sent (lastSent[key]),
//   AV = Applied Value (component opts.value)
//   inFlight = waiting for server echo
//
// Case matrix:
//   FV=LS? | LS=AV? | FV=AV? | inFlight | Case | Interpretation
//   -------|--------|--------|----------|------|---------------
//    yes   |  yes   |  yes   |  false   |  1   | Idle (synced)
//    no    |  yes   |  no    |  false   |  2   | Local Input (Task 5)
//    yes   |  yes   |  no    |  false   |  3   | External Update
//    no    |  no    |  yes   |  false   |  4   | Coincidental Sync
//    no    |  no    |  no    |  false   |  5   | Collision
//    yes   |  yes   |  yes   |  true    |  6   | Echo Received
//    no    |  yes   |  no    |  true    |  7   | Echo + Queued Input
//    yes   |  no    |  no    |  true    |  8   | Stale Packet
//    no    |  no    |  yes   |  true    |  9   | Waiting for Echo (revert)
//    no    |  no    |  no    |  true    |  10  | Waiting for Echo (conflict)
describe('onWSMessage — all 10 state machine cases', () => {
  // Helper to set up a single-field form with given FV, AV, LS, inFlight.
  function setupCase(fv, av, ls, inflight) {
    document.querySelector('#config-form').innerHTML =
      '<input name="wifi.ssid" value="' + fv + '" />'
    window.__test.components = [
      { id: 'wifi', fields: [
        { key: 'ssid', type: 'text', label: 'SSID', opts: { value: av } },
      ]},
    ]
    window.lastSent = {}
    if (ls !== undefined) window.lastSent['wifi.ssid'] = ls
    window.inFlight = {}
    if (inflight) window.inFlight['wifi.ssid'] = true
  }

  // Helper to build a WS message that pushes a given AV for wifi.ssid.
  function serverPush(newAv) {
    return JSON.stringify({ _dirty: false,
      wifi: { ssid: ['text', 'SSID', { value: newAv }] },
    })
  }

  beforeEach(() => {
    // Clear any existing notification.
    document.getElementById('server-changed').hidden = true
    document.querySelector('#config-form').innerHTML = ''
    window.__test.components = []
    window.lastSent = {}
    window.inFlight = {}
    // Reset the notification button hidden states.
    document.getElementById('notif-load').hidden = true
    document.getElementById('notif-keep').hidden = true
    document.getElementById('notif-keep-local').hidden = true
    document.getElementById('notif-accept-server').hidden = true
  })

  // ── Case 1: Idle ──
  // FV == LS == AV, inFlight=false. Server pushes the same AV we already have.
  // Nothing should change — no notification, no component update.
  it('Case 1: no-op when everything is synced', () => {
    setupCase('hello', 'hello', 'hello', false)
    window.onWSMessage({ data: serverPush('hello') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('hello')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  // ── Case 2: Local Input ── tested in onUserInput tests (Task 5)

  // ── Case 3: External Update ──
  // FV == LS == oldAV, inFlight=false. Server pushes a different value.
  // Notification bar should appear with Load/Keep buttons.
  it('Case 3: shows external notification when server pushes new value while idle', () => {
    setupCase('oldVal', 'oldVal', 'oldVal', false)
    window.onWSMessage({ data: serverPush('newServerVal') })
    // AV should be updated internally but form (FV) stays unchanged.
    expect(window.__test.components[0].fields[0].opts.value).toBe('newServerVal')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('oldVal')
    expect(document.getElementById('server-changed').hidden).toBe(false)
    expect(document.getElementById('notif-load').hidden).toBe(false)
    expect(document.getElementById('notif-keep').hidden).toBe(false)
    expect(document.getElementById('notif-keep-local').hidden).toBe(true)
    expect(document.getElementById('notif-accept-server').hidden).toBe(true)
  })

  // ── Case 4: Coincidental Sync ──
  // FV == newAV (user already entered the value server is pushing),
  // LS == oldAV (value hasn't been sent yet or server hadn't confirmed).
  // Should silently sync: form gets newAV, LS updated, no notification.
  it('Case 4: silent sync when FV matches server push', () => {
    setupCase('match', 'oldVal', 'oldVal', false)
    window.onWSMessage({ data: serverPush('match') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('match')
    expect(window.lastSent['wifi.ssid']).toBe('match')
    expect(document.getElementById('server-changed').hidden).toBe(true)
  })

  // ── Case 5: Collision ──
  // FV differs from both oldAV and newAV, inFlight=false.
  // Conflict prompt should show with "Keep all local" / "Accept all server".
  it('Case 5: shows conflict prompt when local and server both changed', () => {
    setupCase('myLocal', 'oldVal', 'oldVal', false)
    window.onWSMessage({ data: serverPush('serverChanged') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('serverChanged')
    expect(document.querySelector('[name="wifi.ssid"]').value).toBe('myLocal')
    expect(document.getElementById('server-changed').hidden).toBe(false)
    expect(document.getElementById('notif-load').hidden).toBe(true)
    expect(document.getElementById('notif-keep').hidden).toBe(true)
    expect(document.getElementById('notif-keep-local').hidden).toBe(false)
    expect(document.getElementById('notif-accept-server').hidden).toBe(false)
  })

  // ── Case 6: Echo Received ──
  // inFlight=true, LS matches server value. inFlight should clear, AV updates.
  it('Case 6: clears inFlight when echo matches', () => {
    setupCase('sentVal', 'oldVal', 'sentVal', true)
    window.onWSMessage({ data: serverPush('sentVal') })
    expect(window.inFlight['wifi.ssid']).toBe(false)
    expect(window.__test.components[0].fields[0].opts.value).toBe('sentVal')
  })

  // ── Case 7: Echo + Queued Input ──
  // inFlight=true (just cleared by echo match), but FV != LS (user changed
  // field again while waiting). Should send the new FV to server immediately.
  it('Case 7: sends queued input after echo arrives', () => {
    setupCase('queuedNew', 'oldVal', 'sentVal', true)
    window.__test.wsSent = null
    window.__test.onWSSend = function (data) { window.__test.wsSent = JSON.parse(data) }
    window.onWSMessage({ data: serverPush('sentVal') })
    // Should send the queued value (FV) since it differs from LS.
    expect(window.__test.wsSent).toEqual({
      action: 'apply',
      data: { wifi: { ssid: 'queuedNew' } },
    })
    expect(window.inFlight['wifi.ssid']).toBe(true) // re-sent, back in-flight
  })

  // ── Case 8: Stale Packet ──
  // inFlight=true, LS != server value. Packet is unrelated/stale — ignore.
  it('Case 8: ignores packet when inFlight and no echo match', () => {
    setupCase('local', 'oldVal', 'sentVal', true)
    window.onWSMessage({ data: serverPush('unrelatedExternal') })
    // Component value should NOT change (packet ignored).
    expect(window.__test.components[0].fields[0].opts.value).toBe('oldVal')
    expect(window.inFlight['wifi.ssid']).toBe(true) // still waiting
  })

  // ── Case 9: Waiting for Echo (revert) ──
  // inFlight=true, LS != server value (still waiting for our echo).
  // Meanwhile user reverted FV back to oldAV. Server packet is stale/ignored.
  // After echo eventually arrives → Case 1 (FV == AV == LS).
  it('Case 9: ignores packet while inFlight even if user reverted (FV == oldAV)', () => {
    setupCase('oldVal', 'oldVal', 'sentVal', true)
    window.onWSMessage({ data: serverPush('someExternal') })
    // Same behavior as Case 8 — ignore while inFlight.
    expect(window.__test.components[0].fields[0].opts.value).toBe('oldVal')
    expect(window.inFlight['wifi.ssid']).toBe(true)
  })

  // ── Case 10: Waiting for Echo (conflict) ──
  // inFlight=true, LS != server value. User also made a different change.
  // Packet is stale/ignored. After echo eventually arrives → Case 5.
  it('Case 10: ignores packet while inFlight even with conflicting local change', () => {
    setupCase('userChange', 'oldVal', 'sentVal', true)
    window.onWSMessage({ data: serverPush('yetAnotherExt') })
    expect(window.__test.components[0].fields[0].opts.value).toBe('oldVal')
    expect(window.inFlight['wifi.ssid']).toBe(true)
  })
})
```

- [ ] **Step 7: Run unit tests**

Run: `npm run test:unit`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: implement server-push notification with state machine"
```

---

### Task 7: Add reconnect + error UI

**Files:**
- Modify: `app.js`
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Add retry counter and reset-on-success**

Add a retry counter variable alongside the other WS state variables (after the `var wsReconnectTimer = null;` line):

```javascript
  // Tracks consecutive WS reconnect failures for exponential backoff.
  // Reset to 0 on every successful settings message receipt.
  var wsRetries = 0;
```

In `onWSMessage`, after the `if (msg.type !== 'settings' && msg._dirty === undefined) return;` guard and before any processing, add:

```javascript
    // Successful message means we're connected — reset retry counter.
    wsRetries = 0;
```

- [ ] **Step 2: Replace onWSClose with backoff + retry-UI**

Replace the existing `onWSClose` (defined in Task 4) with the comprehensive version:

```javascript
  // Enhanced onWSClose with exponential backoff and retry-UI fallback.
  // After 5 consecutive failures, shows "Cannot connect to device" in the
  // status bar and a "Retry" button that resets the retry count and
  // attempts a fresh connection.
  function onWSClose() {
    ws = null;
    configForm.setAttribute('aria-busy', 'true');
    wsRetries++;
    if (wsRetries >= 5) {
      // Give up on auto-reconnect — show permanent error + Retry button.
      showError('Cannot connect to device');
      var retryBtn = document.getElementById('btn-ws-retry') || createRetryButton();
      retryBtn.hidden = false;
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, capped at 15s.
    var delay = Math.min(1000 * Math.pow(2, wsRetries), 15000);
    showError('Connection lost. Retrying in ' + (delay / 1000) + 's\u2026');
    wsReconnectTimer = setTimeout(connectWS, delay);
  }
```

- [ ] **Step 3: Create retry button function**

```javascript
  // Creates and returns a Retry button placed after the status bar. Clicking
  // it hides the button, resets the retry counter, and attempts a fresh WS
  // connection. The button is created once and reused via hidden toggle.
  function createRetryButton() {
    var btn = document.createElement('button');
    btn.id = 'btn-ws-retry';
    btn.className = 'secondary';
    btn.textContent = 'Retry';
    btn.addEventListener('click', function () {
      btn.hidden = true;
      wsRetries = 0;
      connectWS();
    });
    document.getElementById('status-bar').after(btn);
    return btn;
  }
```

- [ ] **Step 4: Write reconnect tests**

Add to `tests/unit/app.test.js`:

```javascript
describe('WS reconnect', () => {
  beforeEach(() => {
    document.getElementById('status-bar').textContent = ''
    var existing = document.getElementById('btn-ws-retry')
    if (existing) existing.remove()
  })

  it('shows retry button after 5 failed attempts', () => {
    // Simulate 5 close events
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
```

- [ ] **Step 5: Run unit tests**

Run: `npm run test:unit`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/unit/app.test.js
git commit -m "feat: add WS reconnect with backoff and retry UI"
```

---

### Task 8: Update e2e tests, build, and final verification

**Files:**
- Modify: `tests/e2e/app.test.js`
- Modify: `tests/setup.js` (if needed)

- [ ] **Step 1: Update e2e tests for Phase 6**

Rewrite `tests/e2e/app.test.js` comprehensively. Key changes:
- Remove Apply button tests
- Update button state tests for Apply-less world
- Add WS notification tests (using `/api/settings/external-change`)

```javascript
// tests/e2e/app.test.js
import { test, expect } from '@playwright/test'

test.describe('Form rendering', () => {
  test('renders accordion sections from settings', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('details#wifi')).toBeVisible()
    await expect(page.locator('details#gpio')).toBeVisible()
  })

  test('renders correct field types', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.ssid"]')).toBeVisible()
    await expect(page.locator('[name="wifi.password"]')).toHaveAttribute('type', 'password')
    await expect(page.locator('[name="wifi.mode"]')).toBeVisible()
  })

  test('renders nav links', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#nav-list a[href="#wifi"]')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#gpio"]')).toBeVisible()
  })

  test('no pending changes initially', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
    await expect(page.locator('#btn-reset')).toBeDisabled()
  })

  test('tooltip is rendered', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveAttribute('title', 'WiFi network name')
  })

  test('removes aria-busy after settings loaded', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#config-form')).not.toHaveAttribute('aria-busy', 'true')
  })
})

test.describe('Pending detection', () => {
  test('detects text input change', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('MyNetwork')
    await expect(page.locator('#btn-reset')).toBeEnabled()
  })

  test('detects select change', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.mode"]').selectOption('ap')
    await expect(page.locator('#btn-reset')).toBeEnabled()
  })

  test('detects switch change', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#gpio summary').click()
    await page.locator('[name="gpio.initial"]').selectOption('high')
    await expect(page.locator('#btn-reset')).toBeEnabled()
  })

  test('revert clears pending', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('Temporary')
    await expect(page.locator('#btn-reset')).toBeEnabled()
    await page.locator('[name="wifi.ssid"]').fill('')
    await expect(page.locator('#btn-reset')).toBeDisabled()
  })

  test('multiple changes enable Reset', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('details#gpio summary').click()
    await page.locator('[name="wifi.ssid"]').fill('A')
    await page.locator('[name="gpio.pin"]').fill('7')
    await expect(page.locator('#btn-reset')).toBeEnabled()
  })
})

test.describe('Save & Apply button', () => {
  test('Save & Apply enabled when dirty flag true', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('DirtyTest')
    // Blur triggers WS apply which makes server dirty
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
  })

  test('Save & Apply clears dirty after save', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('SaveTest')
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeEnabled()
    await page.locator('#btn-save-apply').click()
    await page.waitForTimeout(500)
    await expect(page.locator('#btn-save-apply')).toBeDisabled()
  })
})

test.describe('Navigation and hash', () => {
  test('nav click opens accordion', async ({ page }) => {
    await page.goto('/')
    await page.locator('#nav-list a[href="#gpio"]').click()
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
  })

  test('URL hash opens section on load', async ({ page }) => {
    await page.goto('/#gpio')
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
  })
})

test.describe('WebSocket notifications', () => {
  test('shows notification on external change', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'ExtNet' }] } },
    })
    await page.waitForTimeout(500)
    await expect(page.locator('#server-changed')).not.toBeHidden()
    await expect(page.locator('#notif-load')).not.toBeHidden()
    await expect(page.locator('#notif-keep')).not.toBeHidden()
  })

  test('Load button accepts server change', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'LoadNet' }] } },
    })
    await page.waitForTimeout(500)
    await page.locator('#notif-load').click()
    await expect(page.locator('#server-changed')).toBeHidden()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('LoadNet')
  })

  test('Keep button preserves local value', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('LocalVal')
    // Trigger blur then wait for external change
    await page.locator('[name="wifi.password"]').focus()
    await page.waitForTimeout(300)
    await page.request.post('/api/settings/external-change', {
      data: { wifi: { ssid: ['text', 'SSID', { value: 'ExtVal' }] } },
    })
    await page.waitForTimeout(500)
    await page.locator('#notif-keep').click()
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('LocalVal')
  })
})

test.describe('Error states', () => {
  test('reset restores default values', async ({ page }) => {
    await page.goto('/')
    await page.locator('details#wifi summary').click()
    await page.locator('[name="wifi.ssid"]').fill('Changed')
    await page.locator('#btn-reset').click()
    await page.waitForTimeout(500)
    await expect(page.locator('[name="wifi.ssid"]')).toHaveValue('')
  })
})
```

- [ ] **Step 2: Build and run all tests**

Run: `npm run build`
Expected: `app.min.js` generated without errors.

Run: `npm run test:unit`
Expected: all unit tests pass.

Run: `python -m pytest test_server/test_main.py -v`
Expected: all server tests pass.

Run: `npm run test:e2e` (requires test server running)
Expected: all e2e tests pass.

- [ ] **Step 3: Commit**

```bash
git add app.js app.min.js tests/e2e/app.test.js tests/setup.js
git commit -m "test: update e2e tests for WebSocket phase, final build"
```

---

### Task 9: Full integration verification

**Files:** (none — verification only)

- [ ] **Step 1: Run complete test suite**

```bash
npm test
```

Expected: all unit tests + all e2e tests pass.

```bash
python -m pytest test_server/test_main.py -v
```

Expected: all server tests pass (including WS tests).

- [ ] **Step 2: Final build**

```bash
npm run build
```

Expected: `app.min.js` generated without errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: final Phase 6 verification and build"
```

---

## Spec Coverage

| Spec Requirement | Task |
|---|---|
| WS endpoint on test server | Task 1 |
| JS connects WS on page load | Task 4 |
| Apply button removed (replaced by apply-on-blur) | Task 5 + Tasks 2-3 |
| Server-push for external changes | Task 6 |
| WS reconnect fallback with error + retry UI | Task 7 |
| POST `/api/settings/save` remains HTTP | Task 2 |
| HTTP GET `/api/settings` replaced by WS initial push | Task 4 |
| Per-field LS and inFlight tracking | Task 4 |
| State machine: 10 cases | Tasks 4, 5, 6 |
| Notification bar (`#server-changed`) | Task 3 (HTML) + Task 6 (JS) |
| Conflict prompt with "Keep all local" / "Accept all server" | Task 6 |
| `aria-busy` during WS connect/reconnect | Tasks 3, 4, 7 |
| `_dirty` drives Save & Apply only | Task 2 |
| External-change simulation endpoint | Task 1 |
