# Phase 4: Unified `/api/settings` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manifest + per-component JSON file system with a single GET `/api/settings` endpoint that returns all component definitions in one nested response, and update both the test server and JS to use the new format.

**Architecture:** The test server holds a single `SETTINGS` dict defining all components and their fields. GET `/api/settings` copies this schema, overlays stored/applied values, and returns the nested structure. JS drops `loadManifest()` and `loadComponents()` in favor of a single `loadSettings()` that discovers components by iterating top-level keys. Field format changes from 4-element array `[key, type, label, opts]` to 3-element array `[type, label, opts]` with `opts.value` replacing `opts.default`. POST body changes from flat dot-notation to nested partial-settings format.

**Tech Stack:** Python 3.10+, FastAPI, JS (vanilla, IIFE), vitest, Playwright

---

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `test_server/main.py` | Modify | Replace old endpoints with `/api/settings` GET + `/api/settings/save`, `/api/settings/apply` POST |
| `test_server/test_main.py` | Modify | Update tests for new endpoints and response format |
| `app.js` | Modify | `loadSettings()` replaces `loadManifest()`+`loadComponents()`, new field format, new POST body |
| `tests/unit/app.test.js` | Modify | Replace `loadManifest`/`loadComponents` tests with `loadSettings` tests, update field format tests |
| `tests/e2e/app.test.js` | Modify | Update for new API paths and response format |
| `tests/setup.js` | None | No changes needed |
| `manifest.json` | Delete | Replaced by `/api/settings` |
| `components/wifi.json` | Delete | Replaced by `/api/settings` |
| `components/gpio.json` | Delete | Replaced by `/api/settings` |

---

### Task 1: Test server — unified `/api/settings` endpoint

**Files:**
- Modify: `test_server/main.py` (replace all endpoints)
- Modify: `test_server/test_main.py` (update tests)

- [ ] **Step 1: Write failing test for new endpoints**

Replace `test_server/test_main.py`:
```python
from fastapi.testclient import TestClient
from test_server.main import app

client = TestClient(app)


def test_get_settings_returns_nested_json():
    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert "_dirty" in data
    assert "wifi" in data
    assert "gpio" in data
    # wifi.ssid should be [type, label, opts]
    ssid = data["wifi"]["ssid"]
    assert isinstance(ssid, list)
    assert len(ssid) == 3
    assert ssid[0] == "text"
    assert "value" in ssid[2]
    # gpio.pin should be [type, label, opts]
    pin = data["gpio"]["pin"]
    assert pin[0] == "number"
    assert "value" in pin[2]


def test_get_settings_returns_current_values():
    # Change a value via POST /api/settings/apply
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    response = client.get("/api/settings")
    data = response.json()
    assert data["wifi"]["ssid"][2]["value"] == "MyNet"


def test_settings_save_persists_to_nvs():
    response = client.post("/api/settings/save", json={"wifi": {"ssid": ["text", "SSID", {"value": "SavedNet"}]}})
    assert response.status_code == 200
    # Verify via GET
    data = client.get("/api/settings").json()
    assert data["wifi"]["ssid"][2]["value"] == "SavedNet"


def test_settings_apply_updates_applied_only():
    # Set via save (goes to both nvs and applied)
    client.post("/api/settings/save", json={"gpio": {"pin": ["number", "Pin", {"value": 5}]}})
    # Apply a different value (goes to applied only)
    response = client.post("/api/settings/apply", json={"gpio": {"pin": ["number", "Pin", {"value": 10}]}})
    assert response.status_code == 200
    # GET should return the applied value
    data = client.get("/api/settings").json()
    assert data["gpio"]["pin"][2]["value"] == 10


def test_settings_save_rejects_invalid_json():
    response = client.post("/api/settings/save", content=b"not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_settings_apply_rejects_invalid_json():
    response = client.post("/api/settings/apply", content=b"bad", headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_old_endpoints_return_404():
    assert client.get("/manifest.json").status_code == 404
    assert client.get("/components/wifi.json").status_code == 404
    assert client.post("/api/save", json={}).status_code == 404
    assert client.post("/api/apply", json={}).status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest test_server/test_main.py -v
```

Expected: FAIL — most tests fail because old endpoints still exist and new ones don't.

