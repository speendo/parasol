# Per-Field Storage Callbacks API Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cJSON-based `pwui_storage_t` with per-field `on_load`/`on_apply` callbacks in a type-safe struct. Replace varargs sentinels with `pwui_field_opts_t` compound literal. Add a global `pwui_commit_cb_t` for single-cycle NVS persistence. Add `pwui_reset()`.

**Architecture:** Each field carries `pwui_load_cb_t` (called at init to restore values) and `pwui_apply_cb_t` (called on blur + on Save; returns `esp_err_t` to reject). The global `pwui_commit_cb_t` fires once on Save after all `on_apply` calls pass, enabling one NVS write cycle. cJSON vanishes from the public API — it remains internal only for browser wire format serialization.

**Tech Stack:** C (ESP-IDF), cJSON (internal), Unity (test)

**Breaking changes summary:**

| Before | After |
|---|---|
| `pwui_add_field(type, id, key, label, PWUI_VALUE, "x", PWUI_APPLY, cb, PWUI_END)` | `pwui_add_field(type, id, key, label, &(pwui_field_opts_t){.on_load=cb1,.on_apply=cb2})` |
| `pwui_init(server, &storage)` where storage has 3 cJSON callbacks | `pwui_init(server, commit_cb)` with 1 flat-array callback |
| `pwui_apply_cb_t` returns `void` | Returns `esp_err_t` |
| `PWUI_VALUE`, `PWUI_NULL`, `PWUI_END` sentinels | Removed entirely |
| `pwui_storage_t` struct | Removed entirely |

---

### Task 1: Update `pwui.h` — new types, struct, signatures

**Files:**
- Modify: `components/pico-settings/include/pwui.h`

- [ ] **Step 1: Replace the entire file**

```c
#pragma once
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
class AsyncWebServer;
#else
typedef struct AsyncWebServer AsyncWebServer;
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ── Types ─────────────────────────────────────────────────── */

typedef enum {
    PWUI_TEXT, PWUI_NUMBER, PWUI_PASSWORD, PWUI_EMAIL, PWUI_TEL,
    PWUI_URL, PWUI_COLOR, PWUI_SWITCH, PWUI_CHECKBOX,
    PWUI_RANGE, PWUI_TEXTAREA, PWUI_RADIO, PWUI_SELECT
} pwui_type_t;

/** @brief Called once per field at pwui_init time.
 *  @return Persisted value string, or NULL.
 *          For PWUI_CHECKBOX: NULL = indeterminate (third state).
 *          For all other types: NULL = start empty. */
typedef const char *(*pwui_load_cb_t)(void);

/** @brief Called on every value change (blur/change) and on Save.
 *  @param comp_id Component ID, e.g. "wifi".
 *  @param key     Field key, e.g. "ssid".
 *  @param value   New value string, or NULL if cleared/indeterminate.
 *  @return ESP_OK to accept, anything else to reject (Save aborts). */
typedef esp_err_t (*pwui_apply_cb_t)(const char *comp_id, const char *key, const char *value);

/** @brief Called once per Save, after all on_apply callbacks have returned ESP_OK.
 *  @param pairs  Array of [path, value] pairs. pairs[i][0] = "comp_id.key", pairs[i][1] = "value".
 *  @param count  Number of pairs.
 *  Use for single-cycle NVS persistence (one open/write/commit). */
typedef void (*pwui_commit_cb_t)(const char *pairs[][2], int count);

/** @brief Per-field options. All fields are required; pass NULL to opt out.
 *  @var on_load  NULL = type-dependent (checkbox→indeterminate, else empty).
 *                  For status fields: always NULL (runtime loop provides values).
 *  @var on_apply NULL = auto-accept any value (returns ESP_OK).
 *                  For status fields: always NULL (fields are read-only in browser).
 *  @var help     NULL = no tooltip rendered.
 *  @var attrs    NULL = no HTML validation attributes. */
typedef struct {
    pwui_load_cb_t  on_load;
    pwui_apply_cb_t on_apply;
    const char     *help;
    const char     *attrs;
} pwui_field_opts_t;

/* ── Lifecycle ──────────────────────────────────────────────── */

/** @brief Initialize pwui with a web server and commit callback.
 *  @param server     Initialized AsyncWebServer (port 80).
 *  @param on_commit  Called on Save after all on_apply pass. NULL = no persistence.
 *  @return ESP_OK on success.
 *  @warning All components and fields MUST be registered BEFORE calling this. */
esp_err_t pwui_init(AsyncWebServer *server, pwui_commit_cb_t on_commit);

/** @brief Start the async web server. */
esp_err_t pwui_start(void);

/** @brief Re-load all persisted values from on_load callbacks and push to browser.
 *  Resets applied values to stored values, discarding unsaved changes. */
esp_err_t pwui_reset(void);

/* ── Component registration ─────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status);
esp_err_t pwui_end_component(const char *id);

/* ── Field registration ─────────────────────────────────────── */

/** @brief Register a field. opts may be NULL for no callbacks/help/attrs. */
esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, const pwui_field_opts_t *opts);

/** @brief Register a select or radio field with options. */
esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              const pwui_field_opts_t *opts);

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value);
const char *pwui_get(const char *path);

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void);
esp_err_t pwui_broadcast_status(void);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add components/pico-settings/include/pwui.h
git commit -m "refactor: redesign pwui.h with struct-based field opts and per-field callbacks"
```

