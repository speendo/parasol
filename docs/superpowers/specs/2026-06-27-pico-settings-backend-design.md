# Pico-Settings ESP32 Backend — Design Spec

Status: **COMPLETE** — ready for implementation planning.

---

## 1. Summary

A reusable C library (ESP-IDF component + PlatformIO) that implements the API
contract the Python test server provides. Developers register their settings and
status components at runtime, and the library handles the HTTP/WS plumbing.

**Cutting line:** Library owns the config UI plumbing (serve static files,
serialize/deserialize wire format, WS lifecycle, AV store, dirty tracking).
Developer owns storage (NVS, LittleFS, whatever), component definitions, and
status value updates.

---

## 2. Constraints & Dependencies

| Constraint | Value |
|---|---|
| Platform | ESP-IDF v5.x |
| HTTP/WS lib | ESP32Async/AsyncTCP ~3.4 + ESPAsyncWebServer ~3.11 |
| JSON lib | cJSON (vendored) |
| Static files | Embedded gzipped C byte arrays (not SPIFFS) |
| Library name | `parasol` (may change) |
| C prefix | `prsl_` |

---

## 3. API Contract

### Endpoints (library implements)

| Method | Path | Purpose |
|---|---|---|
| WS | `/api/events` | Primary transport: status on connect, settings on connect, apply handling, push |
| POST | `/api/settings/save` | Persist settings (calls developer's `on_save`) |
| POST | `/api/settings/reset` | Reset to defaults (calls developer's `on_reset`) |

### Endpoints (NOT implemented — removed from contract)

| Method | Path | Reason |
|---|---|---|
| GET | `/api/settings` | Removed — settings are WS-only |
| POST | `/api/settings/apply` | Removed — client uses WS apply, never called this |
| POST | `/api/settings/external-change` | Test harness only |
| POST | `/api/settings/external-status-change` | Test harness only |

### Wire Format

Same as test server. Settings payload:
```json
{"_dirty": true, "wifi": {"ssid": ["text","SSID",{"value":"MyNet"}], ...}}
```

Status payload (no `_dirty`):
```json
{"system": {"uptime": ["text","Uptime",{"value":"3h 0m 15s"}], ...}}
```

### `_dirty` Semantics

Library tracks `_dirty` as a boolean: set `true` when any settings-kind field
changes in AV, cleared `false` after successful `on_save()` or `on_reset()`.
Observable behavior matches the test server's `nvs != applied` comparison.

Status-kind fields do not affect `_dirty`.

---

## 4. Public API (`pwui.h`)

### 4.1 Lifecycle

```c
esp_err_t prsl_init(AsyncWebServer *server, const prsl_storage_t *storage);
esp_err_t prsl_start(void);
```

`prsl_init` registers routes with the supplied server, wires up WS, and calls
`storage.on_load()` to populate the AV store. Must be called after all
`prsl_begin_component` / `prsl_end_component` calls.

### 4.2 Storage Callbacks

```c
typedef esp_err_t (*prsl_storage_cb_t)(cJSON *data);

typedef struct {
    prsl_storage_cb_t on_load;   // populate cJSON from storage
    prsl_storage_cb_t on_save;   // persist cJSON from AV
    prsl_storage_cb_t on_reset;  // reset to factory defaults (populate cJSON)
} prsl_storage_t;
```

Library does NOT own NVS. Developer implements these callbacks. `on_load` is called
once during `prsl_init`. `on_save` is called on POST `/api/settings/save`.
`on_reset` is called on POST `/api/settings/reset`.

### 4.3 Component Registration

```c
esp_err_t prsl_begin_component(const char *id, const char *label, bool is_status);
esp_err_t prsl_end_component(const char *id);
```

- `is_status=false` → settings component, fields affect `_dirty`
- `is_status=true` → status component, fields are read-only, do not affect `_dirty`
- Same `id` can exist in BOTH registries (settings + status for same component name)
- Same `id` in the same kind → `ESP_ERR_INVALID_STATE`

### 4.4 Field Registration

```c
typedef void (*prsl_apply_cb_t)(const char *group_id, const char *key, const char *value);

// For text, number, password, email, tel, url, color, switch, checkbox, range, textarea
esp_err_t prsl_add_field(prsl_type_t type, const char *group_id, const char *key,
                         const char *label, ...);

// For radio, select (takes options array)
esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              ...);
```

Varargs keys:
- `PRSL_VALUE` → `const char *` (default/initial value)
- `PRSL_HELP` → `const char *` (help text)
- `PRSL_APPLY` → `prsl_apply_cb_t` (called per-field on WS apply — settings only)
- `PRSL_ATTRS` → `const char *` (single-quoted JSON, library converts `'` to `"` before parsing)
- `PRSL_NULL` → `(const char*)0` (null value for checkbox indeterminate, status None)
- `PRSL_END` → sentinel, ends varargs

`prsl_apply_cb_t` fires per field when a WS apply message touches that field.
The developer receives the path (e.g. `"wifi.ssid"`) and the new value. Status
fields never receive apply messages, so `PRSL_APPLY` is only meaningful for
settings fields. If `PRSL_APPLY` is absent, the value updates in AV with no
callback.

### 4.5 Error Handling

All registration functions (`prsl_begin_component`, `prsl_end_component`,
`prsl_add_field`, `prsl_add_field_opts`) return `esp_err_t`. Errors are
programming mistakes and should be caught during integration.

**Builder errors:**

| Error | Return |
|---|---|
| NULL id/key/label | `ESP_ERR_INVALID_ARG` |
| Duplicate component ID (same kind) | `ESP_ERR_INVALID_STATE` |
| `add_field` without `begin_component` | `ESP_ERR_INVALID_STATE` |
| `end_component` with no matching begin | `ESP_ERR_INVALID_STATE` |

**Init errors:**

| Error | Return |
|---|---|
| NULL server or storage pointer | `ESP_ERR_INVALID_ARG` |
| `storage.on_load` fails | Error from on_load |
| Builder validation fails (unclosed component) | `ESP_ERR_INVALID_STATE` |
| OOM | `ESP_ERR_NO_MEM` |
| WS registration fails | Error from AsyncWebSocket |

**HTTP handler errors:**

| Scenario | Response |
|---|---|
| Body is not valid JSON | 400 Bad Request |
| `storage.on_save` returns error | 500, keep `_dirty = true` |
| `storage.on_reset` returns error | 500, AV unchanged |
| OOM during JSON parse | 500 |

**WS errors:**

| Scenario | Behavior |
|---|---|
| Malformed JSON | Discard message, log, continue |
| Unknown action (not `"apply"`) | Discard, log, continue |
| Apply to unknown field | Skip that field, process valid ones |
| OOM during build/push | Send empty `{}`, log error |

**Runtime errors (prsl_set/prsl_get):**

| Error | Return |
|---|---|
| Unknown path | `ESP_ERR_NOT_FOUND` |
| NULL value | `ESP_ERR_INVALID_ARG` |

**Concurrency:** The AV store is protected by a FreeRTOS mutex. All store
access (get/set) acquires the mutex internally. WS callbacks (running in
AsyncWebServer's task) and developer code (running in app_main or another task)
can safely call `prsl_set`/`prsl_get` concurrently.

### 4.6 Types

```c
typedef enum {
    PRSL_TEXT, PRSL_NUMBER, PRSL_PASSWORD, PRSL_EMAIL, PRSL_TEL,
    PRSL_URL, PRSL_COLOR, PRSL_SWITCH, PRSL_CHECKBOX,
    PRSL_RANGE, PRSL_TEXTAREA, PRSL_RADIO, PRSL_SELECT
} prsl_type_t;
```

### 4.7 Runtime Value Access

```c
esp_err_t prsl_set(const char *path, const char *value);  // "wifi.ssid"
const char *prsl_get(const char *path);
```

- Status values are set by the developer (e.g., in their own timer callback)
- Settings values are set by WS apply or by the developer (e.g., external change)

### 4.8 Push / Broadcast

```c
esp_err_t prsl_push(void);              // broadcast settings to all WS clients
esp_err_t prsl_broadcast_status(void);  // broadcast status to all WS clients
```

Status broadcast timing is developer-owned. No library timer. Developer sets up
their own FreeRTOS timer or event loop and calls `prsl_broadcast_status()`.

---

## 5. Internal Module Structure

```
components/parasol/
├── CMakeLists.txt
├── library.json
├── include/
│   └── pwui.h              ← public API (developer-facing)
├── src/
│   ├── pwui.c              ← init, lifecycle, builder API, route wiring
│   ├── prsl_store.c        ← AV key-value store, dirty tracking
│   ├── prsl_ws.c           ← WS protocol (connect handshake, apply, broadcast)
│   └── prsl_json.c         ← wire format (build settings/status JSON, parse payloads)
├── dependencies/
│   └── cJSON/              ← vendored
├── scripts/
│   └── generate_assets.py  ← embeds index.html, app.min.js, pico.jade.min.css
└── examples/
    └── basic/              ← dev reference, excluded from firmware build
```

### Module Responsibilities

| Module | Owns |
|---|---|
| `prsl_store.c` | In-memory key-value map (flat `"comp.key" → cJSON* value`). Each value stored with its typed cJSON form (bool, number, string, null) determined by the field's `prsl_type_t`. Per-field `is_status` flag. `_dirty` boolean. `get/set/dirty/clear_dirty`. |
| `prsl_json.c` | `build_settings_json(store)` → cJSON tree (attaches stored cJSON values directly). `build_status_json(store)` → cJSON tree. `parse_apply_payload(cjson_node)` → flat key-value pairs. |
| `prsl_ws.c` | Manages `AsyncWebSocket` for `/api/events`. On connect: push status then settings. On `apply` message: parse → update store → broadcast settings to all clients. |
| `pwui.c` | `init()` wires everything. Builder API collects field definitions pre-init. At `init()` time, definitions are frozen into the store schema. HTTP route handlers (thin wrappers). Static file serving from embedded gzip blobs. |

---

## 6. Data Flow

### Startup
```
prsl_init(&server, &storage)
  └→ Freeze builder definitions → schema map in store
  └→ storage.on_load() → populate AV store, clear dirty
  └→ Register HTTP routes (save, reset)
  └→ Register WS /api/events
  └→ Register static file routes (/, /app.min.js, /pico.jade.min.css)
  └→ prsl_start() → server.begin()
```

### HTTP POST /api/settings/save
```
browser → POST body with settings JSON
  └→ parse payload → update AV store
  └→ storage.on_save(data) → developer persists
  └→ clear _dirty
  └→ response: 200 OK
```

### HTTP POST /api/settings/reset
```
browser → POST
  └→ storage.on_reset() → populate defaults cJSON
  └→ load into AV store, clear _dirty
  └→ push settings to all WS clients
  └→ response: 200 OK
```

### WS /api/events — connect
```
browser → WS connect
  └→ push {"type":"status", "data": build_status_json()}
  └→ push {"type":"settings", "_dirty": store.dirty, "data": build_settings_json()}
```

### WS /api/events — apply
```
browser → {"action":"apply", "data":{"wifi":{"ssid":["text","SSID",{"value":"NewNet"}]}}}
  └→ parse payload → "wifi.ssid" = "NewNet"
  └→ store_set("wifi.ssid", "NewNet"), set _dirty = true
  └→ call field's prsl_apply_cb_t("wifi.ssid", "NewNet") if registered
  └→ broadcast settings to all connected clients
```

### Status updates (developer-driven)
```
developer's timer →
  prsl_set("system.uptime", "3h 12m")
  prsl_set("system.signal", "87")
  prsl_broadcast_status()
    └→ push {"type":"status", "data": build_status_json()} to all clients
```

---

## 7. File Structure (Full Repo)

```
pico-website/
├── app.js
├── app.min.js
├── index.html
├── pico.jade.min.css
├── build.sh
├── package.json / package-lock.json
├── vitest.config.js / playwright.config.js
├── AGENTS.md / README.md / .gitignore
├── docs/
│   ├── reference/field-format.md
│   └── superpowers/
│       ├── specs/   (5 spec docs + this one)
│       └── plans/   (5 plan docs)
├── tests/
│   ├── unit/app.test.js
│   └── e2e/app.test.js
├── test_server/
│   ├── main.py
│   └── requirements.txt
├── test-deps/
├── node_modules/
└── components/parasol/
    └── ... (see section 5)
```

---

## 8. Usage Example

```c
#include "pwui.h"

static esp_err_t load_from_nvs(cJSON *root) {
    // Developer reads NVS keys into cJSON
    cJSON_AddStringToObject(root, "wifi", /* populated cJSON */);
    return ESP_OK;
}

static esp_err_t save_to_nvs(cJSON *root) {
    // Developer writes cJSON contents to NVS
    return ESP_OK;
}

static esp_err_t reset_defaults(cJSON *root) {
    // Developer populates factory defaults
    return ESP_OK;
}

static void on_ssid_apply(const char *path, const char *value) {
    // Developer reconfigures WiFi when SSID changes
    printf("WiFi SSID changed to: %s\n", value);
}

void app_main(void) {
    AsyncWebServer server(80);

    prsl_begin_component("wifi", "Wi-Fi Setup", false);
    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID",
                   PRSL_VALUE, "MyNetwork",
                   PRSL_APPLY, on_ssid_apply,
                   PRSL_END);
    prsl_add_field(PRSL_PASSWORD, "wifi", "pass", "Password",
                   PRSL_HELP, "At least 8 characters", PRSL_END);
    prsl_add_field_opts(PRSL_SELECT, "wifi", "mode", "Mode",
                        wifi_modes, 2, PRSL_VALUE, "station", PRSL_END);
    prsl_end_component("wifi");

    prsl_begin_component("system", "System", true);
    prsl_add_field(PRSL_TEXT, "system", "uptime", "Uptime", PRSL_VALUE, "", PRSL_END);
    prsl_end_component("system");

    prsl_storage_t storage = {
        .on_load = load_from_nvs,
        .on_save = save_to_nvs,
        .on_reset = reset_defaults,
    };

    prsl_init(&server, &storage);
    prsl_start();

    // Developer sets up their own status timer
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", (int)(esp_timer_get_time() / 1000000));
        prsl_set("system.uptime", buf);
        prsl_broadcast_status();
    }
}
```

---

## 9. Decisions Log

| # | Decision | Status |
|---|---|---|
| D1 | ESP-IDF v5.x + ESPAsyncWebServer | ✓ Decided |
| D2 | ESP-IDF component + PlatformIO support | ✓ Decided |
| D3 | Storage owned by developer (callbacks) | ✓ Decided |
| D4 | cJSON for JSON handling | ✓ Decided |
| D5 | Builder registration API | ✓ Decided |
| D6 | Settings + status share builder (is_status flag) | ✓ Decided |
| D7 | Same component ID in both settings and status | ✓ Decided |
| D8 | Varargs + PRSL_END for field options | ✓ Decided |
| D9 | Two add functions (field + field_opts for choices) | ✓ Decided |
| D10 | Status broadcast timer is developer-owned | ✓ Decided |
| D11 | GET /api/settings and POST /api/settings/apply removed | ✓ Decided |
| D12 | Server accepted via prsl_init(server*, ...) | ✓ Decided |
| D13 | Static files embedded as gzipped C byte arrays | ✓ Decided |
| D14 | Client merges settings+status accordions (future) | ✓ Decided |
| D15 | Client auto-prefixes status component IDs | ✓ Decided |
| D16 | 4 internal C modules + 1 public header | ✓ Decided |
| D17 | Library prefix: prsl_ | ✓ Decided |
| D18 | Registration functions return esp_err_t (strict) | ✓ Decided |
| D19 | Per-field prsl_apply_cb_t on WS apply (settings only) | ✓ Decided |
| D20 | Error handling: return codes, HTTP response codes, mutex | ✓ Decided |
| D21 | PRSL_APPLY vararg key for per-field apply callbacks | ✓ Decided |
| D22 | Store values as cJSON* (typed, no string conversion) | ✓ Decided |
| D23 | PRSL_ATTRS as single-quoted JSON string ('→" internally) | ✓ Decided |
| D24 | Host tests via ESP-IDF Unity on Linux target | ✓ Decided |
| D25 | Test server cleanup deferred to implementation phase | ✓ Decided |
| D26 | Assets generation via manual Python script | ✓ Decided |
| D27 | cJSON included as git submodule | ✓ Decided |
| D28 | Apply callback signature: (group_id, key, value) | ✓ Decided |
| D29 | PRSL_NULL sentinel for null values (type-safe pointer-sized NULL) | ✓ Decided |

---

## 10. Remaining Work (Future Specs / Implementation)

| Item | Owner |
|---|---|
| Client-side accordion merge for settings+status | Separate spec (app.js) |
| Client auto-prefixing status component IDs | Implementation (app.js) |
| Test server endpoint removal (GET /api/settings, POST /api/settings/apply) | Implementation phase |
| ESP32 integration tests (hardware/QEMU) | Implementation phase |