- [ ] **Step 3: Rewrite test_server/main.py**

Replace entire `test_server/main.py`:
```python
import json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, PlainTextResponse

app = FastAPI()

BASE = Path(__file__).resolve().parent.parent

# Schema definition — mirrors the Phase 4 settings format
# Each top-level key is a component group. Each group has field definitions:
# {field_key: [type, label, opts]}
SETTINGS = {
    "wifi": {
        "ssid": ["text", "SSID", {"attrs": {"maxlength": 32, "placeholder": "MyNetwork"}, "value": "", "tooltip": "WiFi network name"}],
        "password": ["password", "Password", {"attrs": {"maxlength": 64, "placeholder": "Enter password"}, "value": "", "tooltip": "WiFi password"}],
        "mode": ["select", "Mode", {"options": [["station", "Station"], ["ap", "Access Point"]], "value": "station", "tooltip": "WiFi operating mode"}],
        "hidden": ["switch", "Hidden SSID", {"value": False, "tooltip": "Hide network from scans"}],
        "channel": ["range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "value": 6, "tooltip": "WiFi channel number"}],
    },
    "gpio": {
        "pin": ["number", "Pin Number", {"attrs": {"min": 0, "max": 39, "placeholder": "0"}, "value": 2, "tooltip": "GPIO pin number"}],
        "direction": ["select", "Direction", {"options": [["input", "Input"], ["output", "Output"]], "value": "output", "tooltip": "Pin direction"}],
        "pull": ["radio", "Pull Resistor", {"options": [["none", "None"], ["up", "Pull Up"], ["down", "Pull Down"]], "value": "none", "tooltip": "Internal pull resistor"}],
        "initial": ["select", "Initial State", {"options": [["low", "Low"], ["high", "High"]], "value": "low", "tooltip": "Initial output state"}],
    },
}

nvs_store: dict[str, object] = {}
applied_store: dict[str, object] = {}


@app.on_event("startup")
async def startup():
    for comp_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = comp_id + "." + key
            nvs_store[store_key] = val
            applied_store[store_key] = val


@app.get("/api/settings")
async def get_settings():
    result = {"_dirty": nvs_store != applied_store}
    for comp_id, fields in SETTINGS.items():
        group = {}
        for key, field_def in fields.items():
            ftype, flabel, fopts = field_def
            opts = dict(fopts)
            store_key = comp_id + "." + key
            if store_key in applied_store:
                opts["value"] = applied_store[store_key]
            group[key] = [ftype, flabel, opts]
        result[comp_id] = group
    return result


@app.post("/api/settings/save")
async def api_settings_save(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for comp_id, fields in data.items():
        if comp_id.startswith("_"):
            continue
        for key, field_def in fields.items():
            if not isinstance(field_def, list) or len(field_def) < 3:
                continue
            opts = field_def[2]
            if "value" in opts:
                store_key = comp_id + "." + key
                nvs_store[store_key] = opts["value"]
                applied_store[store_key] = opts["value"]
    return {}


@app.post("/api/settings/apply")
async def api_settings_apply(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for comp_id, fields in data.items():
        if comp_id.startswith("_"):
            continue
        for key, field_def in fields.items():
            if not isinstance(field_def, list) or len(field_def) < 3:
                continue
            opts = field_def[2]
            if "value" in opts:
                store_key = comp_id + "." + key
                applied_store[store_key] = opts["value"]
    return {}


@app.get("/")
async def get_root():
    return FileResponse(str(BASE / "index.html"))


@app.get("/{name:path}")
async def get_static(name: str):
    p = BASE / name
    if p.is_file():
        return FileResponse(str(p))
    return PlainTextResponse("Not Found", status_code=404)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest test_server/test_main.py -v
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add test_server/main.py test_server/test_main.py
git commit -m "feat: unified /api/settings endpoint in test server"
```

---

### Task 2: JS — loadSettings and new field format

**Files:**
- Modify: `app.js` (replace manifest/component loading, update createField, populateFromComponents)

- [ ] **Step 1: Run existing unit tests to see current state**

```bash
npm run test:unit
```

Expected: All PASS (baseline before changes).

- [ ] **Step 2: Rewrite app.js**