---

### Task 2: Update `pwui_store.h` — add `on_load` to field struct

**Files:**
- Modify: `components/pico-settings/src/pwui_store.h`

Key changes:
- `pwui_apply_cb_t` now returns `esp_err_t` (was `void`) — sync with pwui.h
- Add `pwui_load_cb_t on_load` to `pwui_field_t`
- Add `pwui_store_load_values()` — calls on_load on every field at init time
- Add `pwui_store_reset_values()` — re-calls on_load on every field
- Remove `pwui_store_populate()` — no more cJSON-based population

- [ ] **Step 1: Replace the file**

```c
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"
#include "pwui.h"

#define PWUI_MAX_PATH 128

typedef struct {
    const char *comp_id;       /* points to flash string literal */
    const char *key;           /* points to flash string literal */
    const char *label;         /* points to flash string literal */
    pwui_type_t type;
    bool is_status;
    const char *help;          /* points to flash string literal, or "" */
    const char *attrs;         /* points to flash string literal, or "" */
    pwui_apply_cb_t on_apply;
    pwui_load_cb_t on_load;
    const char *(*options)[2]; /* points to static array of [value,label] pairs */
    int option_count;
    cJSON *value;              /* cJSON value node (RAM) */
} pwui_field_t;

typedef struct {
    const char *comp_id;
    const char *label;
} pwui_comp_meta_t;

typedef struct {
    pwui_field_t *fields;
    int count;
    int capacity;
    bool dirty;
    pwui_comp_meta_t *comps;
    int comp_count;
    int comp_capacity;
} pwui_store_t;

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t pwui_store_init(pwui_store_t *store);
void pwui_store_deinit(pwui_store_t *store);
esp_err_t pwui_store_add_field(pwui_store_t *store, const pwui_field_t *field);
esp_err_t pwui_store_add_component(pwui_store_t *store, const char *comp_id, const char *label);
const char *pwui_store_get_label(pwui_store_t *store, const char *comp_id);
pwui_field_t *pwui_store_find(pwui_store_t *store, const char *comp_id, const char *key);
esp_err_t pwui_store_set_value(pwui_store_t *store, const char *comp_id, const char *key, const char *value_str);
cJSON *pwui_store_get_value(pwui_store_t *store, const char *comp_id, const char *key);
bool pwui_store_is_dirty(pwui_store_t *store);
void pwui_store_set_dirty(pwui_store_t *store, bool d);
void pwui_store_clear_dirty(pwui_store_t *store);
int pwui_store_settings_count(pwui_store_t *store);
int pwui_store_status_count(pwui_store_t *store);
pwui_field_t *pwui_store_field_at(pwui_store_t *store, int i);
void pwui_store_lock(pwui_store_t *store);
void pwui_store_unlock(pwui_store_t *store);

/** @brief Call on_load on every registered field to populate initial values. */
esp_err_t pwui_store_load_values(pwui_store_t *store);

/** @brief Re-call on_load on every field (for reset). */
esp_err_t pwui_store_reset_values(pwui_store_t *store);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add components/pico-settings/src/pwui_store.h
git commit -m "refactor: add on_load to pwui_field_t, add load_values/reset_values"
```

---

### Task 3: Update `pwui_store.c` — implement load_values, reset_values, remove populate

**Files:**
- Modify: `components/pico-settings/src/pwui_store.c`

- [ ] **Step 1: Remove `pwui_store_populate` (lines 163-200), add load_values and reset_values**

