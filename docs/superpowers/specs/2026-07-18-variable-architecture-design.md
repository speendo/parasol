# Variable Architecture — Design Spec

Status: **DRAFT** — contract under review.

---

## Part 1: Contract

The API contract between parasol and the downstream developer.

### 1.1 Three Variable Sets

Parasol recognizes exactly three variable sets. Each has a single owner:

| Set | Owner | Location | parasol role |
|---|---|---|---|
| **Form Values (FV)** | Browser DOM | `<input>`, `<select>`, `<textarea>` | Read-only (`readFormValue`) |
| **Applied Values (AV)** | Parasol `prsl_store` | C in-memory store | Read/write via `prsl_get`/`prsl_set`, broadcast via WS |
| **Saved Values** | Developer | Developer's storage (NVS, etc.) | Only knows `_dirty` boolean (push from developer). No read/write access to saved values. |

### 1.2 Applied Values (AV) — Read API

```c
const char *prsl_get(const char *path);  // e.g. "wifi.ssid"
```

Returns a pointer to the field's string representation. Valid until next `prsl_set` for the same path. Behavior during a locked store (during `on_save`) is defined — reads are allowed and return the current AV.

### 1.3 Applied Values (AV) — Write API

Typed setters for compile-time safety. Each maps to the equivalent cJSON type for wire serialization:

```c
esp_err_t prsl_set_str(const char *path, const char *value);
esp_err_t prsl_set_int(const char *path, int value);
esp_err_t prsl_set_float(const char *path, float value);
esp_err_t prsl_set_bool(const char *path, bool value);
esp_err_t prsl_set_null(const char *path);
```

Does NOT broadcast to clients. Call `prsl_push()` or `prsl_broadcast_status()` after.

### 1.4 Save Button (`_dirty`)

The Save button appears when the `_dirty` wire flag is `true`. Parasol does NOT compute dirty — the developer drives it:

```c
void prsl_set_dirty(bool dirty);
```

- Call `prsl_set_dirty(true)` when AV diverges from saved values
- Parasol clears dirty to `false` after a successful `on_save()` (returns `ESP_OK`)
- Parasol leaves dirty `true` after a failed `on_save()` (returns `ESP_ERR_*`)

Alternatively, set `"always_show_save": true` in `parasol_config.json` to force the Save button visible always. This overrides the `prsl_set_dirty` mechanism entirely.

**Removed:** The dirty check hook (`prsl_is_dirty_cb_t` / `prsl_set_dirty_check`). The "any change = dirty" default behavior. `_dirty` is now exclusively developer-driven.

### 1.5 `on_set` — Per-Field Validation (Optional)

```c
// In prsl_field_opts_t:
//   .on_set = my_validator

// Signature:
typedef esp_err_t (*prsl_set_cb_t)(const char *group_id, const char *key,
                                    const char *value);
```

Fires per-field when a WS `apply` message or a Save request changes a field.

**Inside `on_set`, the developer should call `prsl_set()`** to set the value (possibly transformed). Parasol only calls `prsl_set()` automatically when `on_set` is absent — if `on_set` is registered, the developer owns the write.

Return `ESP_OK` to accept (the value set via `prsl_set` inside the callback is used). Return `ESP_ERR_*` to reject.

Example:
```c
static esp_err_t on_ssid_change(const char *gid, const char *key, const char *value) {
    if (strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    prsl_set_str("wifi.ssid", value);
    prsl_set_dirty(true);
    return ESP_OK;
}
```

### 1.6 Save Transaction

#### `on_save` callback

```c
typedef esp_err_t (*prsl_save_cb_t)(void);
```

Registered at init:
```c
prsl_init(&server, on_save, on_reset);  // on_reset may be NULL
```

#### Transaction order

The Save transaction is atomic with respect to concurrent WS applies. The AV store uses a **recursive mutex** (`xSemaphoreCreateRecursiveMutex`) — the save handler acquires it, and `on_set` → `prsl_set` within the same task re-acquires safely. Concurrent WS apply tasks block until release.

```
1. Lock AV store (recursive mutex)
2. For each field in the Save diff:
   a. If on_set registered: call on_set(path, val)
      → Developer validates, calls prsl_set_str/prsl_set_int/... to write
      → Returns esp_err_t
   b. If on_set not registered: parasol calls prsl_set_str(path, val)
   c. If any on_set returns error → unlock, HTTP 500
3. Call on_save()
   → Developer reads AV via prsl_get(), persists to storage
   → Returns esp_err_t
4. If ESP_OK: clear dirty flag, push settings to WS clients, HTTP 200
5. If ESP_ERR_*: dirty stays true, HTTP 500
6. Unlock AV store
```

#### Locking details

