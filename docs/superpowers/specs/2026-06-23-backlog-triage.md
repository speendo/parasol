# Backlog Triage — 2026-06-23

## Project Goal

A reusable configuration UI library for ESP32 (and potentially Arduino/ESP8266)
devices. Developers define their settings as JSON, include the JS/CSS/HTML, and
implement a small set of HTTP+WebSocket endpoints. The goal is to define a clean
cutting line: what this library provides vs what the developer's project provides.

---

## High Priority

### 1. Fix form validation

**Status:** Resolved — 2026-06-25

**Symptom:** Required fields didn't show validation styling (red/green borders)
after the WS + blur refactor.

**Root cause (two issues):**
1. PicoCSS v2 validation styling is driven by `aria-invalid` attributes
   (`"true"` = invalid/red, `"false"` = valid/green), not the native
   `:invalid` pseudo-class. The code never set `aria-invalid` on any field.
2. The `mqtt.topic_prefix` regex pattern `^[a-zA-Z0-9_/.#+\-]*$` had an
   unescaped `/` inside the character class, which breaks in the `v`
   (unicodeSets) flag used by modern browsers. This caused a console error
   and prevented pattern validation.

**Fix (two parts):**
1. `renderForm()` now sets `aria-invalid="false"` on all named fields. The
   blur/change handler sets `aria-invalid` based on `checkValidity()` result.
   `reportValidity()` is intentionally NOT called (avoids native pop-ups).
2. Escaped `/` as `\/` in the `topic_prefix` pattern character class.

### 2. ESP32 backend implementation

**Status:** Completed — 2026-07-17

**Goal:** A reusable C/C++ library (ESP-IDF component) that implements the API
contract the Python test server currently provides.

**Scope:** More than matching the test server, less than a full turnkey firmware
image. The library should:

- Serve the static files (HTML, JS, CSS) from SPIFFS/LittleFS
- Implement the unified `/api/settings` JSON structure
- Handle WebSocket connection per the existing protocol (`action: "apply"`,
  `type: "settings"`, `type: "status"`)
- Track `_dirty` (NVS vs applied values), push on connect
- Handle `/api/settings/save` (persist to NVS)
- Support status variables (read-only fields pushed over WS)
- Provide clear hooks/callbacks for the developer's project to register
  settings and status components

**Out of scope (for now):**
- Firmware upload endpoint (see separate item)
- Auth
- mDNS
- Any project-specific business logic

**Cutting line:** The library handles the config UI plumbing (serve files,
serialize/deserialize settings, NVS persistence, WS lifecycle). The developer
supplies the component JSON definitions, status variable callbacks, and any
custom API endpoints beyond settings.

**Implemented:** `prsl_init`, `prsl_start`, `prsl_push`, `prsl_broadcast_status`,
full save/reset lifecycle, typed setters, developer-driven dirty flag,
recursive mutex, status variables, `_show_reset` wire flag.

---

## Medium Priority

### 3. Edge cases — concurrent updates

**Status:** Completed — 2026-06-27

**What:** Review and harden the state machine for edge cases not well covered:

- Rapid blur events (user tabs quickly through fields)
- WS disconnect during in-flight apply
- Multiple browser tabs connected to same device
- Fields with falsey values (0, false, "") — string coercion edge cases
- Status push arriving while conflict prompt is visible
- Server sends partial update (not all components)
- Save-and-apply with empty diff (only dirty flag set)

### 4. Navbar image + favicon

**Status:** Completed — 2026-06-26

**What:** Support a logo image in the nav header and a favicon, both served as
static files from SPIFFS.

**Design:** By convention, if `/logo.png` and `/favicon.ico` exist on SPIFFS,
`index.html` includes them. No upload UI needed — developer places files at
build time.

**Changes:**
- `index.html`: add `<link rel="icon">` and `<img>` in header, gated by a
  simple existence check (or always present with `onerror` fallback)
- Max 2-3 lines of HTML

### 5. Group name labels

**Status:** Completed — 2026-06-26

