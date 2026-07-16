# Codebase Cleanup — Design Spec

## Scope

Remove dead code, fix naming drift in docs, and address structural issues
identified in the July 2026 codebase review. 14 items, grouped below.

---

## Group A: Dead Code Removal

### 1. Remove `prsl_json_parse_apply`

**What:** Unused JSON parser in `prsl_json.c:117` and `prsl_json.h:11`.
Called only from C unit tests, never from production code.

**Why:** Superseded by inline cJSON parsing in `prsl_ws.cpp` and `prsl.cpp`.
The inline approach avoids an intermediate buffer copy (`groups[][32]`,
`values[][256]`) and handles transport-specific behavior (WS broadcast vs
HTTP response) that the generic function cannot.

**Action:**
- Remove function body from `prsl_json.c`
- Remove declaration from `prsl_json.h`
- Remove all 8 test invocations and related test data from `test_prsl_json.c`

### 2. Remove `prsl_store_lock`/`prsl_store_unlock`

**What:** No-op stubs in `prsl_store.c:161-162` and `prsl_store.h:62-63`.
Never called from anywhere.

**Why:** Stubs for a threading model that was never implemented. If multi-task
access is needed later, the solution will be store-wide locking, not these
per-call stubs.

**Action:**
- Remove function bodies from `prsl_store.c`
- Remove declarations from `prsl_store.h`

### 3. Remove `generate_assets.py`

**What:** Python asset generator at `scripts/generate_assets.py` (65 lines).
Duplicates `cmake/generate_assets.cmake` (118 lines).

**Why:** The CMake script is the one used in the ESP-IDF build (called from
`CMakeLists.txt`). The Python script writes to `src/`, the CMake script
writes to the build directory. Redundant.

**Action:**
- Delete `scripts/generate_assets.py`

### 4. Remove 404 memorial routes

**What:** Four routes in `test_server/main.py:259-276` that always return 404:
`/manifest.json`, `/groups/{name}`, `/api/save`, `/api/apply`.

**Why:** The test server is a dev tool, not production. No e2e tests reference
these routes. An old client hitting missing endpoints falls through to
FastAPI's default 404 handling anyway.

**Action:**
- Remove lines 259-276 from `test_server/main.py`

---

## Group B: Naming Drift (Docs Only)

### 5. tooltip → help

**What:** Wire format key was renamed from `tooltip` to `help` (see
`docs/superpowers/plans/2026-06-26-checkbox-revival.md`). All production code,
test server, and `API_REFERENCE.md` use `help`. But `WS_PROTOCOL.md` and spec
files still reference `tooltip`.

**Action:**
- Replace `tooltip` with `help` in `WS_PROTOCOL.md`
- Replace `tooltip` with `help` in `docs/superpowers/specs/`
- Do NOT update plan files (historical records)

### 6. pwui → prsl

**What:** Project was renamed from `pwui` to `prsl` (see
`docs/superpowers/specs/2026-07-09-parasol-api-redesign.md`). All production
code uses `prsl_*`. `WS_PROTOCOL.md` and the spec
`2026-06-27-pico-settings-backend-design.md` still reference `pwui_*`.

**Action:**
- Replace `pwui_` with `prsl_` in `WS_PROTOCOL.md`
- Replace `pwui_` with `prsl_` in `docs/superpowers/specs/2026-06-27-pico-settings-backend-design.md`
- Do NOT update plan files

### 7. component → group

**What:** Single residual occurrence in
`docs/superpowers/specs/2026-06-18-unified-settings-design.md` line 63:
"component group" → "group."

**Action:**
- One-word fix in that spec

---

## Group C: Structural Improvements

### 8. Thread-safe `prsl_json_value_str`

**What:** Uses `static char buf[64]` — not safe on dual-core ESP32.

**New signature:**
```c
const char *prsl_json_value_str(cJSON *val, char *buf, size_t buf_size);
```

**Callers (2 in production):**
```c
char val_buf[64];
const char *val_str = prsl_json_value_str(val, val_buf, sizeof(val_buf));
```

**Action:**
- Change signature in `prsl_json.h` and `prsl_json.c`
- Update 2 callsites in `prsl.cpp` and `prsl_ws.cpp`
- Update C unit tests to pass buffers

### 9. Save handler: heap-allocated pairs with batching

**What:** `prsl.cpp:164-166` allocates ~9KB on the stack via
`char paths[MAX_PAIRS][128]` and silently truncates at 64 fields.

**New approach:**
- Allocate pairs on the heap: `pair_t *pairs = calloc(store->count, sizeof(pair_t))`
- Collect pairs inline during the single walk (eliminate the second walk)
- Batch into chunks of `PRSL_SAVE_MAX_FIELDS` (default: 32)
- If `store->count > PRSL_SAVE_MAX_FIELDS`, call `g_on_save` multiple times per request
- Memory per batch: `PRSL_SAVE_MAX_FIELDS × ~73 bytes` (~2.4KB at default 32)
- Free pairs at the end

