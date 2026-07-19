# Audit Fixes Design

## Overview

Fixes for 8 confirmed issues found during a July 2026 codebase audit:
2 critical bugs in the C backend, 2 JS issues in the client, 2 doc drifts, and
2 cleanups.

---

## C Backend

### 1. Save drops non-string field types

**Bug:** The save handler (`prsl.cpp:181-195`) only passes `cJSON_IsString(sv)`
values to `g_on_save`. CHECKBOX, SWITCH, NUMBER, and RANGE fields store typed
cJSON values (cJSON_True, cJSON_False, cJSON_Number) in `prsl_store_set_value`,
which are silently skipped. After reboot, these values are lost.

**Fix:** Remove the `cJSON_IsString` gate. For every field with a non-null cJSON
value, convert to a string via `prsl_json_value_str`, `strdup` to heap for
stable lifetime during the callback, and add to `all_pairs`. Update the cleanup
loop to free both `path` and `value`.

**File:** `components/parasol/src/prsl.cpp`

**Test:** The save handler in `prsl.cpp` has no existing C unit test coverage
(the C test framework requires ESP-IDF Unity). Add a JS-level regression test
in the e2e suite: submit a save with number and checkbox fields, verify the
test server's NVS store received the correct values (not lost).

**Design note:** The save callback receives strings for all field types.
Developers are responsible for converting back to their expected type (e.g.,
`atoi` for numbers, `strcmp("true", ...)` for booleans). Since the developer
registered each field with a known `prsl_type_t`, there is no ambiguity —
"false" as a string means the text field contains the word false, while a
checkbox would never have been registered as PRSL_TEXT. Document this contract
in `prsl.h`.

### 2. No mutex on store

**Bug:** The global `g_store` is accessed from AsyncWebServer callbacks (WS
apply), HTTP handlers (save), and developer code (status timer). No
synchronization. Concurrent `realloc` of `store->fields` and iteration in
`prsl_json_build_settings` can corrupt memory.

**Fix:** Add a FreeRTOS mutex (`SemaphoreHandle_t`) to `prsl_store_t`. Acquire
on entry, release on exit for these store functions:
- `prsl_store_find`
- `prsl_store_set_value`
- `prsl_store_get_value`
- `prsl_store_add_field`
- `prsl_store_add_group`
- `prsl_store_load_values`
- `prsl_store_reset_values`
- `prsl_store_remove_all`

The mutex is created in `prsl_init` and deleted in `prsl_deinit`. All store
access (including internal calls from `prsl_json_build_settings`) is protected.

**Test:** Not practical to unit-test a mutex. Regression protection comes from
existing e2e tests exercising concurrent-like scenarios (WS apply during status
broadcasts). The `SemaphoreHandle_t` is conditionally compiled out for host-side
C unit tests via a stub header.

**Files:** `components/parasol/src/prsl_store.c`, `prsl_store.h`, `prsl.cpp`
(init/deinit),
`components/parasol/test/stub/` (FreeRTOS stub header)

### 3. Remove unused count functions

Remove `prsl_store_settings_count` and `prsl_store_status_count`:
declarations in `prsl_store.h`, definitions in `prsl_store.c`, and test
cases in `test_prsl_store.c`. No production caller exists.

**Files:** `components/parasol/src/prsl_store.h`, `prsl_store.c`,
`components/parasol/test/test_prsl_store.c`

---

## JavaScript Client

### 4. `__test` scaffold ships in production

**Bug:** `app.js:1010-1025` returns a `__test` object exposing module internals
(`groups`, `dirty`, `inFlight`, `lastSent`, `formInteracted`, `statusGroups`,
`receiveWSMessage`, `wsReady`) in the module return. This survives terser
minification and ships ~300 bytes of unused code to the ESP32.

**Fix:** Remove `__test` from `app.js` module return. In `tests/setup.js`, after
`eval(code)`, inject test hooks by mutating the returned `parasol` object.
Remove the `__test` block and `window.__TEST_MODE` flag.

**Test:** All existing unit tests must pass after the change. The test setup
injects equivalent hooks — the tests themselves don't change. A build check
confirms no `__test` in `app.min.js`.

**Files:** `app.js`, `tests/setup.js`

### 5. `notif-keep-local` resends entire form

**Bug:** On collision, clicking "Keep all local" calls `serialize()` which
iterates every field in every group. Invalid fields get pushed, and untouched
fields get needlessly re-sent.

**Fix:** Iterate the existing `conflicts` array (computed at collision detection
time) instead of `serialize()`. Only fields in the conflict set are re-sent.

**Test:** Add a unit test in `tests/unit/app.test.js` that sets up a
two-field collision, asserts the "Keep all local" button exists, and verifies
via `__test.onWSSend` that only the single conflicting field is sent (not
the other non-conflicting field).

**File:** `app.js` (conflict button handler), `tests/unit/app.test.js`

### 6. Stale WS endpoint comment

Fix `app.js:189` JSDoc comment from `/api/settings/ws` to `/api/events`.

**File:** `app.js`

---

## Documentation

### 7. Update outdated backend spec

`2026-06-27-pico-settings-backend-design.md` still references
`prsl_begin_component`/`prsl_end_component` — an API removed by the
`prsl_add_group` redesign. Update function signatures, code examples, and
prose to match the current API.

**File:** `docs/superpowers/specs/2026-06-27-pico-settings-backend-design.md`

### 8. Align GET /api/settings docs

Three documents disagree:
- `pico-settings-backend-design.md` says it was removed
- `unified-settings-design.md` says it's a fallback
- `prsl.cpp` implements it

Code is source of truth. Update `pico-settings-backend-design.md` to reflect
that GET `/api/settings` is a supported fallback endpoint, matching the other
spec and the implementation.

**Files:** `docs/superpowers/specs/2026-06-27-pico-settings-backend-design.md`,
`docs/superpowers/specs/2026-06-18-unified-settings-design.md` (verify
consistency)

---

## File Manifest

| Change | Files |
|--------|-------|
| Save handler fix | `components/parasol/src/prsl.cpp`, `components/parasol/include/prsl.h` (docs only) |
| Mutex | `components/parasol/src/prsl_store.c`, `prsl_store.h`, `prsl.cpp` |
| Dead code | `components/parasol/src/prsl_store.h`, `prsl_store.c`, `test/test_prsl_store.c` |
| __test removal | `app.js`, `tests/setup.js` |
| notif-keep-local | `app.js` |
| Stale comment | `app.js` |
| Spec update | `docs/superpowers/specs/2026-06-27-pico-settings-backend-design.md`, `2026-06-18-unified-settings-design.md` |

## Verification

- `npm run build` — minified JS must not contain `__test`, `wsReady`, or `readyState`
- `npm run test:unit` — all tests pass including new:
  - `notif-keep-local` only sends conflicting fields (not extra fields)
- `npm run test:e2e` — all tests pass including new:
  - Save persists number and checkbox field values (not silently dropped)