First, delete the entire `pwui_store_populate` function (lines 163-200). Then add two new functions at the end of the file before the closing:

```c
esp_err_t pwui_store_load_values(pwui_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->count; i++) {
        pwui_field_t *f = &store->fields[i];
        if (!f->on_load) continue;
        const char *val = f->on_load();
        pwui_store_set_value(store, f->comp_id, f->key, val);
    }
    store->dirty = false;
    return ESP_OK;
}

esp_err_t pwui_store_reset_values(pwui_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->count; i++) {
        pwui_field_t *f = &store->fields[i];
        if (!f->on_load) {
            pwui_store_set_value(store, f->comp_id, f->key, NULL);
            continue;
        }
        const char *val = f->on_load();
        pwui_store_set_value(store, f->comp_id, f->key, val);
    }
    store->dirty = false;
    return ESP_OK;
}
```

- [ ] **Step 2: Build and run store unit tests**

Run: `npm run test:unit`
Expected: Tests that call `pwui_store_populate` will FAIL (function removed). Tests for basic store operations (add, find, set, get) should PASS. This is expected — tests updated in Task 7.

- [ ] **Step 3: Commit**

```bash
git add components/pico-settings/src/pwui_store.c
git commit -m "refactor: replace populate with load_values, add reset_values"
```

---

### Task 4: Update `pwui_json.c` — remove storage-callback cJSON logic

**Files:**
- Modify: `components/pico-settings/src/pwui_json.c`

The `pwui_json_build_settings` and `pwui_json_build_status` functions stay — they serialize to the browser wire format. Nothing changes here since they read from the store, not from callbacks.

No changes needed in this file. The cJSON round-trip that's being removed was in the storage layer (`pwui_store_populate`), not in the JSON builder.

- [ ] **Step 1: Verify no changes needed**