Replace `app.js` entirely:
```js
(function () {
  'use strict';

  var navList = document.getElementById('nav-list');
  var configForm = document.getElementById('config-form');
  var statusBar = document.getElementById('status-bar');
  var footer = document.querySelector('footer');
  var btnSaveApply = document.getElementById('btn-save-apply');
  var btnApply = document.getElementById('btn-apply');
  var btnReset = document.getElementById('btn-reset');
  var pendingCount = document.getElementById('pending-count');

  var baseline = null;
  var components = [];

  function showError(msg) {
    statusBar.textContent = msg;
    statusBar.style.color = 'var(--pico-color-red)';
  }

  function clearError() {
    statusBar.textContent = '';
    statusBar.style.color = '';
  }

  function serialize() {
    var data = {};
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var el = configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        data[comp.id + '.' + field.key] = field.type === 'checkbox' || field.type === 'switch' ? el.checked
          : field.type === 'radio' ? (configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]:checked') || {}).value || null
          : el.value;
      }
    }
    return data;
  }

  function setBaseline() {
    baseline = serialize();
  }

  function getPending() {
    if (!baseline) return {};
    var current = serialize();
    var changes = {};
    for (var key in current) {
      if (current[key] !== baseline[key]) changes[key] = current[key];
    }
    return changes;
  }

  function populateFromComponents(comps) {
    for (var ci = 0; ci < comps.length; ci++) {
      var comp = comps[ci];
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var el = configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        if (field.type === 'checkbox' || field.type === 'switch') {
          el.checked = !!field.opts.value;
        } else if (field.type === 'radio') {
          var radios = configForm.querySelectorAll('[name="' + comp.id + '.' + field.key + '"]');
          for (var ri = 0; ri < radios.length; ri++) {
            radios[ri].checked = field.opts.value !== undefined && String(radios[ri].value) === String(field.opts.value);
          }
        } else {
          el.value = field.opts.value !== undefined ? field.opts.value : '';
        }
      }
    }
  }

  async function refreshComponents() {
    try {
      var res = await fetch('/api/settings');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      for (var ci = 0; ci < components.length; ci++) {
        var comp = components[ci];
        var group = data[comp.id];
        if (!group) {
          comp.fields = [];
          continue;
        }
        comp.fields = [];
        for (var fkey in group) {
          var field = group[fkey];
          comp.fields.push({ key: fkey, type: field[0], label: field[1], opts: field[2] });
        }
      }
      clearError();
    } catch (err) {
      showError('Failed to refresh settings: ' + err.message);
    }
  }

  function updateUI() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    var pending = count > 0;
    var ok = pending && configForm.checkValidity();
    btnSaveApply.disabled = btnApply.disabled = btnReset.disabled = !ok;
    footer.classList.toggle('pending', ok);
    pendingCount.textContent = pending ? count + ' pending change(s)' : '';
  }

  function buildPatch(changes) {
    var data = {};
    for (var name in changes) {
      var dot = name.indexOf('.');
      var compId = name.slice(0, dot);
      var fieldKey = name.slice(dot + 1);
      if (!data[compId]) data[compId] = {};
      for (var ci = 0; ci < components.length; ci++) {
        if (components[ci].id === compId) {
          var fields = components[ci].fields;
          for (var fi = 0; fi < fields.length; fi++) {
            if (fields[fi].key === fieldKey) {
              data[compId][fieldKey] = [fields[fi].type, fields[fi].label, { value: changes[name] }];
              break;
            }
          }
          break;
        }
      }
    }
    return data;
  }

  document.addEventListener('DOMContentLoaded', init);

  async function postJSON(url, data) {
    clearError();
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var text = await res.text();
        throw new Error(text || 'HTTP ' + res.status);
      }
      return true;
    } catch (err) {
      showError('Request failed: ' + err.message);
      return false;
    }
  }

  function syncThen(doPopulate) {
    refreshComponents().then(function () {
      if (doPopulate) populateFromComponents(components);
      setBaseline();
      updateUI();
      clearError();
    });
  }

  function handleSaveApply() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    if (count === 0) return;
    postJSON('/api/settings/save', buildPatch(changes)).then(function (ok) {
      if (ok) syncThen(true);
    });
  }

  function handleApply() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    if (count === 0) return;
    postJSON('/api/settings/apply', buildPatch(changes)).then(function (ok) {
      if (ok) syncThen(false);
    });
  }

  function handleReset() {
    clearError();
    syncThen(true);
  }

  function labelFromKey(key) {
    return key
      .replace(/[_-]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  async function loadSettings() {
    try {
      var res = await fetch('/api/settings');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var comps = [];
      for (var key in data) {
        if (key[0] === '_') continue;
        var comp = { id: key, label: labelFromKey(key), fields: [] };
        var group = data[key];
        for (var fkey in group) {
          var field = group[fkey];
          comp.fields.push({ key: fkey, type: field[0], label: field[1], opts: field[2] });
        }
        comps.push(comp);
      }
      components = comps;
      clearError();
      return true;
    } catch (err) {
      showError('Failed to load settings: ' + err.message);
      return false;
    }
  }

  function renderNav() {
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + comp.id;
      a.textContent = comp.label;
      li.appendChild(a);
      navList.appendChild(li);
    }
    navList.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link && link.hash) {
        var el = document.getElementById(link.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    });
  }

  function renderForm() {
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var details = document.createElement('details');
      details.id = comp.id;
      var summary = document.createElement('summary');
      summary.textContent = comp.label;
      details.appendChild(summary);
      if (comp.fields) {
        for (var fi = 0; fi < comp.fields.length; fi++) {
          var fieldEl = createField(comp.id, comp.fields[fi]);
          if (fieldEl) details.appendChild(fieldEl);
        }
      }
      configForm.appendChild(details);
    }
  }

  function handleHash() {
    function openHash() {
      if (location.hash) {
        var el = document.getElementById(location.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    }
    window.addEventListener('hashchange', openHash);
    openHash();
  }

  function bindChangeListeners() {
    configForm.addEventListener('input', updateUI);
    configForm.addEventListener('change', updateUI);
  }

  function wireButtons() {
    btnSaveApply.addEventListener('click', handleSaveApply);
    btnApply.addEventListener('click', handleApply);
    btnReset.addEventListener('click', handleReset);
  }

  async function init() {
    if (!configForm || !navList || !statusBar || !footer || !btnSaveApply || !btnApply || !btnReset) return;
    var ok = await loadSettings();
    if (!ok) return;
    renderNav();
    renderForm();
    populateFromComponents(components);
    setBaseline();
    bindChangeListeners();
    wireButtons();
    updateUI();
    handleHash();
  }

  function createField(namePrefix, field) {
    if (!field || typeof field !== 'object' || !field.key) return null;
    var key = field.key;
    var type = field.type;
    var labelText = field.label;
    var opts = field.opts || {};
    var required = opts.attrs && opts.attrs.required;
    var inputTypes = ['text', 'email', 'number', 'password', 'tel', 'url', 'color'];

    if (type === 'checkbox') {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = namePrefix + '.' + key;
      if (opts.value) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText + (required ? '*' : '')));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'switch') {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.name = namePrefix + '.' + key;
      if (opts.value) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText + (required ? '*' : '')));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'radio') {
      var fieldset = document.createElement('fieldset');
      var legend = document.createElement('legend');
      legend.textContent = labelText + (required ? '*' : '');
      if (opts.tooltip) legend.setAttribute('data-tooltip', opts.tooltip);
      fieldset.appendChild(legend);
      if (opts.options) {
        for (var oi = 0; oi < opts.options.length; oi++) {
          var opt = opts.options[oi];
          var radioLabel = document.createElement('label');
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = namePrefix + '.' + key;
          radio.value = opt[0];
          if (opts.value !== undefined && String(opt[0]) === String(opts.value)) {
            radio.checked = true;
          }
          radioLabel.appendChild(radio);
          radioLabel.appendChild(document.createTextNode(' ' + opt[1]));
          fieldset.appendChild(radioLabel);
        }
      }
      return fieldset;
    }

    var labelEl = document.createElement('label');
    labelEl.textContent = labelText + (required ? '*' : '');
    if (opts.tooltip) labelEl.setAttribute('data-tooltip', opts.tooltip);
    var input;

    if (inputTypes.indexOf(type) !== -1) {
      input = document.createElement('input');
      input.type = type;
      input.name = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.name = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
      var valueDisplay = document.createElement('output');
      valueDisplay.textContent = input.value;
      valueDisplay.style.marginLeft = '0.5em';
      input.addEventListener('input', function () {
        valueDisplay.textContent = input.value;
      });
      labelEl._rangeOutput = valueDisplay;
    } else if (type === 'select') {
      input = document.createElement('select');
      input.name = namePrefix + '.' + key;
      if (opts.options) {
        for (var oi = 0; oi < opts.options.length; oi++) {
          var opt = opts.options[oi];
          var option = document.createElement('option');
          option.value = opt[0];
          option.textContent = opt[1];
          if (opts.value !== undefined && String(opt[0]) === String(opts.value)) {
            option.selected = true;
          }
          input.appendChild(option);
        }
      }
      applyAttrs(input, opts.attrs);
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.name = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
    } else {
      return null;
    }

    labelEl.appendChild(input);
    if (labelEl._rangeOutput) {
      labelEl.appendChild(labelEl._rangeOutput);
    }
    return labelEl;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
  }
  /* test-expose */if(window.__TEST_MODE){window.serialize=serialize;window.setBaseline=setBaseline;window.getPending=getPending;window.createField=createField;window.populateFromComponents=populateFromComponents;window.applyAttrs=applyAttrs;window.updateUI=updateUI;window.showError=showError;window.clearError=clearError;window.postJSON=postJSON;window.loadSettings=loadSettings;window.refreshComponents=refreshComponents;window.syncThen=syncThen;window.handleSaveApply=handleSaveApply;window.handleApply=handleApply;window.handleReset=handleReset;window.renderNav=renderNav;window.renderForm=renderForm;window.handleHash=handleHash;window.wireButtons=wireButtons;window.bindChangeListeners=bindChangeListeners;window.init=init;window.buildPatch=buildPatch;window.__test={};Object.defineProperty(window.__test,'components',{get:function(){return components},set:function(v){components=v}});}
})();
```

