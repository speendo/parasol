# Reboot Button & v0.6.0 Release — Design Spec

## Scope

Add a Reboot button (nav dropdown + confirmation modal) and ship v0.6.0 with
housekeeping fixes.

---

## Part A: Reboot Button

### Overview

A "Reboot" action accessible from a dropdown in the nav bar. Uses a Pico CSS
`<dialog>` confirmation modal to prevent accidental reboots. Mirrors the existing
reset button pattern on the C side (developer callback, nullable, WS flag).

### C API

**New type** (`prsl.h`):
```c
typedef esp_err_t (*prsl_reboot_cb_t)(void);
```

**Updated `prsl_init` signature:**
```c
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save,
                    prsl_reset_cb_t on_reset, prsl_reboot_cb_t on_reboot);
```

- `on_reboot` is nullable. NULL = no Reboot option in nav (hidden).
- Callback should perform pre-reboot cleanup then call `esp_restart()`.
- Docs should suggest the typical implementation:
  ```c
  esp_err_t on_reboot(void) {
      // any pre-reboot cleanup here
      esp_restart();
      return ESP_OK; // never reached
  }
  ```

**New global** (`prsl.cpp`):
```cpp
static prsl_reboot_cb_t g_on_reboot = NULL;
```
Set in `prsl_init()` alongside `g_on_reset`.

**New query** (`prsl.h`):
```c
bool prsl_has_reboot(void);
```

Returns `true` if `on_reboot` was non-NULL at init. Implementation mirrors
`prsl_has_reset()`:
```cpp
bool prsl_has_reboot(void) {
    return g_on_reboot != NULL;
}
```

### HTTP endpoint

`POST /api/system/reboot`

Note: uses `/api/system/` not `/api/settings/` — reboot is a system action,
not a settings action.

- Calls `g_on_reboot()`.
- Returns 200 on success, 500 on failure.
- No WS push after (device is restarting).
- Developer's callback is responsible for calling `esp_restart()`.

**Implementation** (`prsl.cpp`):
```cpp
server->on("/api/system/reboot", HTTP_POST,
    [](AsyncWebServerRequest *req) {
        if (!g_on_reboot) {
            req->send(404, "text/plain", "Not Found");
            return;
        }
        esp_err_t result = g_on_reboot();
        if (result == ESP_OK) {
            req->send(200, "text/plain", "OK");
        } else {
            req->send(500, "text/plain", "Reboot failed");
        }
    });
```

### Refactoring: shared settings payload helper

Currently `prsl_push()`, the WS connect handler, and the WS apply broadcast
each independently construct `{type:"settings", _dirty, _show_reset, data}`.
Extract into a single function to avoid duplication and give `_show_reboot`
one place to live.

**New function** (`prsl.h`, implemented in `prsl.cpp`):
```c
cJSON *prsl_build_settings_payload(const prsl_store_t *store);
```

```cpp
cJSON *prsl_build_settings_payload(const prsl_store_t *store) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");
    cJSON_AddBoolToObject(root, "_dirty", prsl_store_is_dirty(store));
    cJSON_AddBoolToObject(root, "_show_reset", prsl_has_reset());
    cJSON_AddBoolToObject(root, "_show_reboot", prsl_has_reboot());
    cJSON_AddItemToObject(root, "data", prsl_json_build_settings(store));
    return root;
}
```

Replace the inline JSON construction in all three call sites:

1. `prsl_push()` — build payload, serialize, `g_ws.textAll()`
2. `prsl_ws.cpp` connect handler — build payload, send to new client
3. `prsl_ws.cpp` apply broadcast — build payload, broadcast to all clients

This also eliminates the existing inconsistency where `prsl.cpp` used
`g_on_reset != NULL` inline while `prsl_ws.cpp` called `prsl_has_reset()`.
All paths now go through `prsl_build_settings_payload()`.

### Remove `GET /api/settings` HTTP endpoint

The `GET /api/settings` endpoint registered in `prsl_init()` is removed.
It was only used by the client reset flow as a fallback after the reset POST
succeeded, but `prsl_push()` (called inside the reset handler) already delivers
the same data over WebSocket. The client will rely on the WS push instead.

**Client reset flow update** (`wireButtons()` in `app.js`):

Before:
```js
postJSON('/api/settings/reset', {}).then(function (ok) {
    if (ok) {
        resetInProgress = true;
        configForm.setAttribute('aria-busy', 'true');
        fetch('/api/settings').then(function (res) { return res.json(); }).then(function (data) {
            processSettings(data, data._dirty);
            resetInProgress = false;
        });
    }
});
```

After:
```js
postJSON('/api/settings/reset', {}).then(function (ok) {
    if (ok) {
        resetInProgress = true;
        configForm.setAttribute('aria-busy', 'true');
        // WS push from prsl_push() delivers updated settings.
        // processSettings() clears resetInProgress when settings arrive.
    }
});
```

`processSettings()` must clear `resetInProgress` and remove `aria-busy`:

```js
function processSettings(data, isDirty) {
    // ... existing logic ...
    if (resetInProgress) {
        resetInProgress = false;
        configForm.removeAttribute('aria-busy');
    }
}
```

### Client JS (`app.js`)

**New state:**
```js
var showReboot = false;
```

**`renderNav()`** — after rendering group links, if `showReboot` is true,
append a `<li>` containing a Pico CSS dropdown:
```html
<li>
  <details class="dropdown" id="nav-system">
    <summary>System</summary>
    <ul dir="rtl">
      <li><a href="#" id="nav-reboot">Reboot</a></li>
    </ul>
  </details>
</li>
```

The `<details class="dropdown">` pattern is from Pico CSS nav dropdowns.
Using a dropdown (rather than a bare link) allows adding more system actions
later without restructuring.