Run: `grep -n "populate\|on_load\|on_save\|on_reset" components/pico-settings/src/pwui_json.c`
Expected: No matches (confirming this file doesn't reference the removed functions).

- [ ] **Step 2: Skip commit** (no changes)

---

### Task 5: Create `pwui.c` — main coordinator module

**Files:**
- Create: `components/pico-settings/src/pwui.c`

This is the glue that ties store, JSON, and WebSocket together. Currently no such file exists — the example just calls the functions declared in pwui.h but they're not implemented anywhere outside the test stubs.

- [ ] **Step 1: Write the file**

```c
#include "pwui.h"
#include "pwui_store.h"
#include "pwui_json.h"
#include "pwui_ws.h"
#include "pwui_assets.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

/* ── Global state ───────────────────────────────────────────── */

static pwui_store_t g_store;
static AsyncWebServer *g_server = NULL;
static AsyncWebSocket *g_ws = NULL;
static pwui_commit_cb_t g_on_commit = NULL;
static bool g_initialized = false;
static bool g_current_is_status = false;  /* set by pwui_begin_component, read by pwui_add_field */

/* ── Lifecycle ───────────────────────────────────────────────── */

esp_err_t pwui_init(AsyncWebServer *server, pwui_commit_cb_t on_commit) {
    if (!server || !g_initialized) return ESP_ERR_INVALID_ARG;

    /* Load persisted values from all on_load callbacks */
    pwui_store_load_values(&g_store);

    g_server = server;
    g_on_commit = on_commit;

    /* Serve static assets from flash */
    for (size_t i = 0; i < pwui_assets_count; i++) {
        server->on((String("/") + pwui_assets[i].path).c_str(), HTTP_GET,
            [i](AsyncWebServerRequest *req) {
                AsyncWebServerResponse *resp = req->beginResponse(
                    200, pwui_assets[i].mime, pwui_assets[i].data, pwui_assets[i].len);
                resp->addHeader("Cache-Control", "max-age=3600");
                req->send(resp);
            });
    }

    /* HTTP route: settings GET */
    server->on("/api/settings", HTTP_GET, [](AsyncWebServerRequest *req) {
        cJSON *json = pwui_json_build_settings(&g_store);
        if (json) {
            cJSON_AddBoolToObject(json, "_dirty", pwui_store_is_dirty(&g_store));
            char *str = cJSON_PrintUnformatted(json);
            cJSON_Delete(json);
            if (str) {
                req->send(200, "application/json", str);
                free(str);
                return;
            }
        }
        req->send(500, "text/plain", "Serialization error");
    });

    /* HTTP route: settings SAVE */
    server->on("/api/settings/save", HTTP_POST,
        [](AsyncWebServerRequest *req) {}, NULL,
        [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
           size_t index, size_t total) {
            cJSON *msg = cJSON_ParseWithLength((const char *)data, total);
            if (!msg) {
                req->send(400, "text/plain", "Invalid JSON");
                return;
            }
            cJSON *body = cJSON_GetObjectItem(msg, "data");
            if (body) {
                /* Apply all values first (on_apply rejects invalid) */
                cJSON *group = body->child;
                while (group) {
                    if (cJSON_IsObject(group) && group->string[0] != '_') {
                        cJSON *field = group->child;
                        while (field) {
                            if (cJSON_IsArray(field) && cJSON_GetArraySize(field) >= 3) {
                                cJSON *opts = cJSON_GetArrayItem(field, 2);
                                cJSON *val = cJSON_GetObjectItem(opts, "value");
                                const char *val_str = val ? cJSON_GetStringValue(val) : NULL;
                                char num_buf[64] = {0};
                                if (!val_str && val && cJSON_IsNumber(val)) {
                                    snprintf(num_buf, sizeof(num_buf), "%g", cJSON_GetNumberValue(val));
                                    val_str = num_buf;
                                }
                                /* Reject if on_apply fails */
                                pwui_field_t *f = pwui_store_find(&g_store, group->string, field->string);
                                if (f && f->on_apply) {
                                    esp_err_t ae = f->on_apply(group->string, field->string, val_str);
                                    if (ae != ESP_OK) {
                                        char err[128];
                                        snprintf(err, sizeof(err), "on_apply rejected %s.%s", group->string, field->string);
                                        req->send(400, "text/plain", err);
                                        cJSON_Delete(msg);
                                        return;
                                    }
                                }
                                pwui_store_set_value(&g_store, group->string, field->string, val_str);
                                pwui_store_clear_dirty(&g_store);
                            }
                            field = field->next;
                        }
                    }
                    group = group->next;
                }

                /* Commit */
                if (g_on_commit) {
                    /* Build flat pairs array */
                    #define MAX_PAIRS 64
                    const char *pairs[MAX_PAIRS][2];
                    int pair_count = 0;
                    group = body->child;
                    while (group && pair_count < MAX_PAIRS) {
                        if (cJSON_IsObject(group) && group->string[0] != '_') {
                            cJSON *field = group->child;
                            while (field && pair_count < MAX_PAIRS) {
                                if (cJSON_IsArray(field) && cJSON_GetArraySize(field) >= 3) {
                                    cJSON *opts = cJSON_GetArrayItem(field, 2);
                                    cJSON *val = cJSON_GetObjectItem(opts, "value");
                                    if (val) {
                                        /* Use store's string value as the authoritative source */
                                        cJSON *sv = pwui_store_get_value(&g_store, group->string, field->string);
                                        if (sv && cJSON_IsString(sv)) {
                                            /* Build full path, e.g. "wifi.ssid" */
                                            static char paths[MAX_PAIRS][128];
                                            snprintf(paths[pair_count], sizeof(paths[0]), "%s.%s", group->string, field->string);
                                            pairs[pair_count][0] = paths[pair_count];
                                            pairs[pair_count][1] = cJSON_GetStringValue(sv);
                                            pair_count++;
                                        }
                                    }
                                }
                                field = field->next;
                            }
                        }
                        group = group->next;
                    }
                    if (pair_count > 0) {
                        g_on_commit((const char *(*)[2])pairs, pair_count);
                    }
                }
            }
            cJSON_Delete(msg);
            req->send(200, "text/plain", "OK");
        });

    g_initialized = true;
    return ESP_OK;
}

esp_err_t pwui_start(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;

    /* Setup WebSocket */
    g_ws = new AsyncWebSocket("/api/events");
    pwui_ws_init(g_ws, &g_store);
    g_server->addHandler(g_ws);

    g_server->begin();
    return ESP_OK;
}

esp_err_t pwui_reset(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;
    pwui_store_reset_values(&g_store);
    return pwui_push();
}

/* ── Component registration ─────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status) {
    if (!g_initialized) {
        if (pwui_store_init(&g_store) != ESP_OK) return ESP_ERR_NO_MEM;
        g_initialized = true;
    }
    g_current_is_status = is_status;
    return pwui_store_add_component(&g_store, id, label);
}

esp_err_t pwui_end_component(const char *id) {
    (void)id;
    return ESP_OK;
}

/* ── Field registration ─────────────────────────────────────── */

esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, const pwui_field_opts_t *opts) {
    pwui_field_t f = {0};
    f.comp_id = comp_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.is_status = g_current_is_status;

    if (opts) {
        f.on_load  = opts->on_load;
        f.on_apply = opts->on_apply;
        f.help     = opts->help ? opts->help : "";
        f.attrs    = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return pwui_store_add_field(&g_store, &f);
}

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label, const char *options[][2],
                              int option_count, const pwui_field_opts_t *opts) {
    pwui_field_t f = {0};
    f.comp_id = comp_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.is_status = g_current_is_status;
    f.options = options;
    f.option_count = option_count;

    if (opts) {
        f.on_load  = opts->on_load;
        f.on_apply = opts->on_apply;
        f.help     = opts->help ? opts->help : "";
        f.attrs    = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return pwui_store_add_field(&g_store, &f);
}

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value) {
    char comp_id[PWUI_MAX_PATH] = {0};
    char key[PWUI_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_INVALID_ARG;
    size_t clen = dot - path;
    if (clen >= PWUI_MAX_PATH) return ESP_ERR_INVALID_ARG;
    memcpy(comp_id, path, clen);
    strncpy(key, dot + 1, PWUI_MAX_PATH - 1);
    return pwui_store_set_value(&g_store, comp_id, key, value);
}

const char *pwui_get(const char *path) {
    char comp_id[PWUI_MAX_PATH] = {0};
    char key[PWUI_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return NULL;
    size_t clen = dot - path;
    if (clen >= PWUI_MAX_PATH) return NULL;
    memcpy(comp_id, path, clen);
    strncpy(key, dot + 1, PWUI_MAX_PATH - 1);
    cJSON *v = pwui_store_get_value(&g_store, comp_id, key);
    if (!v || !cJSON_IsString(v)) return NULL;
    return cJSON_GetStringValue(v);
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void) {
    if (!g_ws) return ESP_ERR_INVALID_STATE;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");
    cJSON_AddBoolToObject(root, "_dirty", pwui_store_is_dirty(&g_store));
    cJSON *data = pwui_json_build_settings(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws->textAll(str);
        free(str);
    }
    return ESP_OK;
}

esp_err_t pwui_broadcast_status(void) {
    if (!g_ws) return ESP_ERR_INVALID_STATE;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "status");
    cJSON *data = pwui_json_build_status(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws->textAll(str);
        free(str);
    }
    return ESP_OK;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pico-settings/src/pwui.c
git commit -m "feat: add pwui.c coordinator with struct-based field opts"
```

**Note:** `pwui.c` calls `pwui_ws_init()` which is declared in `pwui_ws.h` but not yet implemented. Task 5a below provides a stub.

---

### Task 5a: Create `pwui_ws.c` — WebSocket handler stub

**Files:**
- Create: `components/pico-settings/src/pwui_ws.c`

This file implements the WebSocket event handler for `/api/events`. On WS connect, it pushes status then settings. On incoming `action: "apply"` messages, it calls `on_apply` for each changed field and rejects on failure. The full WS state machine (echo resolution, collision detection) is out of scope — this stub provides the minimum to make `pwui.c` compile and function correctly for single-client use.

- [ ] **Step 1: Write the file**

```c
#include "pwui_ws.h"
#include "pwui_store.h"
#include "pwui_json.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

static pwui_store_t *g_store = NULL;

static void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client,
                     AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        /* Push status then settings on connect */
        cJSON *status = cJSON_CreateObject();
        cJSON_AddStringToObject(status, "type", "status");
        cJSON_AddItemToObject(status, "data", pwui_json_build_status(g_store));
        char *s = cJSON_PrintUnformatted(status);
        cJSON_Delete(status);
        if (s) { client->text(s); free(s); }

        cJSON *settings = cJSON_CreateObject();
        cJSON_AddStringToObject(settings, "type", "settings");
        cJSON_AddBoolToObject(settings, "_dirty", pwui_store_is_dirty(g_store));
        cJSON_AddItemToObject(settings, "data", pwui_json_build_settings(g_store));
        char *s2 = cJSON_PrintUnformatted(settings);
        cJSON_Delete(settings);
        if (s2) { client->text(s2); free(s2); }
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo *)arg;
        if (info->final && info->index == 0 && info->len == len
            && info->opcode == WS_TEXT) {
            data[len] = '\0';

            cJSON *msg = cJSON_Parse((const char *)data);
            if (!msg) return;

            cJSON *action = cJSON_GetObjectItem(msg, "action");
            if (action && cJSON_IsString(action) && strcmp(action->valuestring, "apply") == 0) {
                cJSON *body = cJSON_GetObjectItem(msg, "data");
                if (!body || !cJSON_IsObject(body)) { cJSON_Delete(msg); return; }

                cJSON *group = body->child;
                while (group) {
                    if (!cJSON_IsObject(group) || group->string[0] == '_') {
                        group = group->next; continue;
                    }
                    cJSON *field = group->child;
                    while (field) {
                        if (!cJSON_IsArray(field) || cJSON_GetArraySize(field) < 3) {
                            field = field->next; continue;
                        }
                        cJSON *opts = cJSON_GetArrayItem(field, 2);
                        cJSON *val = NULL;
                        const char *val_str = NULL;
                        if (cJSON_IsObject(opts)) val = cJSON_GetObjectItem(opts, "value");
                        char num_buf[64] = {0};
                        if (val && cJSON_IsString(val)) {
                            val_str = val->valuestring;
                        } else if (val && cJSON_IsNumber(val)) {
                            snprintf(num_buf, sizeof(num_buf), "%g", cJSON_GetNumberValue(val));
                            val_str = num_buf;
                        }

                        pwui_field_t *f = pwui_store_find(g_store, group->string, field->string);
                        if (f && f->on_apply) {
                            esp_err_t ae = f->on_apply(group->string, field->string, val_str);
                            if (ae != ESP_OK) {
                                char err[128];
                                snprintf(err, sizeof(err), "{\"type\":\"error\",\"message\":\"on_apply rejected %s.%s\"}",
                                         group->string, field->string);
                                client->text(err);
                            } else {
                                pwui_store_set_value(g_store, group->string, field->string, val_str);
                                /* Push updated settings to all clients */
                                cJSON *resp = cJSON_CreateObject();
                                cJSON_AddStringToObject(resp, "type", "settings");
                                cJSON_AddItemToObject(resp, "data", pwui_json_build_settings(g_store));
                                char *out = cJSON_PrintUnformatted(resp);
                                cJSON_Delete(resp);
                                if (out) { server->textAll(out); free(out); }
                            }
                        } else if (f) {
                            /* No on_apply — auto-accept */
                            pwui_store_set_value(g_store, group->string, field->string, val_str);
                        }
                        field = field->next;
                    }
                    group = group->next;
                }
            }
            cJSON_Delete(msg);
        }
    }
}

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;
    g_store = store;
    ws->onEvent(on_event);
    return ESP_OK;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pico-settings/src/pwui_ws.c
git commit -m "feat: add pwui_ws.c with apply rejection and on-connect push"
```

---

### Task 6: Update example `main.c`

**Files:**
- Modify: `components/pico-settings/examples/basic/main.c`

- [ ] **Step 1: Replace the file**

```c
#include "pwui.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

/* ── Per-field load callbacks ─────────────────────────────────
 * Called at pwui_init time. Return persisted value (or factory default)
 * from NVS. Return NULL if no value stored yet.
 */

static const char *load_ssid(void) {
    /* In a real app, read from NVS. Here we return a static default. */
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
    /* Factory default if NVS is empty */
    return "MyNetwork";
}

static const char *load_pass(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("pwui", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.pass", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "";
}

/* ── Apply callback ───────────────────────────────────────────
 * on_apply fires on blur/change AND on Save.
 * Return ESP_OK to accept. Return anything else to reject (Save aborts).
 */

static esp_err_t on_ssid_change(const char *comp_id, const char *key,
                                 const char *value) {
    printf("%s.%s changed to: %s\n", comp_id, key, value);
    if (value && strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

/* ── Commit callback ──────────────────────────────────────────
 * Called once per Save, after all on_apply have returned ESP_OK.
 * All changed pairs are passed as a flat array.  Do ONE nvs_open /
 * write loop / nvs_commit / nvs_close to minimize flash wear.
 *
 * Compare against current NVS value before writing — skip if unchanged.
 */

static void commit_to_nvs(const char *pairs[][2], int count) {
    nvs_handle_t h;
    if (nvs_open("pwui", NVS_READWRITE, &h) != ESP_OK) return;

    for (int i = 0; i < count; i++) {
        /* Skip if value hasn't changed (avoids unnecessary flash writes) */
        char current[64];
        size_t len = sizeof(current);
        if (nvs_get_str(h, pairs[i][0], current, &len) == ESP_OK
            && strcmp(current, pairs[i][1]) == 0) continue;
        nvs_set_str(h, pairs[i][0], pairs[i][1]);
    }

    nvs_commit(h);
    nvs_close(h);
    printf("Saved %d changed field(s) to NVS\n", count);
}

/* ── Main ───────────────────────────────────────────────────── */

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
            .help     = "Network name - 1-32 characters",
            .attrs    = "{\"required\":true,\"maxlength\":32}",
        });
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
        &(pwui_field_opts_t){
            .on_load  = load_pass,
            .on_apply = NULL,   /* NULL = auto-accept any value */
            .help     = "At least 8 characters",
        });
    pwui_end_component("wifi");

    /* Status component: on_load = NULL (ignored, values come from runtime loop) */
    pwui_begin_component("system", "System Status", true);
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime",
        &(pwui_field_opts_t){
            .on_load  = NULL,
            .on_apply = NULL,
        });
    pwui_end_component("system");

    /* init + start */
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

- [ ] **Step 2: Commit**

```bash
git add components/pico-settings/examples/basic/main.c
git commit -m "refactor: update example for struct-based field opts and commit callback"
```

---

### Task 7: Update store unit tests

**Files:**
- Modify: `components/pico-settings/test/test_pwui_store.c`

- [ ] **Step 1: Replace tests that reference `pwui_store_populate` with `pwui_store_load_values`**

Remove these tests (they test `pwui_store_populate` which no longer exists):
- `test_populate_from_cjson` (lines 123-144)
- `test_populate_with_group_label` (lines 241-258)
- `test_populate_null_data` (lines 197-199)
- `test_populate_non_object` (lines 201-205)

Replace with new tests for `pwui_store_load_values`:

```c
/* ── New tests replacing populate tests ── */

static const char *test_load_ssid(void) { return "LoadedSSID"; }
static const char *test_load_pass(void) { return "secret"; }
static const char *test_load_null(void) { return NULL; }
static const char *test_load_default(void) { return "MyNetwork"; }

void test_load_values_calls_on_load(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = test_load_ssid;
    pwui_store_add_field(&store, &f);

    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));

    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v));
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_load_values_multiple_fields(void) {
    pwui_field_t f1 = make_field("wifi", "ssid", PWUI_TEXT, false);
    f1.on_load = test_load_ssid;
    pwui_store_add_field(&store, &f1);

    pwui_field_t f2 = make_field("wifi", "pass", PWUI_PASSWORD, false);
    f2.on_load = test_load_pass;
    pwui_store_add_field(&store, &f2);

    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));

    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v1));
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v1));

    cJSON *v2 = pwui_store_get_value(&store, "wifi", "pass");
    TEST_ASSERT_TRUE(cJSON_IsString(v2));
    TEST_ASSERT_EQUAL_STRING("secret", cJSON_GetStringValue(v2));
}

