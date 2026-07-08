# Pico Website C API Reference

Embedded web configuration UI for ESP32. Register components and fields in C,
serve static assets from flash, and push live status updates over WebSocket —
all from firmware.

## Table of Contents

- [Quick Start](#quick-start)
- [Lifecycle](#lifecycle)
- [Component Registration](#component-registration)
- [Field Registration](#field-registration)
- [Field Options Struct](#field-options-struct)
- [Field Types](#field-types)
- [Runtime Value Access](#runtime-value-access)
- [Push and Broadcast](#push-and-broadcast)
- [Apply Callbacks](#apply-callbacks)
- [Commit Callback](#commit-callback)
- [Checkbox Indeterminate](#checkbox-indeterminate)
- [Full Example](#full-example)

## Quick Start

**Critical ordering rule:** Register ALL components and fields BEFORE calling
`pwui_init`. The store snapshot is taken at init time.

```c
#include "pwui.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

/** @brief Per-field load: return persisted value from NVS.
 *  @return Saved value, or factory default if NVS is empty.
 *          NULL = field starts empty (or indeterminate for checkbox). */
static const char *load_ssid(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("pwui", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.ssid", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    /* Factory default when nothing saved yet */
    return "MyNetwork";
}

/** @brief Apply callback: validate and react to value changes.
 *  Fires on blur/change AND on Save.  Must be idempotent.
 *  @return ESP_OK to accept, anything else to reject (Save aborts). */
static esp_err_t on_ssid_change(const char *comp_id, const char *key,
                                 const char *value) {
    printf("%s.%s = %s\n", comp_id, key, value);
    if (value && strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

/** @brief Commit callback: persists all accepted values to NVS.
 *  Called once on Save, after ALL on_apply have returned ESP_OK.
 *  Compare against current NVS value — skip write if unchanged. */
static void commit_to_nvs(const char *pairs[][2], int count) {
    nvs_handle_t h;
    if (nvs_open("pwui", NVS_READWRITE, &h) != ESP_OK) return;
    for (int i = 0; i < count; i++) {
        char current[64];  size_t len = sizeof(current);
        /* Skip flash write if value hasn't changed */
        if (nvs_get_str(h, pairs[i][0], current, &len) == ESP_OK
            && strcmp(current, pairs[i][1]) == 0) continue;
        nvs_set_str(h, pairs[i][0], pairs[i][1]);
    }
    nvs_commit(h);
    nvs_close(h);
    printf("Saved %d field(s)\n", count);
}

void app_main(void) {
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("pico-config", NULL);
    AsyncWebServer server(80);

    /* Register components and fields BEFORE pwui_init */
    pwui_begin_component("wifi", "Wi-Fi Setup", false);
    pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
        &(pwui_field_opts_t){
            .on_load  = load_ssid,
            .on_apply = on_ssid_change,
            .help     = "Network name \u2014 1\u201332 characters",
            .attrs    = "{\"required\":true,\"maxlength\":32}",
        });
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
        &(pwui_field_opts_t){
            .on_load  = load_pass,
            .on_apply = NULL,   /* auto-accept any value */
            .help     = "At least 8 characters",
        });
    pwui_end_component("wifi");

    /* Status component — on_load is NULL (runtime loop provides values) */
    pwui_begin_component("system", "System Status", true);
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime",
        &(pwui_field_opts_t){ .on_load = NULL, .on_apply = NULL });
    pwui_end_component("system");

    pwui_init(&server, commit_to_nvs);
    pwui_start();

    /* Runtime loop */
    int seconds = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        seconds += 3;
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", seconds);
        pwui_set("system.uptime", buf);
        pwui_broadcast_status();
    }
}
```

---

## Lifecycle

```c
esp_err_t pwui_init(AsyncWebServer *server, pwui_commit_cb_t on_commit);
esp_err_t pwui_start(void);
esp_err_t pwui_reset(void);
```

**Call order:** `pwui_begin_component` / `pwui_add_field` (all of them) → `pwui_init` → `pwui_start` → runtime loop.

`pwui_init` calls every `on_load` to restore persisted values, wires HTTP routes, and snapshots the store. `pwui_start` sets up WebSocket and starts serving. `pwui_reset` re-calls all `on_load` callbacks (discards unsaved changes) and pushes settings to the browser.

## Component Registration

```c
esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status);
esp_err_t pwui_end_component(const char *id);
```

- `is_status = false` — editable settings section.
- `is_status = true` — read-only status section (DOM names get `st-` prefix).
- Same `id` with both `true` and `false` → merged accordion (status fields first, disabled).

## Field Registration

```c
esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id,
                         const char *key, const char *label,
                         const pwui_field_opts_t *opts);

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id,
                              const char *key, const char *label,
                              const char *options[][2], int option_count,
                              const pwui_field_opts_t *opts);
```

`opts` may be `NULL` — fields use empty defaults for all options.

## Field Options Struct

```c
typedef struct {
    pwui_load_cb_t  on_load;   /* REQUIRED field. NULL = depends on type. */
    pwui_apply_cb_t on_apply;  /* REQUIRED field. NULL = auto-accept. */
    const char     *help;      /* NULL = no tooltip */
    const char     *attrs;     /* NULL = no HTML validation */
} pwui_field_opts_t;
```

| Field | NULL behavior |
|---|---|
| `on_load` | Depends on type. `PWUI_CHECKBOX`: indeterminate. All others: field starts empty. |
| `on_apply` | Auto-accept. Equivalent to `return ESP_OK;`. |

**Status fields must set `on_apply = NULL`.** Status fields are read-only (disabled
in the browser). The `on_apply` callback is never reached for status fields under
normal operation — the runtime loop overwrites any status value on the next
`pwui_broadcast_status`.

**Examples:**

```c
/* Full options */
pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
    &(pwui_field_opts_t){
        .on_load  = load_ssid,
        .on_apply = on_ssid_change,
        .help     = "Network name",
        .attrs    = "{\"required\":true,\"maxlength\":32}",
    });

/* Minimal — no options at all */
pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password", NULL);

/* Select with options */
static const char *mode_opts[][2] = {
    {"station", "Station Mode"},
    {"ap",      "Access Point"},
};
pwui_add_field_opts(PWUI_SELECT, "wifi", "mode", "WiFi Mode",
                    mode_opts, 2,
                    &(pwui_field_opts_t){
                        .on_load  = load_mode,
                        .on_apply = on_mode_change,
                        .help     = "Operating mode",
                    });
```

## Field Types

| `pwui_type_t` | HTML rendered | Notes |
|---|---|---|
| `PWUI_TEXT` | `<input type="text">` | |
| `PWUI_NUMBER` | `<input type="number">` | |
| `PWUI_PASSWORD` | `<input type="password">` | |
| `PWUI_EMAIL` | `<input type="email">` | |
| `PWUI_TEL` | `<input type="tel">` | |
| `PWUI_URL` | `<input type="url">` | |
| `PWUI_COLOR` | `<input type="color">` | |
| `PWUI_SWITCH` | `<input type="checkbox" role="switch">` | True/false toggle |
| `PWUI_CHECKBOX` | `<input type="checkbox">` | Three states: `"true"`, `"false"`, NULL (indeterminate) |
| `PWUI_RANGE` | `<input type="range">` | |
| `PWUI_TEXTAREA` | `<textarea>` | |
| `PWUI_RADIO` | Radio group | Use `pwui_add_field_opts` |
| `PWUI_SELECT` | `<select>` | Use `pwui_add_field_opts` |

## Runtime Value Access

```c
esp_err_t pwui_set(const char *path, const char *value);
const char *pwui_get(const char *path);
```

Paths are `"comp_id.key"`, e.g. `"wifi.ssid"`.

## Push and Broadcast

```c
esp_err_t pwui_push(void);              /* Full settings to all WS clients */
esp_err_t pwui_broadcast_status(void);  /* Status-only to all WS clients */
```

## Apply Callbacks

```c
typedef esp_err_t (*pwui_apply_cb_t)(const char *comp_id, const char *key,
                                     const char *value);
```

Fires on every blur/change AND on Save. On Save, if any `on_apply` returns
non-`ESP_OK`, the entire Save is aborted and the browser shows an error.

**Important:** `on_apply` is called twice during Save (once on the original
blur/change, once on the explicit Save click). Make it idempotent — avoid
restarting WiFi or toggling hardware unnecessarily. If you need to distinguish
blur vs Save, track state in your application logic.

**Examples:**

```c
/* Simple validation — reject empty passwords */
static esp_err_t validate_pass(const char *comp_id, const char *key,
                                const char *value) {
    if (!value || strlen(value) < 8) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

/* Live reconfiguration on WiFi change */
static esp_err_t on_wifi_change(const char *comp_id, const char *key,
                                 const char *value) {
    const char *ssid = pwui_get("wifi.ssid");
    const char *pass = pwui_get("wifi.pass");
    WiFi.begin(ssid, pass);  /* idempotent — WiFi.begin is a no-op if unchanged */
    return ESP_OK;
}
```

**Error behavior:** When `on_apply` returns non-`ESP_OK`:

| Path | Behavior |
|---|---|
| **WebSocket apply** (per-blur/change) | Value is NOT stored. Browser receives `{"type":"error","message":"on_apply rejected wifi.ssid"}` in the notification bar. Field keeps its previous value. |
| **HTTP Save** (POST `/api/settings/save`) | Entire Save is aborted (all-or-nothing). HTTP 400 returned with body `"on_apply rejected wifi.ssid"`. NO values are persisted to NVS. `commit_cb` is NOT called. Save button stays enabled. |

## Commit Callback

```c
typedef void (*pwui_commit_cb_t)(const char *pairs[][2], int count);
```

- `pairs[i][0]` — full path, e.g. `"wifi.ssid"`
- `pairs[i][1]` — value string
- Called once after ALL `on_apply` return `ESP_OK`
- Use for one-cycle NVS persistence — open once, write all, commit, close

```c
/* Compare against current NVS value — skip write if unchanged */
static void commit_to_nvs(const char *pairs[][2], int count) {
    nvs_handle_t h;
    if (nvs_open("pwui", NVS_READWRITE, &h) != ESP_OK) return;
    for (int i = 0; i < count; i++) {
        char current[64];  size_t len = sizeof(current);
        if (nvs_get_str(h, pairs[i][0], current, &len) == ESP_OK
            && strcmp(current, pairs[i][1]) == 0) continue;
        nvs_set_str(h, pairs[i][0], pairs[i][1]);
    }
    nvs_commit(h);
    nvs_close(h);
}
```

## Checkbox Indeterminate

When `on_load` returns `NULL` for a `PWUI_CHECKBOX` field, the checkbox renders
in indeterminate state (dash/minus, not checked or unchecked). This is useful
for "inherit from parent" or "not yet configured" semantics.

```c
static const char *load_enable_ai(void) {
    /* If not yet configured, return NULL → indeterminate */
    nvs_handle_t h;
    if (nvs_open("pwui", NVS_READONLY, &h) != ESP_OK) return NULL;
    /* ... read from NVS ... */
    nvs_close(h);
    return NULL;  /* indeterminate until user chooses */
}

pwui_add_field(PWUI_CHECKBOX, "features", "enable_ai", "Enable AI",
    &(pwui_field_opts_t){
        .on_load  = load_enable_ai,
        .on_apply = NULL,
        .help     = "Enable experimental AI features",
    });
```

User clicks checkbox once → `"true"`. Clicks again → `"false"`. Clicks again → `NULL` (indeterminate).

## Full Example

[`components/pico-settings/examples/basic/main.c`](components/pico-settings/examples/basic/main.c)

For the WebSocket protocol, see [`WS_PROTOCOL.md`](WS_PROTOCOL.md).