**Config:**
- Add `"save_max_fields": 32` to `parasol_config.json`
- `CMakeLists.txt` reads it and passes `-DPRSL_SAVE_MAX_FIELDS=<N>` at compile time
- `prsl.cpp` has a fallback default of 32 if the macro is not defined
- Document memory calculation: `save_max_fields × 73 bytes` per batch

**Pair struct** (in `prsl.h`, alongside `prsl_save_cb_t`):
```c
typedef struct {
    char  path[65];          // "group_id.field_key" (max 32+1+32)
    const char *value;       // pointer into store's cJSON tree (stable)
} prsl_save_pair_t;
```

**Callback signature change:**
```c
typedef void (*prsl_save_cb_t)(const prsl_save_pair_t *pairs, int count);
```

**Behavior on memory allocation failure:**
- `calloc` returns NULL → return HTTP 500, no data lost (store is already updated)
- `realloc` returns NULL (if grow-on-demand is used) → skip `on_save`, return error

### 10. Test-expose block → module return pattern

**What:** `app.js:972` is a 2000+ character single line that dumps all internals
to `window` when `__TEST_MODE` is true. Relies on terser dead-code elimination.

**New approach:**
```js
var parasol = (function () {
  'use strict';
  // ... all existing code ...
  return {
    init: init,
    serialize: serialize,
    setBaseline: setBaseline,
    getPending: getPending,
    // ... functions needed by tests ...
    processStatus: processStatus
  };
})();
```

**Why it works:**
- `init()` is already auto-called via `DOMContentLoaded` (line 162). No external
  call needed on the live system. The `parasol` global exists but is never used.
- Tests access via `parasol.serialize(...)` instead of `window.serialize(...)`.
- Zero test-only code in `app.js`. Nothing to guard, nothing to strip.
- Terser may even dead-code-eliminate the unused return value.

**Test harness change (`tests/setup.js`):**
- Load `app.js` via eval as before
- Update all test code to use `parasol.*` instead of `window.*`

### 11. Remove redundant `prsl_store_check_dirty` call

**What:** `prsl.cpp:196` calls `prsl_store_check_dirty(&g_store)` after all
fields have already been processed via `prsl_store_set_value`.

**Why redundant:**
- `prsl_store_set_value` already sets dirty per-field during the walk
- `prsl_store_check_dirty` resets dirty to `false`, then rescans all fields
  to set it back to `true` — results in the same state
- Concurrent changes (WS apply) are already handled: the WS path also calls
  `prsl_store_set_value`, which independently marks dirty
- No task switch possible mid-HTTP-handler in the async web server event loop

**Action:**
- Remove `prsl_store_check_dirty(&g_store);` from `prsl.cpp:196`

### 12. Extract `parseFields()` helper

**What:** `processSettings` (`app.js:246-257`) and `processStatus`
(`app.js:282-287`) contain the same field-parsing loop.

**New helper:**
```js
function parseFields(group) {
  var fields = [];
  for (var fieldKey in group) {
    if (fieldKey === 'label') continue;
    var arr = group[fieldKey];
    fields.push({key: fieldKey, type: arr[0], label: arr[1], opts: arr[2]});
  }
  return fields;
}
```

**Action:**
- Extract helper
- Replace both inline loops with `parseFields(group)` calls
- Helper stays internal to the IIFE (no export needed)

### 13. Remove accidental dependency

**What:** `@rolldown/binding-linux-x64-gnu` in `package.json:18`. Never
imported or referenced in any source or build file.

**Action:**
- `npm uninstall @rolldown/binding-linux-x64-gnu`

### 14. Fix `.gitignore` asset paths

**What:** `.gitignore:11-12` references `pwui_assets.c/h` (old name, old path).
Generated files are now `prsl_assets.c/h` and live in the cmake build
directory.

**Action:**
- Remove the two stale lines from `.gitignore`

---

## Public API Impact

| Change | Breaking? | Version |
|--------|-----------|---------|
| `prsl_json_value_str` signature | Yes — C API | Minor (0.4.0) |
| `prsl_save_pair_t` + callback signature | Yes — C API | Minor (0.4.0) |
| `save_max_fields` in `parasol_config.json` | New field, default provided | Minor (0.4.0) |
| JS module return pattern | Internal only | None |

The combined API change (`prsl_json_value_str` + `prsl_save_pair_t` + removal
of dead public functions) warrants a minor version bump to **0.4.0**.

**Files to bump:**
- `components/parasol/library.json` — set `"version": "0.4.0"`
- Tag: `git tag v0.4.0`

---

## Non-Changes

- `prsl_store_check_dirty` stays in `prsl_store.h/c` — it may be useful for
  external callers, just not needed at `prsl.cpp:196`
- Plan files in `docs/superpowers/plans/` are left untouched (historical records)
- The 404 routes are removed entirely, not replaced with tests