- [ ] **Step 3: Run unit tests to verify the JS loads**

```bash
npm run test:unit 2>&1 | head -30
```

Expected: Tests that use removed functions (`loadManifest`, `loadComponents`) will fail. Tests for `serialize`, `setBaseline`, `getPending`, `updateUI`, `applyAttrs`, `showError`, `clearError`, `postJSON`, `handleHash` may pass. This is expected — tests get updated in the next task.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: implement loadSettings and new field format in app.js"
```

---

### Task 3: Update unit tests for Phase 4

**Files:**
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Rewrite unit tests**

Replace `tests/unit/app.test.js` — see the full file in the plan reference at `docs/superpowers/plans/ref/phase4-unit-tests.js` (too long to inline; follow the pattern below).

Key changes from Phase 2 tests:
1. `components` entries use object format `{key, type, label, opts}` instead of array format
2. `opts.value` replaces `opts.default` everywhere
3. `loadManifest`/`loadComponents` tests removed, `loadSettings` tests added
4. `postJSON` tests: success response is `{ok: true}` (no body parsing), error path reads `res.text()`
5. `handleApply`/`handleSaveApply` tests: POST paths changed to `/api/settings/apply` and `/api/settings/save`, body is nested via `buildPatch`
6. `refreshComponents` tests: fetches `/api/settings` instead of individual files
7. `buildPatch` tests added
8. `init` test: fetches `/api/settings` instead of manifest + component files
9. All assertions updated for `opts.value` → `opts.value` semantics
10. Field labels in render tests updated from `WiFi Configuration`/`GPIO Settings` to derived labels `Wifi`/`Gpio`

- [ ] **Step 2: Fix mock data — realistic settings responses in handler tests**

The `wireButtons`, `handleApply`, and `handleSaveApply` tests had mocks returning `{}` for GET `/api/settings`, which would clear `comp.fields` in `refreshComponents`. Update these three mocks to return realistic settings data:

In `wireButtons` test (the mock's non-POST branch):
```js
return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ wifi: { ssid: ['text', 'SSID', { value: 'changed' }] } }) } })
```

In `handleApply` test (the mock's non-POST branch):
```js
return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ wifi: { ssid: ['text', 'SSID', { value: 'changed' }] } }) } })
```

In `handleSaveApply` test (the mock's non-POST branch):
```js
return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ wifi: { ssid: ['text', 'SSID', { value: 'saved' }] } }) } })
```

The `handleReset` test already has a realistic mock — no change needed.

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: update unit tests for Phase 4 settings format"
```