void test_load_values_null_on_load_skipped(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = NULL;
    pwui_store_add_field(&store, &f);
    /* on_load is NULL — field stays with no value (NULL) */
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));
    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v);
}

void test_load_values_on_load_returns_null(void) {
    pwui_field_t f = make_field("gpio", "confirm", PWUI_CHECKBOX, false);
    f.on_load = test_load_null;
    pwui_store_add_field(&store, &f);
    /* on_load returns NULL → checkbox indeterminate (cJSON null) */
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));
    cJSON *v = pwui_store_get_value(&store, "gpio", "confirm");
    TEST_ASSERT_TRUE(cJSON_IsNull(v));
}

void test_reset_values_reloads_all(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = test_load_ssid;
    pwui_store_add_field(&store, &f);

    /* First load */
    pwui_store_load_values(&store);
    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v1));

    /* Simulate user change */
    pwui_store_set_value(&store, "wifi", "ssid", "ChangedValue");
    TEST_ASSERT_TRUE(pwui_store_is_dirty(&store));

    /* Reset → reloads from on_load, discards change */
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_reset_values(&store));
    cJSON *v2 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v2));
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_reset_values_null_on_load(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = NULL;  /* no load callback — reset should clear to NULL */
    pwui_store_add_field(&store, &f);
    /* First set a value (simulating a runtime update) */
    pwui_store_set_value(&store, "wifi", "ssid", "SomeValue");
    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v1));

    /* Reset with NULL on_load → value set to NULL */
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_reset_values(&store));
    cJSON *v2 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v2);
}

