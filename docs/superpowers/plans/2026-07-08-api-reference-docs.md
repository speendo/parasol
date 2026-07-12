# API Reference Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a narrative-workflow C API reference with doxygen-style comments, a WebSocket protocol appendix, and update the README with links to both. Challenge and fix gaps found in the original Task 9 API surface.

**Architecture:** Three files: `API_REFERENCE.md` (narrative C API reference — Register → Init → Start → Runtime → Push), `WS_PROTOCOL.md` (WebSocket message format appendix), `README.md` (updated with links). The C API docs use a layered explanation: C `pwui_add_field` defines structure (types, labels, help), JSON wire format carries values only. Code examples use `/** Doxygen */` blocks for all functions/structs and `/* inline */` comments for step-by-step explanations.

**Tech Stack:** Markdown, C code examples

**API Challenges Found in Original Task 9:**

| # | Gap | Resolution |
|---|---|---|
| 1 | Storage callbacks duplicate structure already defined in `pwui_add_field` — confusing | Document values-only pattern in `on_load`. C defines structure; JSON carries values. |
| 2 | `PWUI_NULL` sentinel entirely missing from docs | Add to sentinel table with checkbox indeterminate example |
| 3 | Ordering ambiguous: register before or after `pwui_init`? | Explicit rule: **Register ALL components BEFORE `pwui_init`.** Examples enforce this. |
| 4 | `pwui_apply_cb_t` args (`comp_id`, `key`, `value`) never explained | Document in callback section with annotated example |
| 5 | `PWUI_APPLY` shown only on `pwui_add_field`, but also works on `pwui_add_field_opts` | Show on both, add note |
| 6 | `is_status` flag not explained — what does the `st-` prefix do? | Explain that `is_status=true` renders as read-only with `st-` DOM prefix, preventing name collisions |
| 7 | No WS message format documented | New `WS_PROTOCOL.md` with schema, direction, and examples |
| 8 | Example uses `cJSON_Parse` full wire format for `on_load` | Replace with values-only `cJSON_AddStringToObject` pattern. Structure is already registered. |

---

### Task 1: Create `API_REFERENCE.md`

**Files:**
- Create: `API_REFERENCE.md` (root of repo)

- [ ] **Step 1: Write the file**

