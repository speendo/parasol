# PARASOL API Redesign — 2026-07-09

Rename the project from "pico-settings" (pwui) to "PARASOL" (prsl), rename
"components" to "groups" throughout the API, simplify group registration,
rename the commit callback, add dirty-check hooks, and add build-time page
configuration (title, logo, favicon).

## Motivation

1. **PARASOL** — Pico Async Realtime Application – Socket Operated Library.
   Better name than "pico-settings", reflects the library's scope beyond
   just settings (includes status variables, async push, WebSocket protocol).

2. **"Group" is clearer than "component"** — "component" is overloaded in
   embedded contexts (ESP-IDF components, hardware components). "Group" is
   unambiguous: it's a named collection of related fields in the UI.

 3. **`begin`/`end` pair was awkward** — `pwui_end_component` was a no-op.
    `pwui_begin_component` only registered a label and tracked the `is_status`
    flag for subsequent fields. Moving `is_status` into the field opts struct
    and requiring `prsl_add_group` before fields simplifies the API and
    allows fields to be added in any order.

 4. **`commit_cb` was vague** — `prsl_save_cb_t` / `on_save` directly maps
    to the "Save" button and the act of persisting settings.

 5. **Dirty tracking was opaque** — the library blindly set `_dirty=true` on
     any value change and `_dirty=false` after Save. No way for firmware to
     check dirty state, and Save assumed success without verifying against NVS.

 6. **Page metadata was hardcoded** — title (`"ESP32 Config"`), logo path, and
    favicon path were baked into `index.html`. Build-time JSON config lets
    developers set these without editing HTML.

## API Renames

| Old | New |
|---|---|
| `pwui_` prefix | `prsl_` prefix |
| `PWUI_` enum prefix | `PRSL_` prefix |
| `comp_id` | `group_id` |
| `pwui_begin_component` | Removed |
| `pwui_end_component` | Removed |
| `pwui_commit_cb_t` | `prsl_save_cb_t` |
| `on_commit` | `on_save` |
| `pwui_comp_meta_t` | `prsl_group_meta_t` |
| `pwui_load_cb_t` | `prsl_get_cb_t` |
| `on_load` | `on_get` |
| `pwui_apply_cb_t` | `prsl_set_cb_t` |
| `on_apply` | `on_set` |

## File Renames

| Old | New |
|---|---|
| `components/pico-settings/` | `components/parasol/` |
| `pwui.h` | `prsl.h` |
| `pwui.cpp` | `prsl.cpp` |
| `pwui_store.h` / `.c` | `prsl_store.h` / `.c` |
| `pwui_json.h` / `.c` | `prsl_json.h` / `.c` |
| `pwui_ws.h` / `.cpp` | `prsl_ws.h` / `.cpp` |
| `pwui_assets.h` / `.c` | `prsl_assets.h` / `.c` |
| `test_pwui_store.c` | `test_prsl_store.c` |
| `test_pwui_json.c` | `test_prsl_json.c` |

## New API

### Types

```c
typedef enum {
    PRSL_TEXT, PRSL_NUMBER, PRSL_PASSWORD, PRSL_EMAIL, PRSL_TEL,
    PRSL_URL, PRSL_COLOR, PRSL_SWITCH, PRSL_CHECKBOX,
    PRSL_RANGE, PRSL_TEXTAREA, PRSL_RADIO, PRSL_SELECT
} prsl_type_t;

typedef const char *(*prsl_get_cb_t)(void);

typedef esp_err_t (*prsl_set_cb_t)(const char *group_id, const char *key,
                                      const char *value);

typedef void (*prsl_save_cb_t)(const char *pairs[][2], int count);

/** @brief Developer hook: compare current value against persisted storage.
 *  @return true if current_value differs from NVS/EEPROM (dirty),
 *          false if they match (clean). */
typedef bool (*prsl_is_dirty_cb_t)(const char *group_id, const char *key,
                                    const char *current_value);

typedef struct {
    bool           is_status;  /* false by default via designated init */
    prsl_get_cb_t  on_get;
    prsl_set_cb_t  on_set;
    const char    *help;       /* NULL = no help */
    const char    *attrs;      /* NULL = no HTML validation */
} prsl_field_opts_t;
```

