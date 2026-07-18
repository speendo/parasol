# PRSL C API Reference

Embedded web configuration UI for ESP32. Register groups and fields in C,
serve static assets from flash, and push live status updates over WebSocket —
all from firmware.

## Table of Contents

- [Quick Start](#quick-start)
- [Lifecycle](#lifecycle)
- [Group Registration](#group-registration)
- [Field Registration](#field-registration)
- [Field Options Struct](#field-options-struct)
- [Attrs Format](#attrs-format)
- [Field Types](#field-types)
- [Dirty](#dirty)
- [Runtime Value Access](#runtime-value-access)
- [Push and Broadcast](#push-and-broadcast)
- [Save Callback](#save-callback)
- [Reset Callback](#reset-callback)
- [Build-Time Configuration](#build-time-configuration)
- [Full Example](#full-example)

## Quick Start

This is the exact code you need in your `app_main`. Study it first, then refer
to the sections below for details on each function.

**Critical ordering rule:** Register ALL groups and fields BEFORE calling
`prsl_init`. The store must be fully populated at init time.

```c
/**
 * @file main.c
 * @brief Minimal prsl integration — Wi-Fi config + uptime status.
 *
 * Steps in order:
 *   1. Register groups and fields (structure)
 *   2. prsl_init + prsl_start (lifecycle)
 *   3. Loop: prsl_set_str + prsl_broadcast_status (runtime)
 */

#include "prsl.h"                /**< The only header you need */
#include "WiFi.h"
#include "ESPAsyncWebServer.h"   /**< Required by prsl_init */
#include "nvs_flash.h"
#include <stdio.h>

/* ── Get callbacks ─────────────────────────────────────────────────
 * These callbacks load saved values from NVS on startup. Each returns
 * a string value or NULL if not found.
 */

static const char *load_ssid(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("parasol", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.ssid", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "MyNetwork";
}

/* ── Set callback ─────────────────────────────────────────────────
 * An on_set callback fires every time a field value changes (via
 * WebSocket apply or Save). Use it to react to live changes or
 * reject invalid values.
 */

static esp_err_t on_ssid_change(const char *group_id, const char *key,
                                 const char *value) {
    printf("%s.%s changed to: %s\n", group_id, key, value);
    if (value && strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

/* ── Save callback ─────────────────────────────────────────────────
 * Called once per Save, after all on_set callbacks have passed.
 * Read current values via prsl_get() and persist.
 */

static esp_err_t save_to_nvs(void) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READWRITE, &h) != ESP_OK) return ESP_FAIL;

    const char *ssid = prsl_get("wifi.ssid");
    if (ssid) nvs_set_str(h, "wifi.ssid", ssid);

    const char *pass = prsl_get("wifi.password");
    if (pass) nvs_set_str(h, "wifi.password", pass);

    nvs_commit(h);
    nvs_close(h);
    return ESP_OK;
}

/* ── Reset callback (optional) ────────────────────────────────────
 * Called via prsl_reset. Reload saved values into AV store.
 */

static esp_err_t on_reset(void) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READONLY, &h) != ESP_OK) return ESP_FAIL;
    char buf[64]; size_t len = sizeof(buf);
    if (nvs_get_str(h, "wifi.ssid", buf, &len) == ESP_OK) prsl_set_str("wifi.ssid", buf);
    nvs_close(h);
    return ESP_OK;
}

/* ── Main ─────────────────────────────────────────────────────────── */

void app_main(void) {
    /* 1. Hardware setup */
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-config", NULL);
    AsyncWebServer server(80);

    /* 2. Register groups and fields (BEFORE prsl_init!) */
    prsl_add_group("wifi", "Wi-Fi Setup");
    prsl_add_group("system", "System Status");

    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID",
        &(prsl_field_opts_t){
            .on_get = load_ssid,
            .on_set = on_ssid_change,
            .help   = "Network name - 1-32 characters",
            .attrs  = "{\"required\":true,\"maxlength\":32}",
        });

    prsl_add_field(PRSL_PASSWORD, "wifi", "pass", "Password",
        &(prsl_field_opts_t){
            .on_get = load_pass,
            .help   = "At least 8 characters",
        });

    prsl_add_field(PRSL_TEXT, "system", "uptime", "Uptime",
        &(prsl_field_opts_t){ .is_status = true });

    /* 3. Configure and start */
    prsl_init(&server, save_to_nvs, on_reset);
    prsl_start();

    /* 4. Runtime loop — push live status every 3 seconds */
    int seconds = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        seconds += 3;
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", seconds);
        prsl_set_str("system.uptime", buf);
        prsl_broadcast_status();
    }
}
```

---

## Lifecycle

Two functions start and stop the library. There is no explicit `deinit` —
the web server lives for the ESP32's full uptime.

```c
/**
 * @brief Initialize prsl with a web server, save callback, and optional
 *        reset callback.
 *
 * Wires up HTTP routes (GET /api/settings, POST /api/settings/save)
 * and WebSocket endpoint (/api/events).  Serves static assets from flash.
 *
 * @param server   Pointer to an initialized AsyncWebServer (port 80).
 * @param on_save  Callback to persist current values (prsl_save_cb_t).
 *                 May be NULL if you don't need persistence.
 * @param on_reset Callback to reload saved values (prsl_reset_cb_t).
 *                 May be NULL.
 * @return ESP_OK on success, ESP_ERR_* on failure.
 *
 * @warning All groups and fields MUST be registered BEFORE calling
 *          this function.  The store snapshot is taken at init time. */
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save,
                    prsl_reset_cb_t on_reset);
```

```c
/**
 * @brief Start the async web server.
 *
 * Call this once, after prsl_init and all group/field registration.
 * The server runs indefinitely on the calling task's event loop.
 *
 * @return ESP_OK on success. */
esp_err_t prsl_start(void);
```

**Typical call order in `app_main`:**

```
nvs_flash_init()                  /* hardware                   */
WiFi.softAP(...)                  /* network                    */
prsl_add_group(...)               /* register groups            */
prsl_add_field(...)               /* register fields            */
prsl_init(&server, on_save, on_reset) /* wire routes, snapshot store */
prsl_start()                      /* begin serving              */
/* --- enter runtime loop --- */
prsl_set_str(...)                 /* update values              */
prsl_broadcast_status()           /* push to clients            */
```

---

## Group Registration

Groups are the top-level sections rendered as `<details>` accordions
in the browser. Each group has an `id` (used as the JSON key and DOM
prefix) and a display `label`.

```c
/**
 * @brief Register a group before adding fields to it.
 *
 * @param group_id  Unique string ID, e.g. "wifi" or "system".
 *                  Must be unique across all groups.
 * @param label     Human-readable display label, e.g. "Wi-Fi Setup".
 *                  NULL = auto-derived from group_id (camelCase/snake_case
 *                  splitting, title-cased).
 * @return ESP_OK on success.
 */
esp_err_t prsl_add_group(const char *group_id, const char *label);
```

**Example:**

```c
prsl_add_group("wifi", "Wi-Fi Setup");
prsl_add_group("system", "System Status");
prsl_add_group("auto_label_group", NULL); /* renders as "Auto Label Group" */
```

---

## Field Registration

Two functions cover all field types. Use `prsl_add_field` for simple types
(text, number, checkbox, range, etc.). Use `prsl_add_field_opts` for types
that need a list of options (select, radio).

```c
/**
 * @brief Register a field. opts may be NULL for no callbacks/help/attrs.
 *
 * @param type     Field type from prsl_type_t enum.
 * @param group_id Group ID (must match a prsl_add_group id).
 * @param key      Field key — unique within this group.
 *                 Used as the JSON key and DOM name: "<group_id>.<key>".
 * @param label    Human-readable label for the form field.
 * @param opts     Per-field options (callbacks, help, attrs, is_status).
 *                 May be NULL.
 * @return ESP_OK on success.
 *
 * @note Key must NOT contain dots — the dot separates group from
 *       field in path strings like "wifi.ssid". */
esp_err_t prsl_add_field(prsl_type_t type, const char *group_id, const char *key,
                         const char *label, const prsl_field_opts_t *opts);
```

```c
/**
 * @brief Register a select or radio field with options.
 *
 * Same as prsl_add_field but adds an options array for select/radio.
 *
 * @param type         Must be PRSL_SELECT or PRSL_RADIO.
 * @param group_id     Group ID.
 * @param key          Field key.
 * @param label        Human-readable label.
 * @param options      Array of [value, label] string pairs.
 *                     Must be statically allocated (points to flash).
 * @param option_count Number of entries in @p options.
 * @param opts         Per-field options (callbacks, help, attrs, is_status).
 *                     May be NULL.
 * @return ESP_OK on success. */
esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              const prsl_field_opts_t *opts);
```

**Examples:**

```c
/* Text field with on_get, on_set, help, attrs */
prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID",
    &(prsl_field_opts_t){
        .on_get = load_ssid,
        .on_set = on_ssid_change,
        .help   = "Network name",
        .attrs  = "{\"required\":true,\"maxlength\":32}",
    });

/* Minimal field (NULL opts) */
prsl_add_field(PRSL_NUMBER, "gpio", "pin", "Pin Number", NULL);

/* Range slider with min/max */
prsl_add_field(PRSL_RANGE, "led", "brightness", "Brightness",
    &(prsl_field_opts_t){
        .help  = "0-255",
        .attrs = "{\"min\":0,\"max\":255}",
    });

/* Checkbox with indeterminate state (NULL on_get = indeterminate) */
prsl_add_field(PRSL_CHECKBOX, "features", "enable_ai", "Enable AI",
    &(prsl_field_opts_t){
        .help = "Enable experimental AI features",
    });

/* Select field with options */
static const char *mode_opts[][2] = {
    {"station", "Station Mode"},
    {"ap",      "Access Point"},
    {"ap_sta",  "AP + Station"},
};
prsl_add_field_opts(PRSL_SELECT, "wifi", "mode", "WiFi Mode",
    mode_opts, 3,
    &(prsl_field_opts_t){
        .on_set = on_mode_change,
        .help   = "Operating mode",
    });

/* Radio group */
static const char *role_opts[][2] = {
    {"master", "Master"},
    {"slave",  "Slave"},
};
prsl_add_field_opts(PRSL_RADIO, "cluster", "role", "Role",
    role_opts, 2,
    &(prsl_field_opts_t){ .help = "Cluster node role" });
```

---

## Field Options Struct

All optional per-field parameters are passed through `prsl_field_opts_t`:

```c
typedef struct {
    bool           is_status;  /**< true = read-only status field */
    prsl_get_cb_t  on_get;     /**< Load persisted value. NULL = type default */
    prsl_set_cb_t  on_set;     /**< React to value changes. NULL = auto-accept */
    const char    *help;       /**< Tooltip text. NULL = no tooltip */
    const char    *attrs;      /**< HTML validation attrs as JSON. NULL = none */
} prsl_field_opts_t;
```

| Field | Type | Description |
|---|---|---|
| `is_status` | `bool` | `false` by default. `true` = read-only status field (renders disabled). |
| `on_get` | `prsl_get_cb_t` | Called once per field at init. Return persisted value string, or NULL for default (checkbox→indeterminate, others→empty). |
| `on_set` | `prsl_set_cb_t` | Called on every value change (blur/change via WS) and on Save. Return `ESP_OK` to accept, anything else to reject (Save aborts). |
| `help` | `const char *` | Helper text shown below the field. NULL = no tooltip rendered. |
| `attrs` | `const char *` | JSON string of HTML form attributes (see Attrs Format below). NULL = no validation attributes. |

---

## Attrs Format

The `attrs` field of `prsl_field_opts_t` is a C string containing JSON with
HTML validation attributes. It is processed server-side before reaching the
browser:

```
C string:   "{'required':true,'maxlength':32}"
               │
               ▼  prsl_json_fix_attrs_quotes (single→double quote)
               │
JSON:        {"required":true,"maxlength":32}
               │
               ▼  sent as `opts.attrs` in wire format
               │
Browser:     <input required maxlength="32">
```

**Why single quotes?** JSON requires double quotes, but C string literals must
escape them: `"{\"required\":true}"`. Single-quote attrs in C source
(`"{'required':true}"`) are more readable. `prsl_json_fix_attrs_quotes`
converts them to valid JSON at serialization time. Using double-quoted JSON
in C directly (e.g., `"{\"required\":true}"`) works too — no conversion
happens (no single quotes to replace).

**Supported attributes:** `required`, `min`, `max`, `maxlength`, `minlength`,
`pattern`, `step`, `placeholder`, `autocomplete`.

---

## Field Types

| `prsl_type_t` | HTML rendered | Notes |
|---|---|---|
| `PRSL_TEXT` | `<input type="text">` | |
| `PRSL_NUMBER` | `<input type="number">` | Value is string, server serializes as JSON number |
| `PRSL_PASSWORD` | `<input type="password">` | Value is masked in browser, transmitted normally |
| `PRSL_EMAIL` | `<input type="email">` | Browser validates email format |
| `PRSL_TEL` | `<input type="tel">` | |
| `PRSL_URL` | `<input type="url">` | Browser validates URL format |
| `PRSL_COLOR` | `<input type="color">` | Value is hex string, e.g. `"#ff0000"` |
| `PRSL_SWITCH` | `<input type="checkbox" role="switch">` | True/false toggle |
| `PRSL_CHECKBOX` | `<input type="checkbox">` | Three states: `"true"`, `"false"`, `null` (indeterminate via NULL on_get) |
| `PRSL_RANGE` | `<input type="range">` | Use `attrs` for `min`/`max`/`step` |
| `PRSL_TEXTAREA` | `<textarea>` | Multi-line text input |
| `PRSL_RADIO` | Radio group in `<fieldset>` | Use `prsl_add_field_opts` |
| `PRSL_SELECT` | `<select>` | Use `prsl_add_field_opts` |

---

## Build-Time Configuration

`parasol_config.json` supports these keys:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `title` | string | `"PARASOL"` | Page title |
| `logo` | string | `"/logo.png"` | Navbar logo URL |
| `favicon` | string | `"/favicon.ico"` | Favicon URL |
| `always_show_save` | bool | `false` | Always show Save button, ignore dirty flag |

---

## Dirty

The `_dirty` flag is exclusively developer-driven. Set it true when applied values
diverge from saved values. Parasol clears it to `false` after a successful `on_save`.

```c
/**
 * @brief Set the dirty flag. Parasol clears it after successful on_save.
 * @param dirty true = show Save button, false = hide Save button. */
void prsl_set_dirty(bool dirty);

/**
 * @brief Query whether unsaved changes exist. */
bool prsl_is_dirty(void);
```

**When to call `prsl_set_dirty(true)`:**
- Inside `on_set` (fires on every validated change)
- Once after loading NVS at startup (to always show Save)
- From a hardware event or timer that detects external changes

Alternatively, set `"always_show_save": true` in `parasol_config.json` to force
the Save button visible always.

---

## Runtime Value Access

Typed setters for compile-time safety. None broadcast to clients —
call `prsl_push()` or `prsl_broadcast_status()` after batch updates.

```c
esp_err_t prsl_set_str(const char *path, const char *value);
esp_err_t prsl_set_int(const char *path, int value);
esp_err_t prsl_set_float(const char *path, float value);
esp_err_t prsl_set_bool(const char *path, bool value);
esp_err_t prsl_set_null(const char *path);
```

```c
/**
 * @brief Get a field's current value from AV store.
 * @param path Dot-path string, e.g. "system.uptime".
 * @return Pointer to value string, or NULL. Valid until next prsl_set_*
 *         for the same path. Do NOT free. */
const char *prsl_get(const char *path);
```

---

## Push and Broadcast

Two functions for sending data to connected WebSocket clients.

```c
/**
 * @brief Push full settings to all connected WebSocket clients.
 *
 * Serializes every registered field (settings + status) and broadcasts
 * the full /api/settings JSON to every open WS connection.
 *
 * Use after batch-updating values with prsl_set.  The browser receives
 * a {"type":"settings", ...} message and updates all fields.
 *
 * @return ESP_OK on success. */
esp_err_t prsl_push(void);
```

```c
/**
 * @brief Broadcast status-only data to all connected WebSocket clients.
 *
 * Serializes every field registered with is_status=true and sends a
 * {"type":"status", ...} message.  Settings fields are NOT included.
 *
 * Use in your main loop to push telemetry (uptime, signal, sensors).
 * Much lighter than prsl_push — only status fields go over the wire.
 *
 * @return ESP_OK on success. */
esp_err_t prsl_broadcast_status(void);
```

**Pattern for live status updates:**

```c
while (1) {
    vTaskDelay(pdMS_TO_TICKS(3000));

    float temp = read_temperature_sensor();
    char buf[32];
    snprintf(buf, sizeof(buf), "%.1f", temp);
    prsl_set("sensors.temperature", buf);

    prsl_broadcast_status();
}
```

---

## Save Callback

Registered via `prsl_init` at init time. Called after all `on_set` callbacks pass.
Read current values via `prsl_get()` and persist.

```c
/**
 * @brief Save callback signature.
 *
 * Called without arguments. Developer reads each field via prsl_get()
 * and persists to storage. The AV store is locked during execution.
 *
 * @return ESP_OK on success (dirty cleared, clients updated).
 *         ESP_ERR_* on failure (dirty stays set). */
typedef esp_err_t (*prsl_save_cb_t)(void);
```

**Example — persist to NVS:**

```c
static esp_err_t save_to_nvs(void) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READWRITE, &h) != ESP_OK) return ESP_FAIL;

    const char *ssid = prsl_get("wifi.ssid");
    if (ssid) nvs_set_str(h, "wifi.ssid", ssid);

    const char *pass = prsl_get("wifi.password");
    if (pass) nvs_set_str(h, "wifi.password", pass);

    nvs_commit(h);
    nvs_close(h);
    return ESP_OK;
}
```

## Reset Callback

Optional callback registered via `prsl_init`. Reload saved values into AV.

```c
typedef esp_err_t (*prsl_reset_cb_t)(void);
```

**Example:**

```c
static esp_err_t on_reset(void) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READONLY, &h) != ESP_OK) return ESP_FAIL;
    char buf[64]; size_t len = sizeof(buf);
    if (nvs_get_str(h, "wifi.ssid", buf, &len) == ESP_OK) prsl_set_str("wifi.ssid", buf);
    nvs_close(h);
    return ESP_OK;
}
```

---

## Full Example

The complete, runnable example lives at:
[`components/parasol/examples/basic/main.c`](components/parasol/examples/basic/main.c)

For the WebSocket protocol used between the device and browser, see
[`WS_PROTOCOL.md`](WS_PROTOCOL.md).