**What:** Optional `"label"` field in component JSON to override the
auto-derived label from `camelCase`/`snake_case` parsing.

**Current behavior:** `labelFromKey("wifi_ssid")` → `"Wifi Ssid"`.
`labelFromKey("AudioInterface")` → `"Audio Interface"`.

**New behavior:** If a component provides `"label": "Wi-Fi Configuration"`,
use that directly. Otherwise fall back to `labelFromKey(key)`.

**JSON shape change:**
```json
{
  "wifi": {
    "label": "Wi-Fi Configuration",
    "ssid": ["text", "SSID", {"value": "MyNetwork"}]
  }
}
```

The `"label"` key is reserved at the group level. It overrides the auto-derived
label from `labelFromKey()`. When absent, the existing key-name derivation applies.
Unlike `_dirty` (a wire-protocol envelope key), `"label"` lives inside the group
object and is a user-facing attribute, so it does not need the `_` prefix.

**Changes:** 4 lines in `processSettings` and `processStatus`.

### 6. Reset to saved state

**Status:** Completed — 2026-07-17

**What:** A "Reset" button that tells the server to reload NVS settings into
applied values, then pushes the result to the client over WS.

**Flow:**
1. User clicks "Reset" → POST `/api/settings/reset`
2. Server loads NVS → applied values (discarding any live-only changes)
3. Server pushes full settings + `_dirty=false` over WS
4. Client receives like a normal settings push — form updates, baseline resets

**Note:** The test server already has `/api/settings/reset` for e2e tests.
This would make it a real feature.

**Changes:**
- Client: add Reset button in footer, POST handler
- ESP32 backend: implement the reset endpoint (reload NVS → AV)
- Test server: already exists

### 7. Checkbox re-implementation (third indeterminate state)

**Status:** Completed — 2026-06-26

**What:** Bring back `<input type="checkbox">` as a distinct field type from
`switch`, justified by the third **indeterminate** state.

**Rationale:** A `<input type="checkbox" role="switch">` is always on or off.
A plain checkbox can be `indeterminate` — a visual "not yet set" state that
surfaces missing user choices at a glance. The indeterminate checkbox renders
as `null` on the wire, distinct from `true`/`false`.

**Wire format:** `true` (checked), `false` (unchecked), `null` (indeterminate).

**Validation:** `null` (indeterminate) does not inherently block submission.
It follows the standard `required` rule — if `required`, an indeterminate
checkbox fails validation; otherwise `null` submits as-is.

**Changes:**
- Add `"checkbox"` to `createField()` field type dispatch
- `serialize()`/`populateFromComponents()`: handle `null` for indeterminate
- CSS: indeterminate checkbox styling (distinct from checked/unchecked)
- Update `docs/reference/field-format.md` with the three-state wire format

---

## Lower Priority

### 8. Reboot server

**Status:** In Progress — design spec: `2026-07-19-reboot-button-and-v060-release-design.md`

**What:** A "Reboot" action in the nav dropdown, with a Pico CSS confirmation
modal. POSTs to `/api/system/reboot`.

**Flow:** Click "Reboot" in nav dropdown → confirmation modal → Confirm →
POST → show "Rebooting…" → WS disconnects → exponential backoff reconnect
when device comes back.

**ESP32 side:** Developer provides `on_reboot` callback (nullable) via
`prsl_init()`. Callback should call `esp_restart()`. Parasol provides the
HTTP endpoint and `_show_reboot` wire flag.

### 9. Firmware upload

**What:** An OTA firmware update page.

**Minimal version:** File input + "Upload" button → POST multipart to
`/api/firmware/upload` → shows success/error message.

**Nice-to-have:** Progress bar via XMLHttpRequest `upload.onprogress` event
(works without WS). ESP32 must support chunked OTA updates for this.

**ESP32 side:** ESP-IDF OTA API (`esp_ota_begin`, `esp_ota_write`,
`esp_ota_end`).

### 10. Export/import settings