**`wireButtons()`** — add click handlers for the modal:
- `nav-reboot` click: `document.getElementById('reboot-dialog').showModal()`
  and close the dropdown by setting the `<details>` open to false.
- `reboot-confirm` click: close dialog, `postJSON('/api/system/reboot', {})`,
  set status bar to "Rebooting…". WS disconnects naturally → `onWSClose()`
  handles reconnect with exponential backoff.
- `reboot-cancel` click: close dialog.

**`onWSMessage()`** — read `_show_reboot` at all 3 code paths (same pattern
as `_show_reset`):
```js
if (msg._show_reboot !== undefined) {
    showReboot = msg._show_reboot;
}
```

### HTML (`index.html`)

Add a `<dialog>` before `</body>`:
```html
<dialog id="reboot-dialog">
  <article>
    <header>
      <button aria-label="Close" rel="prev"></button>
      <p><strong>Reboot device?</strong></p>
    </header>
    <p>The device will restart. You will lose connection briefly.</p>
    <footer>
      <button id="reboot-cancel" class="secondary">Cancel</button>
      <button id="reboot-confirm">Reboot</button>
    </footer>
  </article>
</dialog>
```

### Test server (`test_server/main.py`)

- New endpoint: `POST /api/system/reboot` → closes all WebSocket connections
  (to simulate device restart), then returns `{"ok": true}`
- Add `_show_reboot: True` to all WS settings payloads
- Add `_show_reset: True` to all WS settings payloads (currently missing —
  the C backend sends it but the test server doesn't, which means reset button
  e2e tests may not be testing visibility correctly)

### E2E tests (`tests/e2e/app.test.js`)

1. **Dropdown visible** — "System" dropdown appears in nav when `_show_reboot`
   is true
2. **Modal opens** — clicking "Reboot" in dropdown opens confirmation dialog
3. **Cancel** — clicking Cancel closes dialog, no POST sent
4. **Confirm** — clicking Reboot closes dialog, POST sent to
   `/api/system/reboot`, status bar shows "Rebooting…"
5. **WS disconnect** — after reboot POST, WebSocket close event fires
   (test server closes all WS connections in its reboot handler)

### Unit test additions (`tests/unit/app.test.js`)

- `showReboot` state is read from WS message
- `renderNav()` creates dropdown when `showReboot` is true, omits it when false

### Byte budget

| Component | Unminified | Min+gz |
|-----------|-----------|--------|
| Dialog HTML | ~120 B | ~60 B |
| Nav dropdown HTML | ~80 B | ~40 B |
| JS (state, renderNav, handlers, onWSMessage) | ~200 B | ~80 B |
| **Total** | **~400 B** | **~180 B** |

---

## Part B: Housekeeping for v0.6.0

### 1. Version bump

Update `library.json` version from `"0.5.1"` to `"0.6.0"`.

### 2. README update

In `README.md`, update both install-URL version references from `v0.5.1` to
`v0.6.0`.

### 3. CHANGELOG

Create `CHANGELOG.md` covering all releases from 0.1.0 through 0.6.0.
Reconstruct version history from git tags and commit logs.

- **0.6.0** — Reboot button (nav dropdown + confirmation modal), shared
  settings payload helper, removed `GET /api/settings` endpoint
- **0.5.1** — (contents from git log between v0.5.0 and v0.5.1 tags)
- **0.5.0** — Typed setters (`prsl_set_str/int/float/bool/null`),
  developer-driven dirty flag (`prsl_set_dirty`), reset button,
  recursive mutex, `always_show_save` config, `on_save`/`on_reset` callbacks
- **0.4.0** — Status variables, form validation, group name labels,
  nav image + favicon, checkbox indeterminate state
- **0.1.0 – 0.3.0** — reconstructed from tag history

### 4. Doc fixes

- `API_REFERENCE.md:355` — Change `/** Tooltip text. */` to `/** Help text. */`
- `API_REFERENCE.md:365` — Change `NULL = no tooltip rendered` to
  `NULL = no help text rendered`
- `prsl.h:51` — Change `NULL = no tooltip rendered` to `NULL = no help text rendered`

---

## Resource Impact Summary

### ESP32

| Resource | Delta | Notes |
|---|---|---|
| RAM | **+4 bytes** | One additional static pointer (`g_on_reboot`) |
| Flash | **~-40 bytes** | `prsl_build_settings_payload()` replaces triplicated inline JSON construction at 3 call sites; `GET /api/settings` endpoint removed; net code size reduction |
| Wire per push | **+3 bytes gzipped** | `"_show_reboot":true` compresses to ~3 bytes as repeated boolean |
| Route table | **net zero** | 1 added (`POST /api/system/reboot`), 1 removed (`GET /api/settings`) |

### Client (Browser)

| Resource | Delta | Notes |
|---|---|---|
| JS (min+gz) | **+84 bytes** | `showReboot` state, nav dropdown, 3 WS branch reads, modal handlers, `resetInProgress` cleanup; offset by removed `fetch('/api/settings')` |
| HTML (gzipped) | **+55 bytes** | `<dialog>` block for reboot confirmation modal |
| Network | **+3 bytes** | Per-settings-push payload; no new HTTP requests (modal is DOM-only) |
| Memory | **~1 KB** | `<dialog>` and `<details>` DOM nodes, event closures, one boolean |
| HTTP roundtrips | **-1** | Reset flow no longer fetches `GET /api/settings` after POST; relies on WS push |

### Net Assessment

Feature is **net-negative on ESP32 flash** (good) and **near-zero on RAM** (good). Client cost is ~140 bytes min+gz total — within the ~180 byte budget. Removing `GET /api/settings` eliminates an HTTP roundtrip during reset, which is a latency improvement for the reset flow.