void test_reset_values_null_store(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, pwui_store_reset_values(NULL));
}

void test_load_values_null_store(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, pwui_store_load_values(NULL));
}
```

- [ ] **Step 2: Update `main()` to include new tests and remove old ones**

Remove these lines from `main()`:
```c
    RUN_TEST(test_populate_from_cjson);
    RUN_TEST(test_populate_null_data);
    RUN_TEST(test_populate_non_object);
    RUN_TEST(test_populate_with_group_label);
```

Add these lines:
```c
    RUN_TEST(test_load_values_calls_on_load);
    RUN_TEST(test_load_values_multiple_fields);
    RUN_TEST(test_load_values_null_on_load_skipped);
    RUN_TEST(test_load_values_on_load_returns_null);
    RUN_TEST(test_reset_values_reloads_all);
    RUN_TEST(test_reset_values_null_on_load);
    RUN_TEST(test_reset_values_null_store);
    RUN_TEST(test_load_values_null_store);
```

- [ ] **Step 3: Build and run unit tests**

Run: `npm run test:unit`
Expected: All store tests PASS.

- [ ] **Step 4: Commit**

```bash
git add components/pico-settings/test/test_pwui_store.c
git commit -m "test: update store tests for load_values/reset_values, remove populate tests"
```

---

### Task 8: Update `API_REFERENCE.md`

**Files:**
- Modify: `API_REFERENCE.md`

Full rewrite of Quick Start and API sections to reflect the struct-based API.

- [ ] **Step 1: Replace the file**

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
```