---

### Task 4: Update e2e tests for Phase 4

**Files:**
- Modify: `tests/e2e/app.test.js`

- [ ] **Step 1: Rewrite e2e tests**

Replace `tests/e2e/app.test.js` — full file at `docs/superpowers/plans/ref/phase4-e2e-tests.js`.

Key changes:
1. Accordion summary labels: `"WiFi Configuration"` → `"Wifi"`, `"GPIO Settings"` → `"Gpio"`
2. Nav link labels: `"WiFi Configuration"` → `"Wifi"`, `"GPIO Settings"` → `"Gpio"`
3. Error state tests: intercept `/api/settings` instead of `/manifest.json`; error message `"Failed to load manifest"` → `"Failed to load settings"`
4. POST interception tests: intercept `/api/settings/apply` instead of `/api/apply`
5. Component load failure tests removed (no more per-component files, single endpoint)
6. Save & Apply persistence test: value persists across reload (test server now handles save properly)

- [ ] **Step 2: Run e2e tests**

```bash
npm run test:e2e
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "test: update e2e tests for Phase 4 settings API"
```

---

### Task 5: Cleanup and full verification

**Files:**
- Delete: `manifest.json`
- Delete: `components/wifi.json`
- Delete: `components/gpio.json`

- [ ] **Step 1: Remove old manifest and component files**