**What:** Download current settings as a JSON file, upload a JSON file to
restore them.

**Flow:** "Export" button → browser download of `/api/settings` response.
"Import" button → file picker → POST JSON to `/api/settings/import` (or reuse
`/api/settings/save`).

### 11. Basic auth

**What:** Optional HTTP Basic Auth gate on the settings endpoints.

**Out of scope for library:** This belongs at the developer's project level
(ESP-IDF middleware/handler wrapper). The library should not own auth, but
should document how to add it.

### 12. Spec/plan doc tidy ✅ (completed 2026-06-24)

**What:** The `docs/superpowers/` tree was tidied. Outdated specs were
deleted, form validation concepts were merged into the master architecture
spec, and status variables improvements were merged into the status design
spec. The implementation plan lived at `docs/superpowers/plans/2026-06-24-doc-tidy.md` while the work was in progress.

**Final state:**

| File | Kept? |
|---|---|
| `2026-06-18-unified-settings-design.md` | ✓ Master architecture spec |
| `2026-06-23-status-variables-design.md` | ✓ Status design (absorbed improvements) |
| `2026-06-23-checkbox-archive.md` | ✓ Archive — checkbox removal record, `checkpoint/checkbox` branch ref |
| `2026-06-23-backlog-triage.md` | ✓ This document |
| `2026-06-24-code-issues.md` | ✓ Bugs found during tidy |

**Result:** 8 specs → 5 specs, 2 ref files → 0 ref files, `plans/` directory deleted.

### 13. GitHub representation + integration docs

**What:** A polished README with:
- Screenshot of the UI
- Quick-start guide (3 steps: add JSON files, include HTML/JS/CSS, implement 3
  endpoints)
- Full API reference (JSON format, WS protocol, HTTP endpoints)
- ESP32 integration example (ESP-IDF component setup)
- Link to a demo/test project

### 14. v0.6.0 housekeeping

**Status:** In Progress — bundled with reboot button release

**What:** Cleanup and release prep for v0.6.0:

- Version bump `library.json` → 0.6.0
- Update README install example from `v0.1.0` to `v0.6.0`
- Add CHANGELOG covering features since initial release
- Remove `__test` scaffold from `app.js` (lines 999-1011, guarded by `__DEV__`
  but still in source). Requires refactoring unit tests that use
  `window.__test` to access internals.
- Fix stale "tooltip" → "help text" wording in `API_REFERENCE.md:355,365`
  and `prsl.h:51`

---

## Dependency Chain

```
Validation fix ──┐
                 ├──> ESP32 backend ✅ ──> (base for all ESP32-side items)
Edge cases ──────┘

Group name labels ────> ✅
Nav image/favicon ────> ✅
Reset button ─────────> ✅
Checkbox revival ─────> ✅
Doc tidy ─────────────> ✅

Reboot ────────────> (in progress, design spec written)
Firmware upload ───> (needs nothing, but most complex)
Export/import ─────> (needs nothing, pure client + save endpoint)
Basic auth ────────> (out of scope for library)
GitHub/docs ───────> (can be done anytime, best after features stabilize)
v0.6.0 housekeeping > (in progress, bundled with reboot release)
```

## Recommended Order

1. ~~Doc tidy~~ ✅ (completed 2026-06-24)
2. ~~Validation fix~~ ✅ (resolved 2026-06-25)
3. ~~Group name labels~~ ✅ (completed 2026-06-26)
4. ~~Nav image/favicon~~ ✅ (completed 2026-06-26)
5. ~~Edge cases audit~~ ✅ (completed 2026-06-27)
6. ~~Checkbox revival~~ ✅ (completed 2026-06-26)
7. ~~ESP32 backend~~ ✅ (completed 2026-07-17)
8. ~~Reset button~~ ✅ (completed 2026-07-17)
9. Reboot + v0.6.0 housekeeping (in progress)
10. Firmware upload (needs nothing, most complex)
11. Export/import (can be done independently)
12. GitHub/docs (last, to reflect final state)
