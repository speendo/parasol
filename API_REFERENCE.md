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
- [File Upload](#file-upload)
- [Settings Meta](#settings-meta)
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
 * WebSocket apply or Save). The callback OWNS persistence: accept a
 * value by writing it back with prsl_set_val() (optionally after
 * transforming it), or write nothing to discard it. Parasol does not
 * auto-store when on_set is registered.
 */

static esp_err_t on_ssid_change(const char *group_id, const char *key,
                                 const prsl_val_t *value) {
    (void)key;
    printf("%s changed\n", group_id);
    if (value->kind != PRSL_VAL_STRING || !value->u.str) return ESP_ERR_INVALID_ARG;
    if (strlen(value->u.str) > 32) return ESP_ERR_INVALID_ARG;
    prsl_set_val("wifi.ssid", value);   /* accept as-is */
    prsl_set_dirty(true);               /* show Save, persist on Save */
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

    static const prsl_field_opts_t ssid_opts = {
        .on_get = load_ssid,
        .on_set = on_ssid_change,
        .help   = "Network name - 1-32 characters",
        .attrs  = "{\"required\":true,\"maxlength\":32}",
    };
    static const prsl_field_opts_t pass_opts = {
        .on_get = load_pass,
        .help   = "At least 8 characters",
    };
    static const prsl_field_opts_t uptime_opts = { .is_status = true };

    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID", &ssid_opts);

    prsl_add_field(PRSL_PASSWORD, "wifi", "pass", "Password", &pass_opts);

    prsl_add_field(PRSL_TEXT, "system", "uptime", "Uptime", &uptime_opts);

    /* 3. Configure and start */
    prsl_init(&server, save_to_nvs, on_reset, NULL);
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

Three functions manage the library lifecycle: `prsl_init` wires routes and
snapshots the store, `prsl_start` begins serving, and `prsl_stop` tears it all
down so a fresh cycle can run again. In the common one-shot case (settings UI
for the ESP32's full uptime) call `prsl_init` + `prsl_start` once and never
`prsl_stop`.

```c
/**
 * @brief Initialize prsl with a web server, save callback, and optional
 *        reset/reboot callbacks.
 *
 * Wires up HTTP routes (POST /api/settings/save, POST /api/settings/reset,
 * POST /api/system/reboot) and WebSocket endpoint (/api/events).  Serves static assets from flash.
 *
 * @param server   Pointer to an initialized AsyncWebServer (port 80).
 * @param on_save  Callback to persist current values (prsl_save_cb_t).
 *                 May be NULL if you don't need persistence.
 * @param on_reset Callback to reload saved values (prsl_reset_cb_t).
 *                 May be NULL.
 * @param on_reboot Callback to restart the device (prsl_reboot_cb_t).
 *                  May be NULL — if so, Reboot option hidden.
 * @return ESP_OK on success, ESP_ERR_* on failure.
 *
 * @warning All groups and fields MUST be registered BEFORE calling
 *          this function.  The store snapshot is taken at init time. */
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save,
                    prsl_reset_cb_t on_reset, prsl_reboot_cb_t on_reboot);
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

```c
/**
 * @brief Re-load all persisted values and push to browser.
 *
 * Calls each field's on_get callback again and broadcasts the updated
 * settings payload to all connected WebSocket clients.
 *
 * @return ESP_OK on success.
 */
esp_err_t prsl_reset(void);
```

```c
/**
 * @brief Tear the library down (symmetric with prsl_init/prsl_start).
 *
 * Closes WebSocket clients, removes the WS handler, stops the server
 * (server->end()), frees the store (groups, fields, mutex), and resets all
 * library globals. After prsl_stop you may register groups/fields and call
 * prsl_init + prsl_start again for a clean restart.
 *
 * @note The AsyncWebServer is owned by your app and is NOT freed. Re-initing
 *       on the same server object: call server->reset() first so routes and
 *       the old WS handler are not duplicated.
 * @return ESP_OK on success; ESP_ERR_INVALID_STATE if never initialized. */
esp_err_t prsl_stop(void);
```

```c
/**
 * @brief Check whether a Reset callback was registered (non-NULL on_reset
 *        passed to prsl_init).
 * @return true if Reset button should be shown.
 */
bool prsl_has_reset(void);
```

```c
/**
 * @brief Check whether a Reboot callback was registered (non-NULL on_reboot
 *        passed to prsl_init).
 * @return true if Reboot option should be shown.
 */
bool prsl_has_reboot(void);
```

**Typical call order in `app_main`:**

```
nvs_flash_init()                  /* hardware                   */
WiFi.softAP(...)                  /* network                    */
prsl_add_group(...)               /* register groups            */
prsl_add_field(...)               /* register fields            */
prsl_init(&server, on_save, on_reset, on_reboot) /* wire routes, snapshot store */
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

> **Group IDs must not start with `_`.** The `_` namespace is reserved for
> protocol meta keys (`_meta`). `prsl_add_group`
> rejects `_`-prefixed IDs with `ESP_ERR_INVALID_ARG`; subsequent
> `prsl_add_field` calls for that group return `ESP_ERR_NOT_FOUND`. Use a
> non-underscore ID for internal/read-only groups.

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
static const prsl_field_opts_t ssid_opts = {
    .on_get = load_ssid,
    .on_set = on_ssid_change,
    .help   = "Network name",
    .attrs  = "{\"required\":true,\"maxlength\":32}",
};
prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID", &ssid_opts);

/* Minimal field (NULL opts) */
prsl_add_field(PRSL_NUMBER, "gpio", "pin", "Pin Number", NULL);

/* Range slider with min/max */
static const prsl_field_opts_t brightness_opts = {
    .help  = "0-255",
    .attrs = "{\"min\":0,\"max\":255}",
};
prsl_add_field(PRSL_RANGE, "led", "brightness", "Brightness", &brightness_opts);

/* Checkbox with indeterminate state (NULL on_get = indeterminate) */
static const prsl_field_opts_t enable_ai_opts = {
    .help = "Enable experimental AI features",
};
prsl_add_field(PRSL_CHECKBOX, "features", "enable_ai", "Enable AI", &enable_ai_opts);

/* Select field with options */
static const char *mode_opts[][2] = {
    {"station", "Station Mode"},
    {"ap",      "Access Point"},
    {"ap_sta",  "AP + Station"},
};
static const prsl_field_opts_t mode_field_opts = {
    .on_set = on_mode_change,
    .help   = "Operating mode",
};
prsl_add_field_opts(PRSL_SELECT, "wifi", "mode", "WiFi Mode",
    mode_opts, 3,
    &mode_field_opts);

/* Radio group */
static const char *role_opts[][2] = {
    {"master", "Master"},
    {"slave",  "Slave"},
};
static const prsl_field_opts_t role_field_opts = { .help = "Cluster node role" };
prsl_add_field_opts(PRSL_RADIO, "cluster", "role", "Role",
    role_opts, 2,
    &role_field_opts);
```

---

## Field Options Struct

All optional per-field parameters are passed through `prsl_field_opts_t`:

```c
typedef struct {
    bool           is_status;  /**< true = read-only status field */
    prsl_get_cb_t  on_get;     /**< Load persisted value. NULL = type default */
    prsl_set_cb_t  on_set;     /**< React to value changes. NULL = auto-accept */
    const char    *help;       /**< Help text. NULL = no help text rendered */
    const char    *attrs;      /**< HTML validation attrs as JSON. NULL = none */
} prsl_field_opts_t;
```

| Field | Type | Description |
|---|---|---|
| `is_status` | `bool` | `false` by default. `true` = read-only status field (renders disabled). |
| `on_get` | `prsl_get_cb_t` | Called once per field at init. Return persisted value string, or NULL for default (checkbox→indeterminate, others→empty). |
| `on_set` | `prsl_set_cb_t` | Called on every value change and on Save with a typed `prsl_val_t *`. The callback OWNS persistence — accept by writing the value back via `prsl_set_val()` (may transform first), or write nothing to discard. Return `ESP_OK` to accept, anything else to reject (WS apply and Save both abort at the first rejection). |
| `help` | `const char *` | Helper text shown below the field. NULL = no help text rendered. |
| `attrs` | `const char *` | JSON string of HTML form attributes (see Attrs Format below). NULL = no validation attributes. |

> **Ack guarantee (0.9.0+):** every WS apply is answered with an `ack` carrying
> the value the store holds afterwards, read back after `on_set` returns — not
> the value the browser sent. Transforms and discards therefore update the
> widget silently, and a rejection reverts the field and leaves it retryable.
> Nothing is left waiting for an echo.

`on_set` contract for callback-owned writes:

- **Idempotent.** A lost ack makes the browser resend a value once, and a
  reconnect can replay an apply, so `on_set` may be called twice with the same
  value. Writing the value and setting dirty must be safe to repeat.
- **Store values the widget can display.** The ack reports the stored value and
  the browser writes it back verbatim. If you normalize `"auto"` to
  `"station"`, the `select` options must contain `"station"`; if you store a
  number, the `number`/`range` widget must be able to show it.
- **Rejections abort the batch.** WS apply and Save both stop at the first
  rejection; fields after it are never attempted. The ack's `d` still reports
  their current stored values, so the client does not mistake "never attempted"
  for "applied as sent".

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
| `PRSL_FILE` | file input + Upload button | Use `prsl_add_file_field`, not `prsl_add_field` |

## File Upload

A file field streams a selected file to a developer callback in chunks. The
library owns transport, lifecycle, limits, and the browser UI; the developer
owns storage, content validation, commit/rollback, and dirty semantics. It is a
settings field (never a status field), and its value is the current **file
label** string, read-only to the browser.

### Registration

```c
typedef struct {
    prsl_get_cb_t    on_get;          /* current file label, or NULL          */
    prsl_upload_cb_t on_upload;       /* required                              */
    const char      *accept;          /* optional HTML accept list             */
    size_t           max_size;        /* device limit; 0 = no limit            */
    uint32_t         idle_timeout_ms; /* device timeout; 0 = default 30000 ms  */
    const char      *help;            /* optional help text                    */
    const char      *attrs;           /* optional extra HTML attributes JSON   */
} prsl_file_opts_t;

esp_err_t prsl_add_file_field(const char *group_id, const char *key,
                              const char *label,
                              const prsl_file_opts_t *opts);
```

- `on_upload` is required; a NULL callback returns `ESP_ERR_INVALID_ARG`.
- `on_get` is the load hook: it returns the current **file label** (a string) or
  `NULL`. The library loads it at init and on reset, like any other field value.
- `max_size == 0` means no limit. Empty files (0 bytes) are always rejected.
  This is a device-enforced limit (RAM/flash protection), not just a browser
  hint.
- `idle_timeout_ms == 0` uses the library default of 30000 ms. The timeout is
  inactivity-based — time since the last received chunk, not total duration.
  It is device-only and never sent to the browser.
- `accept` is the HTML file-input filter: a comma-separated list of extensions
  and/or MIME types (e.g. `.bin,application/octet-stream`, `audio/*`). It is a
  UX/policy filter backed by declared metadata, **not** a security boundary:
  users can bypass the picker and clients can lie. Content checks belong in
  `on_upload`.
- `attrs` is a JSON object of extra HTML attributes for the file input (e.g.
  `{"title":"Firmware image"}`). It is presentation-only. Do **not** put
  `accept`, `max_size`, or `idle_timeout_ms` in it — those stay typed so the
  device and the browser share one source of truth, and a typo cannot silently
  disable a safety limit.

**Why a dedicated function?** All scalar widgets (text, number, checkbox,
select, range, …) share one data contract: a single scalar value, `on_get`/
`on_set`, and the browser's apply/save pipeline. A file field changes the
callback shape (an `on_upload` stream instead of `on_set`), the transport
(preflight + raw PUT), the value ownership (a server-owned read-only label),
and the option set (`accept`, `max_size`, `idle_timeout_ms`). Rejected
alternatives were extending `prsl_field_opts_t` with upload members (grows every
field's footprint and admits invalid combinations such as `on_set` on a file
field) and reusing `prsl_add_field_opts` (a file field has no `options` array).
The dedicated function leaves `prsl_field_opts_t` and every existing field
unchanged.

`prsl_add_field(PRSL_FILE, ...)` returns `ESP_ERR_INVALID_ARG`. The header
documents `prsl_add_file_field` as the only registration path.

### The upload callback

```c
typedef enum {
    PRSL_UPLOAD_META,   /* metadata only, exactly once, before any CHUNK */
    PRSL_UPLOAD_CHUNK,  /* data bytes; zero or more                       */
    PRSL_UPLOAD_END,    /* body complete; commit here; exactly once       */
    PRSL_UPLOAD_ABORT   /* client gone / idle timeout / prsl_stop; cleanup */
} prsl_upload_event_t;

typedef struct {
    prsl_upload_event_t event;
    const char *group_id;   /* registered group, e.g. "audio" */
    const char *key;        /* registered key, e.g. "clip"    */
    const char *name;       /* basename of the uploaded file; never NULL */
    const char *mime;       /* declared Content-Type, or NULL */
    size_t size;            /* declared Content-Length */
    size_t offset;          /* byte offset of data (CHUNK only) */
    const uint8_t *data;    /* CHUNK only; valid only during this call */
    size_t len;             /* CHUNK length; 0 for other events */
    char *err;              /* callback writes an error message here */
    size_t err_len;         /* size of err, including NUL */
    int status;             /* HTTP status hint on rejection; 0 = default */
} prsl_upload_t;

typedef esp_err_t (*prsl_upload_cb_t)(prsl_upload_t *u);
```

**Lifecycle:** `META` fires exactly once before any bytes, `CHUNK` zero or more
times, then either `END` (body complete) or `ABORT` (cleanup). `data` is valid
only for the duration of the `CHUNK` call — write or copy it synchronously.
`name`, `size`, and `mime` are valid on every event.

- Returning anything other than `ESP_OK` from `META`, `CHUNK`, or `END` rejects
  the upload. Write a human-readable reason to `u->err` (e.g.
  `snprintf(u->err, u->err_len, "Not a firmware image")`); if it is empty, the
  library supplies a generic message. `u->status` chooses the HTTP status on
  rejection (`0` = the library default: `400` for `META`/`CHUNK`, `500` for
  `END`; a non-zero value is used verbatim, clamped to 400–599).
- **`ABORT` is guaranteed exactly once for every upload that reached `META`,
  unless `END` returned `ESP_OK`.** This includes a `META`/`CHUNK` rejection, an
  error from `END`, a transport drop, an idle timeout, and `prsl_stop()` during
  the upload. It never fires after a successful `END` and never fires twice. On
  `ABORT` the return value and `status` are ignored. `ABORT` is the only cleanup
  signal — close/delete temp files and free resources there.
- `u->mime` is `NULL` when the client omitted the MIME type; it is never `""`
  for “absent”.

**Task and blocking:** `on_upload` runs in the AsyncTCP task. It must return
promptly and must not block; a callback that blocks forever also blocks
`prsl_stop()` and teardown. `ABORT` must be idempotent and fast, and must not
assume the server/WebSocket is still alive if it is called during `prsl_stop()`.

### File label vs. uploaded name

These are different strings with different owners:

| | File label (`on_get`, `value`, `prsl_get`) | Uploaded name (`u->name`) |
|---|---|---|
| Origin | developer, at load/upload/save | browser's selected file |
| Meaning | whatever the developer wants to show | client-supplied original name |
| Examples | `firmware.bin`, `v3.11`, `beep.mp3 (pending)` | `firmware_v3.11_2026_11_10.bin` |
| Trust | trusted device state | untrusted input |
| Auto-updated by library | never | n/a |

The developer changes the label from firmware with `prsl_set_str("grp.key",
"firmware.bin")` (plus `prsl_push()` to update open browsers), and
`prsl_get("grp.key")` reads it back. The library never renames and never
auto-sets the label. `u->size` is the declared upload size and may differ from a
stored/compressed size; structured file metadata is deferred (`docs/BACKLOG.md`).

### Name rules

The device rejects a filename that is not a non-empty basename: at most 127
bytes after URL decoding, no `'/'`, no `'\\'`, no control characters, and not
exactly `"."` or `".."`. The developer is responsible for treating `u->name` as
untrusted if it is used to build a filesystem path.

### HTTP surface

Two endpoints per field (the group/key are path segments; the browser
URL-encodes them and the `name`/`type` query values):

```
POST /api/upload/<group>/<key>                          preflight (advisory)
PUT  /api/upload/<group>/<key>?name=<name>&type=<mime>   raw file body
```

The preflight body is `{"name":"beep.mp3","size":12345,"type":"audio/mpeg"}`.
The PUT requires `Content-Length` (chunked transfer returns `411`) and
`Content-Type: application/octet-stream`; the device re-checks the preflight
guards authoritatively. The field-level checks are: known file field (`404`), no
upload already active (`409`), valid name (`400`), `size > 0` (`400`),
`size <= max_size` (`413`), `accept` match (`415`). One upload at a time,
device-wide. See `WS_PROTOCOL.md` and the spec for the full wire/HTTP contract.

### `prsl_stop()` during an upload

`prsl_stop()` safely aborts an in-flight upload from another task: it sets a
stopping flag and serializes against upload body callbacks with an upload mutex,
delivering `ABORT` exactly once. It still assumes no concurrent
save/reset/reboot/preflight handler is touching the store. Either call
`prsl_stop()` from the AsyncTCP task or quiesce the server first; full
in-flight-request quiescing is deferred to 1.0 (`docs/BACKLOG.md`). A developer
`ABORT` callback must be idempotent and must not assume the server/WS is alive.

A late disconnect from a previous request cannot abort a newer upload: the
disconnect callback is bound to an upload generation, so only the request that
owns the current upload can abort it.

## Settings Meta

Every settings payload carries a top-level `_meta` object:

```json
"_meta": {"dirty": false, "show_reset": true, "show_reboot": true, "uploading": false}
```

- `dirty`, `show_reset`, `show_reboot`, and `uploading` live only inside
  `_meta`; there are no top-level meta keys.
- `uploading` is device-global: `true` from an upload's first `META` until its
  `END`/`ABORT`, and present in every settings payload even for endpoints with
  no file fields.

## Dirty

The `_meta.dirty` flag is exclusively developer-driven. Set it true when applied values
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

> **Sharp consequence:** `_meta.dirty` is only ever *cleared* by parasol. If firmware never calls `prsl_set_dirty(true)`, the browser never shows the Save button (unless `always_show_save` is on), and a Save click is a silent no-op — no POST is sent and nothing persists. Call `prsl_set_dirty(true)` inside `on_set` (or wherever external state changes).

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
 * @brief Store a typed value as-is (the "accept" one-liner for on_set).
 * @param path  Dot-path string, e.g. "wifi.ssid".
 * @param value Typed value; never NULL. kind == PRSL_VAL_NULL stores null.
 * @return ESP_OK on success.
 *
 * Maps kind to cJSON the same way the setters above do individually
 * (STRING/NUMBER/BOOL/NULL). Does NOT broadcast and does NOT set dirty —
 * the callback decides dirty semantics. */
esp_err_t prsl_set_val(const char *path, const prsl_val_t *value);
```

```c
/**
 * @brief Get a field's current value from AV store.
 * @param path Dot-path string, e.g. "system.uptime".
 * @return Pointer to value string, or NULL. Valid until next prsl_set_*
 *         for the same path. Do NOT free. */
const char *prsl_get(const char *path);
```

```c
/**
 * @brief Strict typed getters.
 * @param path Dot-path string, e.g. "led.brightness".
 * @param out  Receives the value on success.
 * @return ESP_OK and sets *out when the field exists with a compatible
 *         stored type (number for int/float, bool for bool);
 *         ESP_ERR_NOT_FOUND for a missing field OR a wrong type.
 *         They do NOT parse strings — a string field reads back only
 *         via prsl_get. */
esp_err_t prsl_get_int(const char *path, int *out);
esp_err_t prsl_get_float(const char *path, float *out);
esp_err_t prsl_get_bool(const char *path, bool *out);
```

> `prsl_get()` returns values **only** for fields stored as strings. Use the
> typed getters `prsl_get_int`/`prsl_get_float`/`prsl_get_bool` for number/bool
> fields; they are strict and return `ESP_ERR_NOT_FOUND` on a type mismatch.
> Set typed values with `prsl_set_*` (or `prsl_set_val` inside `on_set`).

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
    prsl_set_str("sensors.temperature", buf);

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

## Reboot Callback

Optional callback registered via `prsl_init`. Performs cleanup then
restarts the device.

```c
typedef esp_err_t (*prsl_reboot_cb_t)(void);
```

**Example:**

```c
static esp_err_t on_reboot(void) {
    /* Close any open connections, flush buffers, etc. */
    esp_restart();
    return ESP_OK;  /* never reached */
}
```

---

## Build-Time Configuration

`parasol_config.json` supports these keys:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `title` | string | `"PARASOL"` | Page title |
| `logo` | string | `"/logo.png"` | Navbar logo URL |
| `favicon` | string | `"/favicon.ico"` | Favicon URL |
| `always_show_save` | bool | `false` | Always show Save button, ignore dirty flag |

These values are baked into `index.html` at asset-generation time. Default
assets are committed under `src/prsl_assets.{h,c}`; after editing
`parasol_config.json`, regenerate them with
`python3 scripts/generate_assets.py` (or via `npm run build`) so the committed
copy stays in sync. ESP-IDF builds read the config fresh via CMake.

---

## Full Example

The complete, runnable example lives at:
[`examples/basic/main.c`](examples/basic/main.c)

For the WebSocket protocol used between the device and browser, see
[`WS_PROTOCOL.md`](WS_PROTOCOL.md).