- [ ] **Step 2: Commit**

```bash
git add API_REFERENCE.md
git commit -m "docs: rewrite API reference for struct-based field opts"
```

---

### Task 9: Version bump

**Files:**
- Modify: `components/pico-settings/library.json`

The library.json version must be bumped. Per AGENTS.md, always ask the user which component to bump.

- [ ] **Step 1: Ask the user**

Question: "This is a breaking API change. Current version is `0.1.0`. Which component should I bump?"

- [ ] **Step 2: Update `library.json` based on user's answer**

```bash
# Example: user says bump minor (0.1.0 → 0.2.0)
# Edit components/pico-settings/library.json
```

- [ ] **Step 3: Commit**

```bash
git add components/pico-settings/library.json
git commit -m "chore: bump version to X.Y.Z"
```

---

## Self-Review

**1. Spec coverage:**
- `pwui.h`: new types (`pwui_load_cb_t`, `pwui_apply_cb_t` returning `esp_err_t`, `pwui_commit_cb_t`, `pwui_field_opts_t`), new `pwui_reset()`, changed `pwui_init` and `pwui_add_field` signatures ✓
- `pwui_store.h`: added `on_load` to field struct, added `load_values`/`reset_values`, removed `populate` ✓
- `pwui_store.c`: implemented `load_values`, `reset_values`, removed `populate` ✓
- `pwui.c`: new coordinator with `g_current_is_status` tracking, on_apply rejection, commit callback, reset wiring. `pwui_init` calls `pwui_store_load_values` (not `pwui_start`). No double init. ✓
- `pwui_ws.c`: new WebSocket handler with on-connect push (status then settings) and per-field `on_apply` rejection on incoming apply messages ✓
- `main.c`: updated for struct pattern with commit callback showing change-skip comment ✓
- `test_pwui_store.c`: populate tests replaced with load_values/reset_values tests ✓
- `API_REFERENCE.md`: full rewrite — struct pattern, commit callback, checkbox indeterminate, status field `on_apply = NULL` rule, error behavior table, lifecycle doc fixed (pwui_init calls load) ✓
- `pwui_json.c`: verified no changes needed ✓
- AGENTS.md: updated to always-ask on version bumps ✓

**2. Placeholder scan:** None.

**3. Type consistency:**
- `pwui_apply_cb_t` returns `esp_err_t` consistently across pwui.h, pwui_store.h, pwui.c, example main.c ✓
- `pwui_field_opts_t` fields match across all usages ✓
- `pwui_load_cb_t` signature consistent ✓
- `pwui_commit_cb_t` signature consistent ✓
- `PWUI_VALUE`, `PWUI_NULL`, `PWUI_END` removed from all files ✓