```markdown
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

This is the exact `@code` you need in your `app_main`. Study it first, then refer
to the sections below for details on each function.

@note **Critical ordering rule:** Register ALL components and fields BEFORE calling
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
    cJSON_AddStringToObject(wifi, "ssid", "MyNetwork");   /* saved SSID */
    cJSON_AddStringToObject(wifi, "pass", "");            /* saved password */
    cJSON_AddItemToObject(root, "wifi", wifi);
    return ESP_OK;
}

/** @brief Persist current settings to NVS when user clicks Save.
 *  @param root Full settings cJSON — write to NVS/flash here.
 *  @return ESP_OK on success. */
static esp_err_t save_to_nvs(cJSON *root) {
    printf("Save called\n");              /* TODO: write to NVS */
    return ESP_OK;
}

/** @brief Restore factory defaults (called on Reset).
 *  @param root Full settings cJSON — restore defaults here.
 *  @return ESP_OK on success. */
static esp_err_t reset_defaults(cJSON *root) {
    printf("Reset called\n");             /* TODO: restore defaults */
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
    WiFi.softAP("pico-config", NULL);     /* open AP for initial setup */
    AsyncWebServer server(80);

    /* 2. Register components and fields (BEFORE pwui_init!) */
    pwui_begin_component("wifi", "Wi-Fi Setup", false);
    /* false = settings component (editable fields) */
    pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
                   PWUI_VALUE, "MyNetwork",
                   PWUI_ATTRS, "{\"required\":true,\"maxlength\":32}",
                   PWUI_HELP, "Network name \u2014 1\u201332 characters",
                   PWUI_APPLY, on_ssid_change,  /* fires on every change */
                   PWUI_END);                    /* required terminator */
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
                   PWUI_HELP, "At least 8 characters",
                   PWUI_END);
    pwui_end_component("wifi");           /* must match begin_component id */

    pwui_begin_component("system", "System Status", true);
    /* true = status component (read-only, DOM names prefixed st-) */
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime",
                   PWUI_VALUE, "",        /* starts empty */
                   PWUI_END);
    pwui_end_component("system");

    /* 3. Configure and start */
    pwui_storage_t storage = {
        .on_load  = load_from_nvs,
        .on_save  = save_to_nvs,
        .on_reset = reset_defaults,
    };
    pwui_init(&server, &storage);         /* wires up HTTP + WS routes */
    pwui_start();                         /* starts the async web server */

    /* 4. Runtime loop — push live status every 3 seconds */
    int seconds = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        seconds += 3;
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", seconds);
        pwui_set("system.uptime", buf);   /* update value in store */
        pwui_broadcast_status();          /* push to all connected browsers */
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
nvs_flash_init()      /* hardware */
WiFi.softAP(...)      /* network  */
pwui_begin_component(...)  /* register components (all of them) */
pwui_add_field(...)        /* register fields                */
pwui_end_component(...)    /* close component                */
pwui_init(&server, &storage)  /* wire routes, snapshot store */
pwui_start()                  /* begin serving               */
/* --- enter runtime loop --- */
pwui_set(...)                 /* update values */
pwui_broadcast_status()       /* push to clients */
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
/* ── Text field with all optional parameters ── */
pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
               PWUI_VALUE, "MyNetwork",       /* default value              */
               PWUI_ATTRS, "{\"required\":true,\"maxlength\":32}",  /* HTML attrs as JSON */
               PWUI_HELP, "Network name",     /* tooltip / helper text      */
               PWUI_APPLY, on_ssid_change,    /* callback on value change   */
               PWUI_END);                     /* REQUIRED: terminates list  */

/* ── Minimal field (only required: type, comp_id, key, label) ── */
pwui_add_field(PWUI_NUMBER, "gpio", "pin", "Pin Number",
               PWUI_END);

/* ── Range slider with min/max ── */
pwui_add_field(PWUI_RANGE, "led", "brightness", "Brightness",
               PWUI_VALUE, "128",
               PWUI_ATTRS, "{\"min\":0,\"max\":255}",
               PWUI_END);

/* ── Checkbox with explicit null (indeterminate state) ── */
pwui_add_field(PWUI_CHECKBOX, "features", "enable_ai", "Enable AI",
               PWUI_NULL,     /* null = indeterminate (not yes, not no) */
               PWUI_HELP, "Enable experimental AI features",
               PWUI_END);

/* ── Select field with options ── */
static const char *mode_opts[][2] = {
    {"station", "Station Mode"},
    {"ap",      "Access Point"},
    {"ap_sta",  "AP + Station"},
};
pwui_add_field_opts(PWUI_SELECT, "wifi", "mode", "WiFi Mode",
                    mode_opts, 3,
                    PWUI_VALUE, "station",    /* default selection */
                    PWUI_HELP, "Operating mode",
                    PWUI_APPLY, on_mode_change,  /* PWUI_APPLY works here too */
                    PWUI_END);

/* ── Radio group ── */
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
const char *current = pwui_get("led.brightness");  /* e.g. "128" */
int b = atoi(current);
b = (b + 16) % 256;
char buf[16];
snprintf(buf, sizeof(buf), "%d", b);
pwui_set("led.brightness", buf);
pwui_push();  /* send updated settings to all clients */
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
/* In a FreeRTOS task or main loop, update status every N seconds */
while (1) {
    vTaskDelay(pdMS_TO_TICKS(3000));               /* 3-second interval */

    float temp = read_temperature_sensor();         /* your hardware code */
    char buf[32];
    snprintf(buf, sizeof(buf), "%.1f", temp);
    pwui_set("sensors.temperature", buf);           /* store new value */

    pwui_broadcast_status();                        /* push to browsers */
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

@note The cJSON keys must match your component IDs and field keys exactly.
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
    /* Open NVS namespace (your implementation) */
    nvs_handle_t handle;
    esp_err_t err = nvs_open("pwui", NVS_READONLY, &handle);
    if (err != ESP_OK) return err;

    /* ── WiFi values ── */
    cJSON *wifi = cJSON_CreateObject();
    char ssid[64];  size_t len = sizeof(ssid);
    if (nvs_get_str(handle, "wifi.ssid", ssid, &len) == ESP_OK)
        cJSON_AddStringToObject(wifi, "ssid", ssid);
    else
        cJSON_AddStringToObject(wifi, "ssid", "");   /* default if not saved */

    char pass[64];  len = sizeof(pass);
    if (nvs_get_str(handle, "wifi.pass", pass, &len) == ESP_OK)
        cJSON_AddStringToObject(wifi, "pass", pass);
    else
        cJSON_AddStringToObject(wifi, "pass", "");

    cJSON_AddItemToObject(root, "wifi", wifi);

    /* ── GPIO values ── */
    cJSON *gpio = cJSON_CreateObject();
    uint8_t pin;
    if (nvs_get_u8(handle, "gpio.pin", &pin) == ESP_OK) {
        char buf[8]; snprintf(buf, sizeof(buf), "%u", pin);
        cJSON_AddStringToObject(gpio, "pin", buf);
    }
    cJSON_AddItemToObject(root, "gpio", gpio);

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

    /* Walk every component (top-level keys in root) */
    cJSON *comp = NULL;
    cJSON_ArrayForEach(comp, root) {
        if (!cJSON_IsObject(comp)) continue;   /* skip _dirty and other meta */
        const char *comp_id = comp->string;     /* e.g. "wifi" */

        /* Walk every field in this component */
        cJSON *field = NULL;
        cJSON_ArrayForEach(field, comp) {
            const char *key = field->string;    /* e.g. "ssid" */
            char nvs_key[128];
            snprintf(nvs_key, sizeof(nvs_key), "%s.%s", comp_id, key);

            if (cJSON_IsString(field))
                nvs_set_str(handle, nvs_key, field->valuestring);
            else if (cJSON_IsNumber(field))
                nvs_set_u8(handle, nvs_key, (uint8_t)field->valueint);
        }
    }

    nvs_commit(handle);
    nvs_close(handle);
    return ESP_OK;
}
```