### Group Registration (mandatory)

```c
esp_err_t prsl_add_group(const char *group_id, const char *label);
```

- `group_id` — mandatory, must be unique. Controls JSON key and DOM prefix.
- `label` — optional. NULL = auto-derived from `group_id` (camelCase/snake_case
  splitting, title-cased). Non-NULL overrides auto-derivation.
- Must be called before any `prsl_add_field` referencing that `group_id`.
- Calling `prsl_add_group` with the same `group_id` and same label is a no-op.
  Calling with a different label for an existing `group_id` returns an error.
- Groups can be declared in any order.

### Field Registration (any order)

```c
esp_err_t prsl_add_field(prsl_type_t type, const char *group_id,
                         const char *key, const char *label,
                         const prsl_field_opts_t *opts);

esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id,
                              const char *key, const char *label,
                              const char *options[][2], int option_count,
                              const prsl_field_opts_t *opts);
```

Fields can be registered in any order — interleaved across groups. The only
constraint: `prsl_add_group` must be called first for each group.

### Lifecycle

```c
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save);
esp_err_t prsl_start(void);
esp_err_t prsl_reset(void);
```

Call order: `prsl_add_group` + `prsl_add_field` (all) → `prsl_init` → `prsl_start`.

### Runtime

```c
esp_err_t prsl_set(const char *path, const char *value);
const char *prsl_get(const char *path);
esp_err_t prsl_push(void);
esp_err_t prsl_broadcast_status(void);
```

Paths remain `"group_id.key"`, e.g. `"wifi.ssid"`.

### Dirty Check

```c
void prsl_set_dirty_check(prsl_is_dirty_cb_t is_dirty);
bool prsl_is_dirty(void);
```

The dirty check hook replaces blind `_dirty` toggling with developer-controlled
comparison against persisted storage. Register before `prsl_init`. NULL = any
change is dirty (legacy behavior).

**When the hook fires:**

| Trigger | Behavior |
|---|---|
| WS apply / `prsl_set` | Call hook for changed field. `true` → set dirty |
| After Save | Call hook for **all** fields. Any `true` → `_dirty` stays true |
| `prsl_is_dirty()` | Returns cached state, updated by events above |

**Example hook:**
```c
static bool check_dirty(const char *group_id, const char *key,
                         const char *current_value) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READONLY, &h) != ESP_OK) return true;
    char saved[64]; size_t len = sizeof(saved);
    char path[128];
    snprintf(path, sizeof(path), "%s.%s", group_id, key);
    bool differs = (nvs_get_str(h, path, saved, &len) != ESP_OK ||
                    strcmp(saved, current_value ? current_value : ""));
    nvs_close(h);
    return differs;
}
```

### Page Configuration

A build-time JSON config file defines the page title, logo, and favicon.
The CMake build reads this file, replaces template placeholders in
`index.html`, gzips it, and embeds it into the firmware.

**`parasol_config.json`** (in project root, next to `platformio.ini`):
```json
{
  "title": "My Thermostat",
  "logo": "/logo.png",
  "favicon": "/favicon.ico"
}
```

All fields are optional — defaults are `"PARASOL"`, `"/logo.png"`, `"/favicon.ico"`.

**`index.html` template placeholders:**
```html
<title>{{TITLE}}</title>
<link rel="icon" href="{{FAVICON}}">
...
<li><img id="nav-logo" src="{{LOGO}}" alt="Logo"
         style="height:2rem;vertical-align:middle;margin-right:0.5rem"
         onerror="this.style.display='none'"><h1>{{TITLE}}</h1></li>
```

The logo image has an `onerror` handler — if `/logo.png` doesn't exist on
the ESP32 flash, the image is hidden. The favicon falls back to the
browser default on 404.

**CMake build** (`cmake/generate_assets.cmake`) reads the JSON with
`file(READ "${CONFIG_FILE}" ...)` and `string(JSON ... GET ... title)`
for each field, then `string(REPLACE "{{TITLE}}" ...)` etc. into the HTML
before gzipping. If `parasol_config.json` doesn't exist or a field is
missing, the default value is used.