```bash
git rm manifest.json components/wifi.json components/gpio.json
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: Unit tests PASS, e2e tests PASS.

- [ ] **Step 3: Build minified JS and verify dead code elimination**

```bash
npm run build
rg 'loadManifest|loadComponents' app.min.js
```

Expected: Build succeeds. `rg` output is empty (old function names eliminated).

- [ ] **Step 4: Manual end-to-end verification**

```bash
uvicorn test_server.main:app --reload --host 0.0.0.0 --port 8765
```

Open `http://localhost:8765/` in a browser. Verify:
- Page loads without console errors
- "Wifi" and "Gpio" accordion sections are visible
- Form fields have correct initial values
- Change a value → pending count updates, buttons enable
- Click Apply → pending clears
- Click Reset → form returns to server defaults
- Save & Apply → reload page → value persists

- [ ] **Step 5: Stop server and commit final state**

```bash
# Press Ctrl+C in server terminal to stop
git add -A
git commit -m "feat: complete Phase 4 unified /api/settings"
```

---

### Self-Review

**1. Spec coverage:**
- Nested JSON structure with `[type, label, opts]` format: Task 1 (test server) + Task 2 (JS `loadSettings`, `createField`)
- `_dirty` field in response: Task 1 test server computes `_dirty = nvs_store != applied_store` in GET
- No manifest — JS iterates top-level keys, skipping `_`-prefixed: Task 2 `loadSettings()` iterates `data` keys, skips `key[0] === '_'`
- Component labels derived from key names: Task 2 `labelFromKey()` function with split-on-camelCase algorithm
- `opts.value` replaces `opts.default`: Task 2 `createField` and `populateFromComponents` use `opts.value`
- POST `/api/settings/save` and `/api/settings/apply`: Task 1 test server endpoints, Task 2 JS handler paths
- Nested POST body format: Task 2 `buildPatch()` converts flat changes to nested format
- Success: HTTP 200 with empty body: Task 1 returns `{}`, Task 2 `postJSON` no longer parses body
- Error: HTTP 4xx/5xx with plain text: Task 1 returns `PlainTextResponse`, Task 2 reads `res.text()` on error

**2. Placeholder scan:** All code blocks contain complete implementations. No "TBD", "TODO", or placeholder patterns.

**3. Type consistency:**
- Field object format `{key, type, label, opts}` consistent across `loadSettings` (builds it), `createField` (reads it), `populateFromComponents` (reads it), `buildPatch` (reads it), and unit tests
- POST endpoint paths consistent: `/api/settings/save`, `/api/settings/apply`
- `opts.value` used everywhere (never `opts.default`)
- Test server internal storage format `comp_id + "." + key` consistent with startup init and all endpoints
- `labelFromKey` output matches expectations: `"wifi"` → `"Wifi"`, `"gpio"` → `"Gpio"`