### on_reset — factory defaults

Called on factory reset. Populate the cJSON with your default values and
persist them so the next boot loads these defaults.

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
apply — not just on Save. Use it for live reconfiguration (e.g., reconnect
WiFi when SSID changes, update LED brightness immediately).

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
 *                  For checkbox PWUI_NULL, this will be NULL. */
typedef void (*pwui_apply_cb_t)(const char *comp_id, const char *key,
                                const char *value);
```

**Example — reconnect WiFi on SSID/password change:**

```c
/** @brief Apply callback: reconnects WiFi when SSID or password changes. */
static void on_wifi_change(const char *comp_id, const char *key,
                           const char *value) {
    if (strcmp(comp_id, "wifi") != 0) return;   /* not our component */

    const char *ssid = strcmp(key, "ssid") == 0 ? value : pwui_get("wifi.ssid");
    const char *pass = strcmp(key, "pass") == 0 ? value : pwui_get("wifi.pass");

    printf("Reconnecting to %s...\n", ssid);
    WiFi.begin(ssid, pass);                      /* apply new credentials now */
}

/* Registered on both fields — fires on either change: */
pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
               PWUI_APPLY, on_wifi_change, PWUI_END);
pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
               PWUI_APPLY, on_wifi_change, PWUI_END);
```

**Example — apply callback on a select field using pwui_add_field_opts:**

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
                    PWUI_APPLY, on_mode_change,  /* works here too */
                    PWUI_END);
```

---

## Full Example

The complete, runnable example lives at:
[`components/pico-settings/examples/basic/main.c`](components/pico-settings/examples/basic/main.c)

For the WebSocket protocol used between the device and browser, see
[`WS_PROTOCOL.md`](WS_PROTOCOL.md).
```

- [ ] **Step 2: Verify file was created**

Run: `wc -l API_REFERENCE.md`
Expected: ~450-550 lines

- [ ] **Step 3: Commit**

```bash
git add API_REFERENCE.md
git commit -m "docs: add narrative C API reference with doxygen examples"
```

---

### Task 2: Create `WS_PROTOCOL.md`

**Files:**
- Create: `WS_PROTOCOL.md` (root of repo)

- [ ] **Step 1: Write the file**

```markdown
# WebSocket Protocol Reference

The single WebSocket endpoint at `/api/events` carries both settings and status
data, multiplexed by a `type` field (server→client) or `action` field
(client→server).

## Connection

- **URL:** `ws://<device-ip>/api/events`
- **Lifecycle:** Browser opens at page load. Server pushes status then settings.
  On disconnect, browser shows retry button. On reconnect, server re-sends
  status then settings.

## Server → Client Messages

### `type: "status"`