- Recursive mutex allows `on_set` (step 2a) to call `prsl_set()` without deadlock
- Concurrent WS apply handlers block at the mutex — changes wait until Save completes
- `prsl_get()` does NOT acquire the mutex individually (it's held at the transaction level)

**Example:**

```c
static esp_err_t on_save(void) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READWRITE, &h) != ESP_OK) return ESP_FAIL;

    for each registered field {
        const char *path = "wifi.ssid";
        const char *current = prsl_get(path);
        char saved[64]; size_t len = sizeof(saved);
        esp_err_t err = nvs_get_str(h, path, saved, &len);
        if (err != ESP_OK || strcmp(current, saved) != 0) {
            nvs_set_str(h, path, current);
        }
    }

    nvs_commit(h);
    nvs_close(h);
    return ESP_OK;
}
```

### 1.7 `on_reset` — Revert (Optional)

```c
// Registered via prsl_init
typedef esp_err_t (*prsl_reset_cb_t)(void);
```

Triggered by POST `/api/settings/reset`. Recommended behavior: reload saved values from NVS into AV via `prsl_set()`.

### 1.8 Reset Button

The Reset button appears when `_has_reset` is `true` in the settings wire payload. Parasol sets `_has_reset = true` when `on_reset` was registered during `prsl_init` (non-NULL parameter). The button is visible regardless of dirty state — the user can revert unsaved changes at any time.

### 1.9 Client AV Shadow — Read-Only

The client (browser) maintains a read-only copy of AV in `field.opts.value`. This shadow is updated only via server messages (WS settings push or echo). No client-side code writes to it.

When the user clicks "Keep" (rejecting a server update), the client re-sends the form value through the normal WS apply → echo cycle rather than directly mutating the shadow.

### 1.10 Downstream Dev Checklist

1. **Load saved values into AV** via `prsl_set_*()` before `prsl_init()`:

    ```c
    nvs_read("wifi.ssid", &val);
    prsl_set_str("wifi.ssid", val);
    // repeat for each persisted field
    ```

2. **Implement `on_save`** — read each field via `prsl_get()`, compare against saved values, persist only changed, return `esp_err_t`

3. **(Optional) Register `on_set`** per-field for validation

4. **Signal dirty** — call `prsl_set_dirty(true)` when AV diverges from saved values. Common approaches:
   - Inside `on_set` (fires on every change)
   - Once after loading NVS at startup (always mark dirty)
   - From a hardware event / timer that detects external changes
   - Or set `"always_show_save": true` in `parasol_config.json`

5. **(Optional) Implement `on_reset`** — reload saved values into AV

---

## Part 2: Implementing the Contract

Changes required in parasol to fulfill Part 1.

### 2.1 C Library Changes

#### Remove dirty check hook

- Remove `prsl_is_dirty_cb_t` typedef
- Remove `prsl_set_dirty_check()` function
- Remove any default "any change = dirty" logic
- Remove `prsl_store_check_dirty()` callers that compute dirty from AV comparisons
- `prsl_is_dirty()` now returns the developer-set dirty flag only

#### Add `prsl_set_dirty()`

```c
void prsl_set_dirty(bool dirty);
```

Setter for the dirty flag stored in `prsl_store_t`. Thread-safe (mutex-protected). `_dirty` wire field in settings JSON is derived solely from this flag.

#### Add typed `prsl_set` variants

Implement `prsl_set_str`, `prsl_set_int`, `prsl_set_float`, `prsl_set_bool`, `prsl_set_null`. Each wraps a typed cJSON value stored in the AV store. The old `prsl_set(const char*, const char*)` is removed.

#### Update WS apply handler

Same `on_set` behavior as Save: lock, call `on_set` per-field (developer calls `prsl_set_*()` inside), or call `prsl_set_str()` directly if absent. Unlock, then broadcast settings to all clients.

#### Change `on_save` signature

Old:
```c
// In prsl_storage_t struct:
//   .on_save = persist_to_nvs;
typedef esp_err_t (*prsl_storage_cb_t)(cJSON *data);
```

New:
```c
typedef esp_err_t (*prsl_save_cb_t)(void);
```

`prsl_storage_t` is removed. `on_load` is gone (developer calls `prsl_set()` directly before `prsl_init`). `on_reset` becomes a direct parameter of `prsl_init`.

#### Rewrite save handler (`prsl.cpp`)

Current flow:
1. Parse POST body
2. Walk fields, call `prsl_store_set_value` for each
3. Call `prsl_store_check_dirty()`
4. Allocate pairs array on heap
5. Second walk: collect paths/values
6. Call `on_save(pairs, count)` — passing all field data

New flow:
1. Parse POST body
2. Lock AV store (recursive mutex)
3. Walk fields from diff:
   a. If `on_set` registered: call `on_set(path, val)` — developer calls `prsl_set_*()` inside callback
   b. If `on_set` absent: parasol calls `prsl_set_str(path, val)` directly
   c. If any `on_set` returns error → unlock, 500
4. Call `on_save()` — developer reads AV via `prsl_get()`
5. If `ESP_OK`: clear dirty flag, push settings to WS clients, 200
6. If `ESP_ERR_*`: dirty stays true, 500
7. Unlock AV store

#### Remove `prsl_save_pair_t`

- Remove struct definition from `prsl.h`
- Remove all pair-allocation code from save handler
- Remove batching logic

#### Remove `save_max_fields`

- Remove from `parasol_config.json` (see Section 4)
- Remove `PRSL_SAVE_MAX_FIELDS` macro and related CMake logic

#### Locking

The AV store uses a recursive mutex. The Save handler acquires it once; `on_set` → `prsl_set()` re-acquires within the same task safely. Concurrent WS apply handlers block until the Save transaction releases the lock.

Existing mutex (`prsl_store_t.mutex`) changes from a regular mutex to a recursive mutex (`xSemaphoreCreateRecursiveMutex`).

### 2.2 Client JS Changes

#### Add Reset button

A Reset button appears in the footer alongside Save when `_has_reset` is `true` in the settings wire payload. It is always visible (not gated by dirty) — the user can revert unsaved changes at any time.

- Add `<button id="btn-reset">` to `index.html`, initially hidden
- `processSettings` reads `msg._has_reset` and sets `btn-reset.hidden = false` when true
- Click handler: `POST /api/settings/reset` with empty body
- On success: server pushes updated settings, client re-renders (same as Save)

#### Fix "Keep" notification handler

**Bug:** `notif-keep` handler (app.js:781-794) directly writes `field.opts.value = fv`, bypassing the WS echo loop.

**Fix:** Replace with `sendToServer()` calls for each changed field, letting the normal apply → echo cycle update the AV shadow.

**`notif-keep-local` handler** (conflicts, app.js:795-803) already does this correctly — no change needed.

### 2.3 Client AV Shadow — Document and Enforce

No functional change needed beyond the fix in 2.2. The read-only contract is already followed everywhere else. Add comments to `updateAV()` and `processSettings()` noting they are the only writers.

---

## Part 3: Other Tasks

### 3.1 `parasol_config.json` Changes

Add `always_show_save`:
```json
{
  "title": "PARASOL",
  "logo": "/logo.png",
  "favicon": "/favicon.ico",
  "always_show_save": false
}
```

Remove `save_max_fields` (dead from Part 2).

`CMakeLists.txt` reads `always_show_save` and passes `-DPRSL_ALWAYS_SHOW_SAVE=<bool>` at compile time so the library can skip dirty checks entirely when this is set.

### 3.2 Test Server Updates

- Remove `nvs_store` dict and its comparison logic (`_dirty = nvs_store != applied_store`)
- Add `self._dirty` boolean on the test server
- Add `self._has_reset` boolean on the test server, set when any reset endpoint or callback is registered
- Add `POST /api/settings/set-dirty` debug endpoint for e2e tests
- `build_settings()` outputs `_dirty` and `_has_reset` from server state
- Client renders Reset button when `_has_reset` is `true`
- Test `on_save` return value behavior: `ESP_OK` clears dirty, `ESP_ERR_*` keeps it
- Update all existing tests

### 3.3 API_REFERENCE.md Update

Rewrite sections:
- Dirty Check → now documents `prsl_set_dirty()`
- Save Callback → now documents parameterless `esp_err_t prsl_save_cb_t(void)`
- Remove `prsl_save_pair_t` documentation
- Add `always_show_save` config documentation
- Update Quick Start and Full Example

---

## Part 4: Housekeeping

### 4.1 Remove value-setting from `createField()`

Currently `createField()` sets initial values during DOM construction (e.g., `input.value = opts.value` at app.js:896). `populateFromGroups()` immediately sets the same values again.

Remove all value-setting logic from `createField()`:
- Text/email/number/password/tel/url/color: remove `input.value = opts.value`
- Checkbox/switch: remove `input.checked = true` based on `opts.value`
- Radio: remove `radio.checked = true` based on `opts.value`
- Select: remove `option.selected = true` based on `opts.value`
- Textarea: remove `input.value = opts.value`

`populateFromGroups()` becomes the single path for writing values into the DOM.

### 4.2 Remove `prsl_store_check_dirty` call at `prsl.cpp:196`

Already identified as redundant in the July 2026 cleanup (item 11). The new save handler doesn't call it.

---

## Public API Impact

| Change | Breaking? | Version |
|---|---|---|
| `prsl_init` signature: add `on_reset` param, remove `prsl_storage_t` | Yes — C API | Minor |
| Remove `prsl_storage_t` struct | Yes — C API | Minor |
| `prsl_save_cb_t` signature change (`cJSON *` → `void`, add `esp_err_t` return) | Yes — C API | Minor |
| Remove `prsl_save_pair_t` | Yes — C API | Minor |
| Remove `prsl_is_dirty_cb_t` / `prsl_set_dirty_check` | Yes — C API | Minor |
| Replace `prsl_set(path, str)` with typed variants (`prsl_set_str`, `prsl_set_int`, `prsl_set_float`, `prsl_set_bool`, `prsl_set_null`) | Yes — C API | Minor |
| Add `prsl_set_dirty()` | New — additive | Minor |
| Regular mutex → recursive mutex for AV store | Internal only | None |
| Remove `save_max_fields` from config | Yes — config | Minor |
| Add `always_show_save` to config | New — additive | Minor |
| Add `_has_reset` to settings wire payload | New — additive | Minor |
| Client: render Reset button when `_has_reset` is true | New — additive | Minor |
| JS: fix "Keep" handler | Internal only | None |
| JS: remove createField value-setting | Internal only | None |
