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

**New query** (`prsl.h`):
```c
bool prsl_has_reboot(void);
```

Returns `true` if `on_reboot` was non-NULL at init.

### HTTP endpoint

`POST /api/system/reboot`

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

### WebSocket protocol

Add `_show_reboot: bool` to every settings payload, same as `_show_reset`.

Three locations:
1. `prsl_push()` in `prsl.cpp` — include `_show_reboot`
2. `prsl_ws.cpp` connect handler — include `_show_reboot`
3. `prsl_ws.cpp` apply broadcast — include `_show_reboot`

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

- New endpoint: `POST /api/system/reboot` → returns `{"ok": true}` (no actual
  restart in test mode)
- Add `_show_reboot: True` to all WS settings payloads
- Add `_show_reset: True` to all WS settings payloads (currently missing —
  the C backend sends it but the test server doesn't, which means reset button
  e2e tests may not be testing visibility correctly)

### E2E tests (`tests/e2e/app.test.js`)

1. **Dropdown visible** — "System" dropdown appears in nav when `_show_reboot` is true
2. **Modal opens** — clicking "Reboot" in dropdown opens confirmation dialog
3. **Cancel** — clicking Cancel closes dialog, no POST sent
4. **Confirm** — clicking Reboot closes dialog, POST sent to `/api/system/reboot`, status bar shows "Rebooting…"
5. **WS disconnect** — after reboot POST, WebSocket disconnects

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

Update `components/parasol/library.json` version from `"0.5.0"` to `"0.6.0"`.

### 2. README update

In `README.md`, update the install example from `v0.1.0` to `v0.6.0`.

### 3. CHANGELOG

Create `CHANGELOG.md` covering all notable changes since initial release:

- **0.6.0** — Reboot button (nav dropdown + confirmation modal)
- **0.5.0** — Typed setters (`prsl_set_str/int/float/bool/null`),
  developer-driven dirty flag (`prsl_set_dirty`), reset button,
  recursive mutex, `always_show_save` config, `on_save`/`on_reset` callbacks
- **0.4.0** — Status variables, form validation, group name labels,
  nav image + favicon, checkbox indeterminate state

### 4. Remove `__test` scaffold

Remove lines 999-1011 of `app.js` (the `__DEV__`-guarded `window.__test`
block). This code is stripped from `app.min.js` by terser, but shipping
test scaffolding in source is not appropriate for a release.

The unit tests currently access internals via `window.__test`. After removal,
tests must switch to accessing the `parasol` module's public return object
(where internal state is not exposed) or the tests must be restructured to
test through the public API only.

**Impact:** Unit tests that set/read internal state via `window.__test` will
need updating. Specifically: `groups`, `dirty`, `inFlight`, `lastSent`,
`formInteracted`, `showReset`, `statusGroups`, `receiveWSMessage`, `wsReady`.
These tests should be refactored to use the public `parasol` API or removed
if they test implementation details rather than behavior.

### 5. Doc fixes

- `API_REFERENCE.md:355` — Change `/** Tooltip text. */` to `/** Help text. */`
- `API_REFERENCE.md:365` — Change `NULL = no tooltip rendered` to
  `NULL = no help text rendered`
- `prsl.h:51` — Change `NULL = no tooltip rendered` to `NULL = no help text rendered`