Sent on initial connect and periodically thereafter (typically every 3 seconds
via `pwui_broadcast_status`). Contains read-only telemetry data.

```
{
  "type": "status",
  "data": {
    "system": {
      "uptime":     ["text", "Uptime",     {"value": "42s"}],
      "fw_version": ["text", "Firmware",   {"value": "v1.2.3"}]
    },
    "network": {
      "mode":       ["select", "Mode",     {"value": "station",
                                            "options": [["station","Station"],["ap","AP"]]}],
      "signal":     ["text", "Signal",     {"value": "-47 dBm"}],
      "connection": ["text", "Connected",  {"value": "yes"}]
    },
    "sensors": {
      "temperature": ["text", "Temperature", {"value": "23.5 C"}]
    }
  }
}
```

**Field format:** Each field under a component is a 3-element JSON array:
```
[type_string, label_string, opts_object]
```
where `opts` contains at minimum `"value"`, and optionally `"options"` (for
select/radio), `"attrs"` (HTML validation attributes), and `"tooltip"` (help
text). For the full field format reference, see the architecture spec.

**Rendering:** Status fields render as disabled `<input>` elements with DOM
names prefixed by `st-` (e.g., `name="st-system.uptime"`). The prefix prevents
name collisions when a status and settings component share the same `id`.

### `type: "settings"`

Sent on initial connect, reconnect, and after any settings change (push or
apply). Contains the full settings state.

```
{
  "type": "settings",
  "_dirty": true,
  "data": {
    "wifi": {
      "label": "Wi-Fi Setup",
      "ssid":     ["text",     "SSID",     {"value": "MyNetwork",
                                            "attrs": {"required":true,"maxlength":32},
                                            "tooltip": "Network name \u2014 1\u201332 characters"}],
      "pass":     ["password", "Password", {"value": "",
                                            "attrs": {"maxlength":64},
                                            "tooltip": "WiFi password \u2014 up to 64 characters"}],
      "mode":     ["select",   "Mode",     {"value": "station",
                                            "options": [["station","Station"],["ap","Access Point"]]}]
    },
    "gpio": {
      "pin":       ["number", "Pin Number",  {"value": "2",
                                              "attrs": {"min":0,"max":39}}],
      "direction": ["select", "Direction",   {"value": "output",
                                              "options": [["input","Input"],["output","Output"]]}],
      "initial":   ["select", "Initial State", {"value": "low",
                                                "options": [["low","Low"],["high","High"]]}]
    }
  }
}
```

**`_dirty`:** Boolean owned by the server. `true` when at least one applied
value differs from the stored (NVS) value. Drives the Save button: enabled
only when `_dirty` is true AND all form fields pass validation.

**`label`:** Optional key within each component object. If present, used as the
accordion section title. If absent, the component ID is title-cased (e.g.,
`"gpio"` → `"Gpio"`, `"audio_interface"` → `"Audio Interface"`).

### `type: "error"`

Sent on processing errors.

```
{
  "type": "error",
  "message": "Failed to apply setting: wifi.ssid exceeds max length"
}
```

The browser displays the message in a notification bar. The form remains
usable — error messages don't block further interaction.

## Client → Server Messages

### `action: "apply"`

Sent automatically when the user blurs a modified field (text/password/email)
or changes a value (select/range/number/checkbox/switch). Contains only the
changed fields, never the full settings object.

```
{
  "action": "apply",
  "data": {
    "wifi": {
      "ssid": ["text", "SSID", {"value": "NewNetworkName"}]
    }
  }
}
```

**Why partial?** Sending only changed fields minimizes wire overhead (ESP32 is
CPU- and bandwidth-constrained). The server merges the partial update into its
store.

**Multi-field apply:** If the user changes multiple fields between WS sends,
the browser batches them:

```
{
  "action": "apply",
  "data": {
    "wifi": {
      "ssid": ["text", "SSID", {"value": "NewName"}],
      "pass": ["password", "Password", {"value": "newpass123"}]
    }
  }
}
```

## State Machine Summary

The browser tracks per-field state to handle concurrent edits, external
updates, and echo resolution:

| State | Meaning | Browser Behavior |
|---|---|---|
| **Idle** | FV = LS = AV, inFlight = false | No action |
| **Local Input** | User changed field, not yet confirmed | Send FV to server; set inFlight = true |
| **External Update** | Server pushed new value, user hasn't changed it | Show notification: "Load" or "Keep" |
| **Coincidental Sync** | Server echoed the same value user was about to send | Silent sync, no notification |
| **Collision** | User changed field AND server pushed different value | Prompt: "Keep all local" or "Accept all server" |
| **Echo Received** | Server confirmed user's change | Clear inFlight = false |

**Legend:** FV = Form Value (what user sees), LS = Last Sent (last value sent
to server), AV = Applied Value (what server reports), inFlight = waiting for
server echo.

For the full state machine with all 10 cases, see the
[architecture spec](docs/superpowers/specs/2026-06-18-unified-settings-design.md).

## HTTP Endpoints (Fallback)

When WebSocket is unavailable (slow connection, initial load race), the browser
falls back to HTTP:

| Method | Path | Purpose | Body |
|---|---|---|---|
| `GET` | `/api/settings` | Full settings load | — |
| `POST` | `/api/settings/save` | Persist to NVS | Partial settings JSON |

`GET /api/settings` returns the same structure as the `type: "settings"` WS
message. `POST /api/settings/save` accepts the partial format, same as the
`action: "apply"` WS message. Both return HTTP 200 on success, 4xx/5xx with
plain text error body on failure.
```

- [ ] **Step 2: Verify file was created**

Run: `wc -l WS_PROTOCOL.md`
Expected: ~200-250 lines

- [ ] **Step 3: Commit**

```bash
git add WS_PROTOCOL.md
git commit -m "docs: add WebSocket protocol reference appendix"
```

---

### Task 3: Update `README.md` with API reference links

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README content**

Replace the entire file content with:

```markdown
# Pico Website

Web-based configuration UI for ESP32 devices. Renders live settings forms,
handles dirty tracking, and syncs changes via WebSocket.

## Requirements

- Modern browser (Chrome, Firefox, Safari, Edge)
- ESP32 running pico-website firmware, **or** the Python test server for development

## Quick Start (Browser-side development)

```bash
# Install dependencies
npm install

# Start the Python test server
pip install fastapi uvicorn
uvicorn test_server.main:app

# Run tests
npm test              # all tests
npm run test:unit     # vitest unit tests
npm run test:e2e      # Playwright e2e tests

# Build (minify JS)
npm run build
```

## Documentation

| Document | Audience | Content |
|---|---|---|
| [`API_REFERENCE.md`](API_REFERENCE.md) | ESP32 firmware developers | C API reference with doxygen examples — component registration, field types, storage callbacks, runtime value access |
| [`WS_PROTOCOL.md`](WS_PROTOCOL.md) | Developers debugging WebSocket traffic | Message format reference — status, settings, apply, error payloads, state machine summary |
| [`docs/superpowers/specs/2026-06-18-unified-settings-design.md`](docs/superpowers/specs/2026-06-18-unified-settings-design.md) | Contributors | Full architecture spec, API contract, JSON wire format, state machine |

## Installing on ESP32

Add to `platformio.ini`:

```ini
lib_deps = https://github.com/<owner>/pico-website.git#v0.1.0
```

See [`API_REFERENCE.md`](API_REFERENCE.md) for the complete C API.
```

- [ ] **Step 2: Verify**

Run: `wc -l README.md`
Expected: ~40-50 lines

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add API reference and WS protocol links to README"
```

---

## Self-Review

**1. Spec coverage:**
- API challenges #1-#8 addressed in Task 1 content
- Narrative workflow-first: Register → Init → Start → Runtime → Push
- Doxygen `/** */` blocks on all functions and structs, `/* */` inline comments on code examples
- `PWUI_NULL` added to sentinel table with checkbox indeterminate example
- `pwui_apply_cb_t` args documented
- `PWUI_APPLY` shown on both `pwui_add_field` and `pwui_add_field_opts`
- `is_status` explained with `st-` prefix, merged section example
- Storage callbacks use values-only approach (challenge #1)
- WS protocol appendix (Task 2) covers all message types
- README (Task 3) links to both new docs

**2. Placeholder scan:** None. All code examples are complete with exact C code.

**3. Type consistency:**
- `pwui_apply_cb_t` signature consistent across all examples and docs
- `pwui_storage_t` struct matches `pwui.h` exactly
- Sentinel names match `pwui.h` definitions
- Field type enum names match `pwui.h`
