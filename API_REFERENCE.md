# Pico Website C API Reference

Embedded web configuration UI for ESP32. Register components and fields in C,
serve static assets from flash, and push live status updates over WebSocket —
all from firmware.

## Table of Contents

- [Quick Start](#quick-start)
- [Lifecycle](#lifecycle)
- [Component Registration](#component-registration)
- [Field Registration](#field-registration)
- [Varargs Sentinels](#varargs-sentinels)
- [Field Types](#field-types)
- [Runtime Value Access](#runtime-value-access)
- [Push and Broadcast](#push-and-broadcast)
- [Storage Callbacks](#storage-callbacks)
- [Apply Callbacks](#apply-callbacks)
- [Full Example](#full-example)

## Quick Start

This is the exact code you need in your `app_main`. Study it first, then refer
to the sections below for details on each function.

**Critical ordering rule:** Register ALL components and fields BEFORE calling
`pwui_init`. The store must be fully populated at init time.

```c
/**
 * @file main.c
 * @brief Minimal pwui integration — Wi-Fi config + uptime status.
 *
 * Steps in order:
 *   1. Register components and fields (structure)
 *   2. Configure storage callbacks (values)
 *   3. pwui_init + pwui_start (lifecycle)
 *   4. Loop: pwui_set + pwui_broadcast_status (runtime)
 */

#include "pwui.h"                /**< The only header you need */
#include "WiFi.h"
#include "ESPAsyncWebServer.h"   /**< Required by pwui_init */
#include "nvs_flash.h"
#include <stdio.h>

/* ── Storage callbacks ──────────────────────────────────────────────
 * These three callbacks handle loading saved values, persisting changes,
 * and restoring factory defaults. Only values are returned — the
 * structure (types, labels, help text) was already registered via
 * pwui_add_field above.
 */

/** @brief Load saved values from NVS on startup.
 *  @param root Empty cJSON object — add your saved values here.
 *  @return ESP_OK on success.
 *
 *  Only populate values (strings, numbers, booleans), not the full wire
 *  format.  The library already knows the field types, labels, and
 *  options from your pwui_add_field calls. */
static esp_err_t load_from_nvs(cJSON *root) {
    cJSON *wifi = cJSON_CreateObject();
    cJSON_AddStringToObject(wifi, "ssid", "MyNetwork");
    cJSON_AddStringToObject(wifi, "pass", "");
    cJSON_AddItemToObject(root, "wifi", wifi);
    return ESP_OK;
}

/** @brief Persist current settings to NVS when user clicks Save.
 *  @param root Full settings cJSON — write to NVS/flash here.
 *  @return ESP_OK on success. */
static esp_err_t save_to_nvs(cJSON *root) {
    printf("Save called\n");
    return ESP_OK;
}

/** @brief Restore factory defaults (called on Reset).
 *  @param root Full settings cJSON — restore defaults here.
 *  @return ESP_OK on success. */
static esp_err_t reset_defaults(cJSON *root) {
    printf("Reset called\n");
    return ESP_OK;
}

/* ── Apply callback ─────────────────────────────────────────────────
 * An apply callback fires every time a field value changes (via
 * WebSocket apply). Use it to react to live changes without waiting
 * for a Save.
 */

/** @brief React to SSID changes in real time.
 *  @param comp_id  Component ID string, e.g. "wifi"
 *  @param key      Field key string, e.g. "ssid"
 *  @param value    New field value as a string (NULL if cleared)
 *
 *  Called immediately when the browser applies a change via WebSocket.
 *  Good for: reconnecting WiFi, restarting services, validation. */
static void on_ssid_change(const char *comp_id, const char *key,
                           const char *value) {
    printf("%s.%s changed to: %s\n", comp_id, key, value);
}

/* ── Main ─────────────────────────────────────────────────────────── */

void app_main(void) {
    /* 1. Hardware setup */
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("pico-config", NULL);
    AsyncWebServer server(80);

    /* 2. Register components and fields (BEFORE pwui_init!) */
    pwui_begin_component("wifi", "Wi-Fi Setup", false);
    /* false = settings component (editable fields) */
    pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
                   PWUI_VALUE, "MyNetwork",
                   PWUI_ATTRS, "{\"required\":true,\"maxlength\":32}",
                   PWUI_HELP, "Network name - 1-32 characters",
                   PWUI_APPLY, on_ssid_change,
                   PWUI_END);
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
                   PWUI_HELP, "At least 8 characters",
                   PWUI_END);
    pwui_end_component("wifi");

    pwui_begin_component("system", "System Status", true);
    /* true = status component (read-only, DOM names prefixed st-) */
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime",
                   PWUI_VALUE, "",
                   PWUI_END);
    pwui_end_component("system");

    /* 3. Configure and start */
    pwui_storage_t storage = {
        .on_load  = load_from_nvs,
        .on_save  = save_to_nvs,
        .on_reset = reset_defaults,
    };
    pwui_init(&server, &storage);
    pwui_start();

    /* 4. Runtime loop — push live status every 3 seconds */
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

Two functions start and stop the library. There is no explicit `deinit` —
the web server lives for the ESP32's full uptime.

```c
/**
 * @brief Initialize pwui with a web server and storage callbacks.
 *
 * Wires up HTTP routes (GET /api/settings, POST /api/settings/save)
 * and WebSocket endpoint (/api/events).  Serves static assets from flash.
 *
 * @param server  Pointer to an initialized AsyncWebServer (port 80).
 * @param storage Pointer to pwui_storage_t with load/save/reset callbacks.
 *                May be NULL if you don't need persistence.
 * @return ESP_OK on success, ESP_ERR_* on failure.
 *
 * @warning All components and fields MUST be registered BEFORE calling
 *          this function.  The store snapshot is taken at init time. */
esp_err_t pwui_init(AsyncWebServer *server, const pwui_storage_t *storage);
```

```c
/**
 * @brief Start the async web server.
 *
 * Call this once, after pwui_init and all component registration.
 * The server runs indefinitely on the calling task's event loop.
 *
 * @return ESP_OK on success. */
esp_err_t pwui_start(void);
```

**Typical call order in `app_main`:**

```
nvs_flash_init()                  /* hardware                   */
WiFi.softAP(...)                  /* network                    */
pwui_begin_component(...)         /* register components        */
pwui_add_field(...)               /* register fields            */
pwui_end_component(...)           /* close component            */
pwui_init(&server, &storage)      /* wire routes, snapshot store */
pwui_start()                      /* begin serving              */
/* --- enter runtime loop --- */
pwui_set(...)                     /* update values              */
pwui_broadcast_status()           /* push to clients            */
```

---

## Component Registration

Components are the top-level sections rendered as `<details>` accordions
in the browser. Each component has an `id` (used as the JSON key and DOM
prefix), a display `label`, and an `is_status` flag.

```c
/**
 * @brief Begin a new component (accordion section).
 *
 * @param id        Unique string ID, e.g. "wifi" or "system".
 *                  Must match the key in your storage callback JSON.
 *                  Must be unique across all components.
 * @param label     Human-readable display label, e.g. "Wi-Fi Setup".
 * @param is_status true = read-only status section (DOM gets st- prefix).
 *                  false = editable settings section.
 * @return ESP_OK on success.
 *
 * @note Status and settings components sharing the same @p id are
 *       merged into a single accordion in the browser.  Status fields
 *       appear first, disabled, with DOM name prefix "st-".  Settings
 *       fields appear after, editable, with unprefixed names. */
esp_err_t pwui_begin_component(const char *id, const char *label,
                               bool is_status);
```

```c
/**
 * @brief End a component. Must match the most recent pwui_begin_component.
 *
 * @param id Must equal the @p id passed to pwui_begin_component.
 *           Used as an assertion — mismatches return an error.
 * @return ESP_OK on success. */
esp_err_t pwui_end_component(const char *id);
```

**Merged status + settings example:**

```c
/* Status section — read-only, DOM names like "st-system.uptime" */
pwui_begin_component("system", "System Status", true);
pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime",
               PWUI_VALUE, "", PWUI_END);
pwui_add_field(PWUI_TEXT, "system", "fw_version", "Firmware",
               PWUI_VALUE, "1.0.0", PWUI_END);
pwui_end_component("system");

/* Settings section — editable, DOM names like "system.hostname" */
pwui_begin_component("system", "System Config", false);
pwui_add_field(PWUI_TEXT, "system", "hostname", "Hostname",
               PWUI_VALUE, "pico-device", PWUI_END);
pwui_end_component("system");

/* Rendered as ONE merged accordion "System" with:
 *   - uptime (disabled, name="st-system.uptime")
 *   - fw_version (disabled, name="st-system.fw_version")
 *   - hostname (editable, name="system.hostname") */
```

---

## Field Registration

Two functions cover all field types. Use `pwui_add_field` for simple types
(text, number, checkbox, range, etc.). Use `pwui_add_field_opts` for types
that need a list of options (select, radio).

```c
/**
 * @brief Register a field with a component.
 *
 * @param type    Field type from pwui_type_t enum.
 * @param comp_id Component ID (must match a pwui_begin_component id).
 * @param key     Field key — unique within this component.
 *                Used as the JSON key and DOM name: "<comp_id>.<key>".
 * @param label   Human-readable label for the form field.
 * @param ...     Sentinel-tagged varargs (see table below).
 *               Terminate with PWUI_END.
 * @return ESP_OK on success.
 *
 * @note Key must NOT contain dots — the dot separates component from
 *       field in path strings like "wifi.ssid". */
esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id,
                         const char *key, const char *label, ...);
```

```c
/**
 * @brief Register a select or radio field with options.
 *
 * Same as pwui_add_field but adds an options array for select/radio.
 *
 * @param type         Must be PWUI_SELECT or PWUI_RADIO.
 * @param comp_id      Component ID.
 * @param key          Field key.
 * @param label        Human-readable label.
 * @param options      Array of [value, label] string pairs.
 *                     Must be statically allocated (points to flash).
 * @param option_count Number of entries in @p options.
 * @param ...          Sentinel-tagged varargs (same as pwui_add_field).
 *                    Terminate with PWUI_END.
 * @return ESP_OK on success. */
esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id,
                              const char *key, const char *label,
                              const char *options[][2], int option_count,
                              ...);
```

**Examples:**

```c
/* Text field with all optional parameters */
pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
               PWUI_VALUE, "MyNetwork",
               PWUI_ATTRS, "{\"required\":true,\"maxlength\":32}",
               PWUI_HELP, "Network name",
               PWUI_APPLY, on_ssid_change,
               PWUI_END);

/* Minimal field (only required: type, comp_id, key, label) */
pwui_add_field(PWUI_NUMBER, "gpio", "pin", "Pin Number",
               PWUI_END);

/* Range slider with min/max */
pwui_add_field(PWUI_RANGE, "led", "brightness", "Brightness",
               PWUI_VALUE, "128",
               PWUI_ATTRS, "{\"min\":0,\"max\":255}",
               PWUI_END);

/* Checkbox with explicit null (indeterminate state) */
pwui_add_field(PWUI_CHECKBOX, "features", "enable_ai", "Enable AI",
               PWUI_NULL,
               PWUI_HELP, "Enable experimental AI features",
               PWUI_END);

/* Select field with options */
static const char *mode_opts[][2] = {
    {"station", "Station Mode"},
    {"ap",      "Access Point"},
    {"ap_sta",  "AP + Station"},
};
pwui_add_field_opts(PWUI_SELECT, "wifi", "mode", "WiFi Mode",
                    mode_opts, 3,
                    PWUI_VALUE, "station",
                    PWUI_HELP, "Operating mode",
                    PWUI_APPLY, on_mode_change,
                    PWUI_END);

/* Radio group */
static const char *role_opts[][2] = {
    {"master", "Master"},
    {"slave",  "Slave"},
};
pwui_add_field_opts(PWUI_RADIO, "cluster", "role", "Role",
                    role_opts, 2,
                    PWUI_VALUE, "master",
                    PWUI_END);
```

---

## Varargs Sentinels

All optional parameters after `label` use tag-value pairs terminated by
`PWUI_END`. Pass values as `const char *` or function pointers.

| Sentinel | Argument type | Description |
|---|---|---|
| `PWUI_VALUE` | `const char *` | Default/current value. String for all types (numbers, booleans as strings). |
| `PWUI_HELP` | `const char *` | Helper text shown below the field. |
| `PWUI_APPLY` | `pwui_apply_cb_t` | Callback fired on every WebSocket apply for this field. Available on both `pwui_add_field` and `pwui_add_field_opts`. |
| `PWUI_ATTRS` | `const char *` | JSON string of HTML form attributes. Example: `"{\"required\":true,\"min\":1,\"max\":100}"`. Valid keys: `required`, `min`, `max`, `minlength`, `maxlength`, `step`, `placeholder`, `pattern`. |
| `PWUI_NULL` | (none) | Sets the value to explicit null. Use alone, NOT with `PWUI_VALUE`. For checkbox: creates the indeterminate (tri-state) state. |
| `PWUI_END` | (none) | **Required.** Terminates the varargs list. Must be the last sentinel. |

**Important:** Sentinels are order-independent except `PWUI_END` must be last.
Duplicates are allowed — the last one wins.

---

## Field Types

| `pwui_type_t` | HTML rendered | Notes |
|---|---|---|
| `PWUI_TEXT` | `<input type="text">` | |
| `PWUI_NUMBER` | `<input type="number">` | Value is string, server serializes as JSON number |
| `PWUI_PASSWORD` | `<input type="password">` | Value is masked in browser, transmitted normally |
| `PWUI_EMAIL` | `<input type="email">` | Browser validates email format |
| `PWUI_TEL` | `<input type="tel">` | |
| `PWUI_URL` | `<input type="url">` | Browser validates URL format |
| `PWUI_COLOR` | `<input type="color">` | Value is hex string, e.g. `"#ff0000"` |
| `PWUI_SWITCH` | `<input type="checkbox" role="switch">` | True/false toggle |
| `PWUI_CHECKBOX` | `<input type="checkbox">` | Three states: `"true"`, `"false"`, `null` (use `PWUI_NULL`) |
| `PWUI_RANGE` | `<input type="range">` | Use `PWUI_ATTRS` for `min`/`max`/`step` |
| `PWUI_TEXTAREA` | `<textarea>` | Multi-line text input |
| `PWUI_RADIO` | Radio group in `<fieldset>` | Use `pwui_add_field_opts` |
| `PWUI_SELECT` | `<select>` | Use `pwui_add_field_opts` |

---

## Runtime Value Access

Read and write field values at runtime by dot-path (`"component_id.field_key"`).

```c
/**
 * @brief Set a field's value in the store.
 *
 * Paths are dot-separated: "comp_id.key".  The value is always a string.
 * Setting the value does NOT broadcast to clients — call pwui_push() or
 * pwui_broadcast_status() after.
 *
 * @param path  Dot-path string, e.g. "wifi.ssid".
 * @param value New value as string (ownership transfers to store).
 * @return ESP_OK on success, ESP_ERR_NOT_FOUND if path doesn't match
 *         any registered field.
 *
 * @note Can be called before pwui_init (values are queued) or after
 *       (values are stored immediately). */
esp_err_t pwui_set(const char *path, const char *value);
```

```c
/**
 * @brief Get a field's current value from the store.
 *
 * @param path Dot-path string, e.g. "system.uptime".
 * @return Pointer to the value string, or NULL if not found.
 *         The returned pointer is valid until the next pwui_set for
 *         the same path. Do NOT free it. */
const char *pwui_get(const char *path);
```

**Example — read-modify-write:**

```c
const char *current = pwui_get("led.brightness");
int b = atoi(current);
b = (b + 16) % 256;
char buf[16];
snprintf(buf, sizeof(buf), "%d", b);
pwui_set("led.brightness", buf);
pwui_push();
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
 * Use after batch-updating values with pwui_set.  The browser receives
 * a {"type":"settings", ...} message and updates all fields.
 *
 * @return ESP_OK on success. */
esp_err_t pwui_push(void);
```

```c
/**
 * @brief Broadcast status-only data to all connected WebSocket clients.
 *
 * Serializes every field registered with is_status=true and sends a
 * {"type":"status", ...} message.  Settings fields are NOT included.
 *
 * Use in your main loop to push telemetry (uptime, signal, sensors).
 * Much lighter than pwui_push — only status fields go over the wire.
 *
 * @return ESP_OK on success. */
esp_err_t pwui_broadcast_status(void);
```

**Pattern for live status updates:**

```c
while (1) {
    vTaskDelay(pdMS_TO_TICKS(3000));

    float temp = read_temperature_sensor();
    char buf[32];
    snprintf(buf, sizeof(buf), "%.1f", temp);
    pwui_set("sensors.temperature", buf);

    pwui_broadcast_status();
}
```

---

## Storage Callbacks

Registered via `pwui_storage_t` at init time. All three callbacks receive a
`cJSON *root` object. The library owns the root — add/read from it, don't free it.

```c
/** @brief Storage callback type.
 *  @param data cJSON object — read from it (on_save), write to it (on_load),
 *              or restore defaults into it (on_reset).  Do NOT free this pointer. */
typedef esp_err_t (*pwui_storage_cb_t)(cJSON *data);

/** @brief Storage callback struct passed to pwui_init. */
typedef struct {
    pwui_storage_cb_t on_load;   /**< Called once at startup.  Populate
                                      cJSON with saved values.  Only values
                                      needed — structure is already known
                                      from pwui_add_field calls. */
    pwui_storage_cb_t on_save;   /**< Called when user clicks Save.  Persist
                                      the full cJSON to NVS/LittleFS/SPIFFS. */
    pwui_storage_cb_t on_reset;  /**< Called on factory reset.  Restore
                                      defaults and persist them. */
} pwui_storage_t;
```

### on_load — load saved values

The library calls `on_load` after `pwui_init`. You populate the cJSON with
**values only** — the library already knows field types, labels, and options
from your `pwui_add_field` calls.

**Note:** The cJSON keys must match your component IDs and field keys exactly.
`"wifi"` is the component id, `"ssid"` is the field key.

```c
/** @brief Load persisted settings from NVS.
 *
 *  Structure (types, labels, help text) is defined in pwui_add_field calls
 *  above.  Here we only supply the saved values.
 *
 *  @param root  Empty cJSON object — add your component objects here.
 *  @return ESP_OK on success, or ESP_ERR_* if NVS read fails. */
static esp_err_t load_from_nvs(cJSON *root) {
    nvs_handle_t handle;
    esp_err_t err = nvs_open("pwui", NVS_READONLY, &handle);
    if (err != ESP_OK) return err;

    cJSON *wifi = cJSON_CreateObject();
    char ssid[64];  size_t len = sizeof(ssid);
    if (nvs_get_str(handle, "wifi.ssid", ssid, &len) == ESP_OK)
        cJSON_AddStringToObject(wifi, "ssid", ssid);
    else
        cJSON_AddStringToObject(wifi, "ssid", "");

    char pass[64];  len = sizeof(pass);
    if (nvs_get_str(handle, "wifi.pass", pass, &len) == ESP_OK)
        cJSON_AddStringToObject(wifi, "pass", pass);
    else
        cJSON_AddStringToObject(wifi, "pass", "");

    cJSON_AddItemToObject(root, "wifi", wifi);

    nvs_close(handle);
    return ESP_OK;
}
```

### on_save — persist to flash

Called when the user clicks the Save button in the browser. Receive the full
settings cJSON — walk it and write each value to NVS.

```c
/** @brief Persist all settings to NVS.
 *  @param root  cJSON containing every field's value, keyed by
 *               component ID and field key.
 *  @return ESP_OK on success. */
static esp_err_t save_to_nvs(cJSON *root) {
    nvs_handle_t handle;
    esp_err_t err = nvs_open("pwui", NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    cJSON *comp = NULL;
    cJSON_ArrayForEach(comp, root) {
        if (!cJSON_IsObject(comp)) continue;
        const char *comp_id = comp->string;

        cJSON *field = NULL;
        cJSON_ArrayForEach(field, comp) {
            const char *key = field->string;
            char nvs_key[128];
            snprintf(nvs_key, sizeof(nvs_key), "%s.%s", comp_id, key);
            if (cJSON_IsString(field))
                nvs_set_str(handle, nvs_key, field->valuestring);
        }
    }

    nvs_commit(handle);
    nvs_close(handle);
    return ESP_OK;
}
```

### on_reset — factory defaults

```c
/** @brief Restore factory defaults.
 *  @param root  cJSON to populate with defaults.  Same format as on_load.
 *  @return ESP_OK on success. */
static esp_err_t reset_defaults(cJSON *root) {
    cJSON *wifi = cJSON_CreateObject();
    cJSON_AddStringToObject(wifi, "ssid", "pico-default");
    cJSON_AddStringToObject(wifi, "pass", "");
    cJSON_AddItemToObject(root, "wifi", wifi);
    return ESP_OK;
}
```

---

## Apply Callbacks

Every field can have an optional apply callback. It fires on every WebSocket
apply — not just on Save. Use it for live reconfiguration.

```c
/** @brief Apply callback signature.
 *
 *  Called by the library when a browser applies a field change via
 *  WebSocket.  The callback runs inside the WebSocket event handler
 *  task — keep it fast.  Offload long operations to a queue/task.
 *
 *  @param comp_id  Component ID string, e.g. "wifi"
 *  @param key      Field key string, e.g. "ssid"
 *  @param value    New value as string.  NULL if the field was cleared.
 *                  For checkbox with PWUI_NULL, this will be NULL. */
typedef void (*pwui_apply_cb_t)(const char *comp_id, const char *key,
                                const char *value);
```

**Example — reconnect WiFi on SSID/password change:**

```c
/** @brief Apply callback: reconnects WiFi when SSID or password changes. */
static void on_wifi_change(const char *comp_id, const char *key,
                           const char *value) {
    if (strcmp(comp_id, "wifi") != 0) return;

    const char *ssid = strcmp(key, "ssid") == 0 ? value : pwui_get("wifi.ssid");
    const char *pass = strcmp(key, "pass") == 0 ? value : pwui_get("wifi.pass");

    printf("Reconnecting to %s...\n", ssid);
    WiFi.begin(ssid, pass);
}

/* Registered on both fields — fires on either change: */
pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
               PWUI_APPLY, on_wifi_change, PWUI_END);
pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
               PWUI_APPLY, on_wifi_change, PWUI_END);
```

**Example — apply callback on a select field using `pwui_add_field_opts`:**

```c
static void on_mode_change(const char *comp_id, const char *key,
                           const char *value) {
    printf("Mode changed to: %s\n", value);
}

static const char *mode_opts[][2] = {
    {"station", "Station"}, {"ap", "Access Point"},
};
pwui_add_field_opts(PWUI_SELECT, "wifi", "mode", "Mode",
                    mode_opts, 2,
                    PWUI_APPLY, on_mode_change,
                    PWUI_END);
```

---

## Full Example

The complete, runnable example lives at:
[`components/pico-settings/examples/basic/main.c`](components/pico-settings/examples/basic/main.c)

For the WebSocket protocol used between the device and browser, see
[`WS_PROTOCOL.md`](WS_PROTOCOL.md).