This is a **build-time** configuration — no runtime C API. The developer
places `logo.png` and `favicon.ico` on the ESP32 flash at the configured
paths.

### Example

```c
#include "prsl.h"

void app_main(void) {
    AsyncWebServer server(80);

    // Dirty check: compare against NVS
    prsl_set_dirty_check(check_dirty);

    // Declare groups
    prsl_add_group("wifi", "Wi-Fi Setup");
    prsl_add_group("gpio", NULL);           // → "Gpio"
    prsl_add_group("system", "System Status");

    // Fields in any order
    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID",
        &(prsl_field_opts_t){ .on_get = load_ssid, .on_set = on_ssid_change });

    prsl_add_field(PRSL_NUMBER, "gpio", "pin", "Pin Number",
        &(prsl_field_opts_t){ .on_get = load_pin, .help = "0-39" });

    prsl_add_field(PRSL_PASSWORD, "wifi", "pass", "Password",
        &(prsl_field_opts_t){ .on_get = load_pass });

    // Status field
    prsl_add_field(PRSL_TEXT, "system", "uptime", "Uptime",
        &(prsl_field_opts_t){ .is_status = true });

    prsl_init(&server, on_save);
    prsl_start();

    // Runtime loop: update status values, broadcast
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        prsl_set("system.uptime", uptime_str());
        prsl_broadcast_status();
    }
}
```

## Files to Update

### Source code (full rename + logic changes)
- `components/parasol/include/prsl.h`
- `components/parasol/src/prsl.cpp`
- `components/parasol/src/prsl_store.h` / `.c`
- `components/parasol/src/prsl_json.h` / `.c`
- `components/parasol/src/prsl_ws.h` / `.cpp`
- `components/parasol/src/prsl_assets.h` / `.c` (regenerated)

### Build
- `components/parasol/CMakeLists.txt`
- `components/parasol/cmake/generate_assets.cmake`
- `components/parasol/library.json`
- `components/parasol/scripts/generate_assets.py`
- `parasol_config.json` (new — example template)
- `index.html` (replace hardcoded title/favicon/logo with template placeholders)

### Tests
- `components/parasol/test/test_prsl_store.c`
- `components/parasol/test/test_prsl_json.c`
- `components/parasol/examples/basic/main.c`
- `tests/unit/app.test.js` (test descriptions: "component" → "group")

### Test server
- `test_server/main.py` (variable renames, comment fix, old route cleanup)
- `test_server/test_main.py` (variable renames, old route test)

### Docs
- `API_REFERENCE.md` — full rewrite to match new API
- `WS_PROTOCOL.md` — "component" → "group" in prose
- `README.md` — "component" → "group", project name update
- `docs/superpowers/specs/` — all spec docs: "component" → "group",
  "pico-settings" → "parasol", "pwui" → "prsl"

### Not changing
- `app.js` — already uses "groups", zero "pwui" references
- JS e2e tests — already clean
- `dependencies/cJSON/` — third-party
- `docs/superpowers/plans/` — historical implementation plans, not current docs

## Wire Protocol

No changes to the JSON format or WebSocket protocol. Group IDs still map to
top-level JSON keys. Page configuration (title, logo, favicon) is build-time
only and does not affect the wire protocol. This is purely a C API and naming
refactor.

## Breaking Changes

This is a **major version bump** — all public API names change:
- `pwui_init` → `prsl_init`
- `pwui_begin_component` / `pwui_end_component` → removed
- `pwui_commit_cb_t` / `on_commit` → `prsl_save_cb_t` / `on_save`
- `pwui_load_cb_t` / `on_load` → `prsl_get_cb_t` / `on_get`
- `pwui_apply_cb_t` / `on_apply` → `prsl_set_cb_t` / `on_set`
- All type names, callback types, enum values
- All `#include` paths
- `prsl_set_dirty_check` and `prsl_is_dirty_cb_t` are new additions
