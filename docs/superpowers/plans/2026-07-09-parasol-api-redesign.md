# PARASOL API Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename project from pico-settings/pwui to PARASOL/prsl, rename component→group, load→get, apply→set, commit→save, remove begin/end, add `prsl_add_group`, move `is_status` to opts, add dirty check hook, add build-time page configuration.

**Architecture:** The C library lives at `components/parasol/` with a public header `include/prsl.h` and internal modules `prsl_store`, `prsl_json`, `prsl_ws`. The JS client (`app.js`) is unchanged. The Python test server mirrors the C library's behavior for e2e tests. Build-time config (`parasol_config.json`) is processed by CMake to inject title/logo/favicon into `index.html`.

**Tech Stack:** C11 for ESP32 library, Python/FastAPI for test server, vanilla JS for browser client, CMake for build, vitest + Playwright for testing.

---

### Task 1: Rename directory and files

**Files:**
- Git mv: `components/pico-settings/` → `components/parasol/`
- Git mv: all source files inside the directory

- [ ] **Step 1: Rename the top-level component directory**

```bash
git mv components/pico-settings components/parasol
```

- [ ] **Step 2: Rename all source files inside**

```bash
cd components/parasol
git mv include/pwui.h include/prsl.h
git mv src/pwui.cpp src/prsl.cpp
git mv src/pwui_store.h src/prsl_store.h
git mv src/pwui_store.c src/prsl_store.c
git mv src/pwui_json.h src/prsl_json.h
git mv src/pwui_json.c src/prsl_json.c
git mv src/pwui_ws.h src/prsl_ws.h
git mv src/pwui_ws.cpp src/prsl_ws.cpp
git rm src/pwui_assets.h src/pwui_assets.c
git mv test/test_pwui_store.c test/test_prsl_store.c
git mv test/test_pwui_json.c test/test_prsl_json.c
```

- [ ] **Step 3: Verify file structure**

```bash
find components/parasol -type f | sort
```

Expected — all files show new `prsl_` names, no `pwui_` names remain.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "rename: components/pico-settings → components/parasol, pwui_* → prsl_*"
```

---

### Task 2: Rewrite `prsl.h` — public header

**Files:**
- Modify: `components/parasol/include/prsl.h`

- [ ] **Step 1: Write the new public header**

Write the complete file:

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
    PRSL_TEXT, PRSL_NUMBER, PRSL_PASSWORD, PRSL_EMAIL, PRSL_TEL,
    PRSL_URL, PRSL_COLOR, PRSL_SWITCH, PRSL_CHECKBOX,
    PRSL_RANGE, PRSL_TEXTAREA, PRSL_RADIO, PRSL_SELECT
} prsl_type_t;

/** @brief Called once per field at prsl_init time.
 *  @return Persisted value string, or NULL.
 *          For PRSL_CHECKBOX: NULL = indeterminate (third state).
 *          For all other types: NULL = start empty. */
typedef const char *(*prsl_get_cb_t)(void);

/** @brief Called on every value change (blur/change) and on Save.
 *  @param group_id Group ID, e.g. "wifi".
 *  @param key      Field key, e.g. "ssid".
 *  @param value    New value string, or NULL if cleared/indeterminate.
 *  @return ESP_OK to accept, anything else to reject (Save aborts). */
typedef esp_err_t (*prsl_set_cb_t)(const char *group_id, const char *key,
                                    const char *value);

/** @brief Called once per Save, after all on_set callbacks have returned ESP_OK.
 *  @param pairs  Array of [path, value] pairs. pairs[i][0] = "group_id.key", pairs[i][1] = "value".
 *  @param count  Number of pairs.
 *  Use for single-cycle NVS persistence (one open/write/commit). */
typedef void (*prsl_save_cb_t)(const char *pairs[][2], int count);

/** @brief Developer hook: compare current value against persisted storage.
 *  @return true if current_value differs from NVS/EEPROM (dirty),
 *          false if they match (clean). */
typedef bool (*prsl_is_dirty_cb_t)(const char *group_id, const char *key,
                                    const char *current_value);

/** @brief Per-field options. All fields are required; pass NULL to opt out.
 *  @var is_status false by default (via designated initializer). true = read-only status field.
 *  @var on_get    NULL = type-dependent (checkbox→indeterminate, else empty).
 *  @var on_set    NULL = auto-accept any value (returns ESP_OK).
 *  @var help      NULL = no tooltip rendered.
 *  @var attrs     NULL = no HTML validation attributes. */
typedef struct {
    bool           is_status;
    prsl_get_cb_t  on_get;
    prsl_set_cb_t  on_set;
    const char    *help;
    const char    *attrs;
} prsl_field_opts_t;

/* ── Group registration ────────────────────────────────────── */

/** @brief Register a group before adding fields to it.
 *  @param group_id Must be unique. Controls JSON key and DOM prefix.
 *  @param label    NULL = auto-derived from group_id (camelCase/snake_case
 *                  splitting, title-cased). Non-NULL overrides. */
esp_err_t prsl_add_group(const char *group_id, const char *label);

/* ── Field registration ────────────────────────────────────── */

/** @brief Register a field. opts may be NULL for no callbacks/help/attrs. */
esp_err_t prsl_add_field(prsl_type_t type, const char *group_id, const char *key,
                         const char *label, const prsl_field_opts_t *opts);

/** @brief Register a select or radio field with options. */
esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              const prsl_field_opts_t *opts);

/* ── Dirty check ───────────────────────────────────────────── */

/** @brief Register a dirty check hook. Call before prsl_init.
 *  @param is_dirty NULL = any change is dirty (legacy behavior). */
void prsl_set_dirty_check(prsl_is_dirty_cb_t is_dirty);

/** @brief Query whether any unsaved changes exist. */
bool prsl_is_dirty(void);

/* ── Lifecycle ──────────────────────────────────────────────── */

/** @brief Initialize prsl with a web server and save callback.
 *  @param server   Initialized AsyncWebServer (port 80).
 *  @param on_save  Called on Save after all on_set pass. NULL = no persistence.
 *  @return ESP_OK on success.
 *  @warning All groups and fields MUST be registered BEFORE calling this. */
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save);

/** @brief Start the async web server. */
esp_err_t prsl_start(void);

/** @brief Re-load all persisted values from on_get callbacks and push to browser.
 *  Resets applied values to stored values, discarding unsaved changes. */
esp_err_t prsl_reset(void);

/* ── Runtime value access ──────────────────────────────────── */

esp_err_t prsl_set(const char *path, const char *value);
const char *prsl_get(const char *path);

/* ── Push / broadcast ──────────────────────────────────────── */

esp_err_t prsl_push(void);
esp_err_t prsl_broadcast_status(void);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/include/prsl.h
git commit -m "rewrite: prsl.h — new public API with groups, get/set/save, dirty check"
```

---

### Task 3: Rewrite `prsl_store.h` — internal store header

**Files:**
- Modify: `components/parasol/src/prsl_store.h`

- [ ] **Step 1: Write the new store header**

```c
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"
#include "prsl.h"

#define PRSL_MAX_PATH 128

typedef struct {
    const char *group_id;      /* points to flash string literal */
    const char *key;           /* points to flash string literal */
    const char *label;         /* points to flash string literal */
    prsl_type_t type;
    bool is_status;
    const char *help;          /* points to flash string literal, or "" */
    const char *attrs;         /* points to flash string literal, or "" */
    prsl_set_cb_t on_set;
    prsl_get_cb_t on_get;
    const char *(*options)[2]; /* points to static array of [value,label] pairs */
    int option_count;
    cJSON *value;              /* cJSON value node (RAM) */
} prsl_field_t;

typedef struct {
    const char *group_id;
    const char *label;
} prsl_group_meta_t;

typedef struct {
    prsl_field_t *fields;
    int count;
    int capacity;
    bool dirty;
    prsl_group_meta_t *groups;
    int group_count;
    int group_capacity;
    prsl_is_dirty_cb_t is_dirty_hook;
} prsl_store_t;

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t prsl_store_init(prsl_store_t *store);
void prsl_store_deinit(prsl_store_t *store);
esp_err_t prsl_store_add_group(prsl_store_t *store, const char *group_id, const char *label);
esp_err_t prsl_store_add_field(prsl_store_t *store, const prsl_field_t *field);
const char *prsl_store_get_label(prsl_store_t *store, const char *group_id);
prsl_field_t *prsl_store_find(prsl_store_t *store, const char *group_id, const char *key);
esp_err_t prsl_store_set_value(prsl_store_t *store, const char *group_id, const char *key, const char *value_str);
cJSON *prsl_store_get_value(prsl_store_t *store, const char *group_id, const char *key);
bool prsl_store_is_dirty(prsl_store_t *store);
void prsl_store_set_dirty(prsl_store_t *store, bool d);
void prsl_store_clear_dirty(prsl_store_t *store);
void prsl_store_set_dirty_hook(prsl_store_t *store, prsl_is_dirty_cb_t hook);
void prsl_store_check_dirty(prsl_store_t *store);
int prsl_store_settings_count(prsl_store_t *store);
int prsl_store_status_count(prsl_store_t *store);
prsl_field_t *prsl_store_field_at(prsl_store_t *store, int i);
void prsl_store_lock(prsl_store_t *store);
void prsl_store_unlock(prsl_store_t *store);

/** @brief Call on_get on every registered field to populate initial values. */
esp_err_t prsl_store_load_values(prsl_store_t *store);

/** @brief Re-call on_get on every field (for reset). */
esp_err_t prsl_store_reset_values(prsl_store_t *store);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl_store.h
git commit -m "rewrite: prsl_store.h — rename types, add dirty hook, comp→group"
```

---

### Task 4: Rewrite `prsl_store.c` — internal store implementation

**Files:**
- Modify: `components/parasol/src/prsl_store.c`

- [ ] **Step 1: Write the complete store implementation**

```c
#include "prsl_store.h"
#include <stdlib.h>
#include <string.h>

esp_err_t prsl_store_init(prsl_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    memset(store, 0, sizeof(*store));
    store->capacity = 16;
    store->fields = calloc(store->capacity, sizeof(prsl_field_t));
    if (!store->fields) return ESP_ERR_NO_MEM;
    store->group_capacity = 4;
    store->groups = calloc(store->group_capacity, sizeof(prsl_group_meta_t));
    if (!store->groups) {
        free(store->fields);
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void prsl_store_deinit(prsl_store_t *store) {
    if (!store) return;
    for (int i = 0; i < store->count; i++) {
        cJSON_Delete(store->fields[i].value);
    }
    free(store->fields);
    free(store->groups);
    memset(store, 0, sizeof(*store));
}

esp_err_t prsl_store_add_field(prsl_store_t *store, const prsl_field_t *field) {
    if (!store || !field) return ESP_ERR_INVALID_ARG;
    if (store->count >= store->capacity) {
        int new_cap = store->capacity * 2;
        prsl_field_t *new_fields = realloc(store->fields, new_cap * sizeof(prsl_field_t));
        if (!new_fields) return ESP_ERR_NO_MEM;
        store->fields = new_fields;
        store->capacity = new_cap;
    }
    store->fields[store->count] = *field;
    store->fields[store->count].value = NULL;
    store->count++;
    return ESP_OK;
}

prsl_field_t *prsl_store_find(prsl_store_t *store, const char *group_id, const char *key) {
    if (!store || !group_id || !key) return NULL;
    for (int i = 0; i < store->count; i++) {
        if (strcmp(store->fields[i].group_id, group_id) == 0 &&
            strcmp(store->fields[i].key, key) == 0) {
            return &store->fields[i];
        }
    }
    return NULL;
}

int prsl_store_settings_count(prsl_store_t *store) {
    if (!store) return 0;
    int n = 0;
    for (int i = 0; i < store->count; i++) {
        if (!store->fields[i].is_status) n++;
    }
    return n;
}

int prsl_store_status_count(prsl_store_t *store) {
    if (!store) return 0;
    int n = 0;
    for (int i = 0; i < store->count; i++) {
        if (store->fields[i].is_status) n++;
    }
    return n;
}

prsl_field_t *prsl_store_field_at(prsl_store_t *store, int i) {
    if (!store || i < 0 || i >= store->count) return NULL;
    return &store->fields[i];
}

static bool is_bool_type(prsl_type_t t) {
    return t == PRSL_CHECKBOX || t == PRSL_SWITCH;
}

static bool is_number_type(prsl_type_t t) {
    return t == PRSL_NUMBER || t == PRSL_RANGE;
}

esp_err_t prsl_store_set_value(prsl_store_t *store, const char *group_id,
                                const char *key, const char *value_str) {
    if (!store || !group_id || !key) return ESP_ERR_INVALID_ARG;
    prsl_field_t *f = prsl_store_find(store, group_id, key);
    if (!f) return ESP_ERR_NOT_FOUND;

    cJSON_Delete(f->value);
    f->value = NULL;

    if (value_str == NULL || (is_bool_type(f->type) && value_str[0] == '\0')) {
        f->value = cJSON_CreateNull();
    } else if (is_bool_type(f->type)) {
        bool v = (strcmp(value_str, "true") == 0 || strcmp(value_str, "1") == 0);
        f->value = cJSON_CreateBool(v);
    } else if (is_number_type(f->type)) {
        f->value = cJSON_CreateNumber(atof(value_str));
    } else {
        f->value = cJSON_CreateString(value_str);
    }

    if (!f->is_status) {
        if (store->is_dirty_hook) {
            char path[PRSL_MAX_PATH];
            snprintf(path, sizeof(path), "%s.%s", group_id, key);
            const char *cv = (f->value && cJSON_IsString(f->value))
                ? cJSON_GetStringValue(f->value) : NULL;
            if (store->is_dirty_hook(group_id, key, cv)) {
                store->dirty = true;
            }
        } else {
            store->dirty = true;
        }
    }
    return ESP_OK;
}

cJSON *prsl_store_get_value(prsl_store_t *store, const char *group_id, const char *key) {
    prsl_field_t *f = prsl_store_find(store, group_id, key);
    if (!f) return NULL;
    return f->value;
}

bool prsl_store_is_dirty(prsl_store_t *store) {
    return store ? store->dirty : false;
}

void prsl_store_set_dirty(prsl_store_t *store, bool d) {
    if (store) store->dirty = d;
}

void prsl_store_clear_dirty(prsl_store_t *store) {
    if (store) store->dirty = false;
}

void prsl_store_set_dirty_hook(prsl_store_t *store, prsl_is_dirty_cb_t hook) {
    if (store) store->is_dirty_hook = hook;
}

void prsl_store_check_dirty(prsl_store_t *store) {
    if (!store || !store->is_dirty_hook) return;
    store->dirty = false;
    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = &store->fields[i];
        if (f->is_status) continue;
        const char *cv = (f->value && cJSON_IsString(f->value))
            ? cJSON_GetStringValue(f->value) : NULL;
        if (store->is_dirty_hook(f->group_id, f->key, cv)) {
            store->dirty = true;
            break;
        }
    }
}

void prsl_store_lock(prsl_store_t *store) { (void)store; }
void prsl_store_unlock(prsl_store_t *store) { (void)store; }

esp_err_t prsl_store_add_group(prsl_store_t *store, const char *group_id, const char *label) {
    if (!store || !group_id) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->group_count; i++) {
        if (strcmp(store->groups[i].group_id, group_id) == 0) {
            if (!label && !store->groups[i].label) return ESP_OK;
            if (label && store->groups[i].label
                && strcmp(store->groups[i].label, label) == 0) return ESP_OK;
            return ESP_ERR_INVALID_STATE;
        }
    }
    if (store->group_count >= store->group_capacity) {
        int new_cap = store->group_capacity * 2;
        prsl_group_meta_t *new_groups = realloc(store->groups, new_cap * sizeof(prsl_group_meta_t));
        if (!new_groups) return ESP_ERR_NO_MEM;
        store->groups = new_groups;
        store->group_capacity = new_cap;
    }
    store->groups[store->group_count].group_id = group_id;
    store->groups[store->group_count].label = label;
    store->group_count++;
    return ESP_OK;
}

const char *prsl_store_get_label(prsl_store_t *store, const char *group_id) {
    if (!store || !group_id) return NULL;
    for (int i = 0; i < store->group_count; i++) {
        if (strcmp(store->groups[i].group_id, group_id) == 0)
            return store->groups[i].label;
    }
    return NULL;
}

esp_err_t prsl_store_load_values(prsl_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = &store->fields[i];
        if (!f->on_get) continue;
        const char *val = f->on_get();
        prsl_store_set_value(store, f->group_id, f->key, val);
    }
    store->dirty = false;
    return ESP_OK;
}

esp_err_t prsl_store_reset_values(prsl_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = &store->fields[i];
        if (!f->on_get) {
            prsl_store_set_value(store, f->group_id, f->key, NULL);
            continue;
        }
        const char *val = f->on_get();
        prsl_store_set_value(store, f->group_id, f->key, val);
    }
    store->dirty = false;
    return ESP_OK;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl_store.c
git commit -m "rewrite: prsl_store.c — rename all symbols, add dirty hook logic"
```

---

### Task 5: Rewrite `prsl_json.h` — JSON module header

**Files:**
- Modify: `components/parasol/src/prsl_json.h`

- [ ] **Step 1: Write the new header**

```c
#pragma once
#include "cJSON.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

cJSON *prsl_json_build_settings(prsl_store_t *store);
cJSON *prsl_json_build_status(prsl_store_t *store);
int prsl_json_parse_apply(prsl_store_t *store, const char *json_str,
                          char groups[][32], char keys[][32],
                          char values[][256], int max_changes);
char *prsl_json_fix_attrs_quotes(const char *attrs_str);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl_json.h
git commit -m "rewrite: prsl_json.h — rename types, comps→groups"
```

---

### Task 6: Rewrite `prsl_json.c` — JSON module implementation

**Files:**
- Modify: `components/parasol/src/prsl_json.c`

- [ ] **Step 1: Write the complete implementation**

```c
#include "prsl_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *prsl_json_fix_attrs_quotes(const char *attrs_str) {
    if (!attrs_str || attrs_str[0] == '\0') return strdup("{}");
    size_t len = strlen(attrs_str);
    char *fixed = malloc(len + 1);
    if (!fixed) return strdup("{}");
    for (size_t i = 0; i < len; i++) {
        fixed[i] = (attrs_str[i] == '\'') ? '"' : attrs_str[i];
    }
    fixed[len] = '\0';
    return fixed;
}

static cJSON *build_group(prsl_store_t *store, bool is_status) {
    cJSON *root = cJSON_CreateObject();

    const char *current_group_id = NULL;
    cJSON *group_obj = NULL;

    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = prsl_store_field_at(store, i);
        if (f->is_status != is_status) continue;

        if (!current_group_id || strcmp(current_group_id, f->group_id) != 0) {
            current_group_id = f->group_id;
            group_obj = cJSON_CreateObject();
            const char *label = prsl_store_get_label(store, f->group_id);
            if (label) {
                cJSON_AddStringToObject(group_obj, "label", label);
            }
            cJSON_AddItemToObject(root, f->group_id, group_obj);
        }

        cJSON *field_arr = cJSON_CreateArray();
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(
            f->type == PRSL_TEXT ? "text" :
            f->type == PRSL_NUMBER ? "number" :
            f->type == PRSL_PASSWORD ? "password" :
            f->type == PRSL_EMAIL ? "email" :
            f->type == PRSL_TEL ? "tel" :
            f->type == PRSL_URL ? "url" :
            f->type == PRSL_COLOR ? "color" :
            f->type == PRSL_SWITCH ? "switch" :
            f->type == PRSL_CHECKBOX ? "checkbox" :
            f->type == PRSL_RANGE ? "range" :
            f->type == PRSL_TEXTAREA ? "textarea" :
            f->type == PRSL_RADIO ? "radio" : "select"
        ));
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(f->label));

        cJSON *opts = cJSON_CreateObject();

        if (f->value) {
            cJSON_AddItemToObject(opts, "value", cJSON_Duplicate(f->value, 1));
        } else {
            cJSON_AddNullToObject(opts, "value");
        }

        if (f->help && f->help[0]) {
            cJSON_AddStringToObject(opts, "help", f->help);
        }

        if (f->option_count > 0) {
            cJSON *options_arr = cJSON_CreateArray();
            for (int j = 0; j < f->option_count; j++) {
                cJSON *pair = cJSON_CreateArray();
                cJSON_AddItemToArray(pair, cJSON_CreateString(f->options[j][0]));
                cJSON_AddItemToArray(pair, cJSON_CreateString(f->options[j][1]));
                cJSON_AddItemToArray(options_arr, pair);
            }
            cJSON_AddItemToObject(opts, "options", options_arr);
        }

        if (f->attrs && f->attrs[0]) {
            char *fixed = prsl_json_fix_attrs_quotes(f->attrs);
            cJSON *attrs_json = cJSON_Parse(fixed);
            if (attrs_json && cJSON_IsObject(attrs_json)) {
                cJSON_AddItemToObject(opts, "attrs", attrs_json);
            } else {
                if (attrs_json) cJSON_Delete(attrs_json);
            }
            free(fixed);
        }

        cJSON_AddItemToArray(field_arr, opts);
        cJSON_AddItemToObject(group_obj, f->key, field_arr);
    }

    return root;
}

cJSON *prsl_json_build_settings(prsl_store_t *store) {
    return build_group(store, false);
}

cJSON *prsl_json_build_status(prsl_store_t *store) {
    return build_group(store, true);
}

int prsl_json_parse_apply(prsl_store_t *store, const char *json_str,
                          char groups[][32], char keys[][32],
                          char values[][256], int max_changes) {
    if (!store || !json_str) return 0;

    cJSON *msg = cJSON_Parse(json_str);
    if (!msg) return 0;

    cJSON *data = cJSON_GetObjectItem(msg, "data");
    if (!data || !cJSON_IsObject(data)) {
        cJSON_Delete(msg);
        return 0;
    }

    int count = 0;
    cJSON *group = data->child;
    while (group && count < max_changes) {
        if (!cJSON_IsObject(group) || group->string[0] == '_') {
            group = group->next; continue;
        }
        cJSON *field = group->child;
        while (field && count < max_changes) {
            if (!cJSON_IsArray(field) || cJSON_GetArraySize(field) < 3) {
                field = field->next; continue;
            }
            cJSON *opts = cJSON_GetArrayItem(field, 2);
            cJSON *val = NULL;
            if (cJSON_IsObject(opts)) {
                val = cJSON_GetObjectItem(opts, "value");
            }
            if (val && prsl_store_find(store, group->string, field->string)) {
                strncpy(groups[count], group->string, 31);
                groups[count][31] = '\0';
                strncpy(keys[count], field->string, 31);
                keys[count][31] = '\0';
                if (cJSON_IsString(val)) {
                    strncpy(values[count], val->valuestring, 255);
                    values[count][255] = '\0';
                } else if (cJSON_IsNumber(val)) {
                    snprintf(values[count], 256, "%g", val->valuedouble);
                } else if (cJSON_IsTrue(val)) {
                    strncpy(values[count], "true", 255);
                } else if (cJSON_IsFalse(val)) {
                    strncpy(values[count], "false", 255);
                } else {
                    values[count][0] = '\0';
                }
                count++;
            }
            field = field->next;
        }
        group = group->next;
    }

    cJSON_Delete(msg);
    return count;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl_json.c
git commit -m "rewrite: prsl_json.c — rename all symbols, comps→groups"
```

---

### Task 7: Rewrite `prsl_ws.h` — WebSocket module header

**Files:**
- Modify: `components/parasol/src/prsl_ws.h`

- [ ] **Step 1: Write the new header**

```c
#pragma once
#include "ESPAsyncWebServer.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t prsl_ws_init(AsyncWebSocket *ws, prsl_store_t *store);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl_ws.h
git commit -m "rewrite: prsl_ws.h — rename symbols"
```

---

### Task 8: Rewrite `prsl_ws.cpp` — WebSocket implementation

**Files:**
- Modify: `components/parasol/src/prsl_ws.cpp`

- [ ] **Step 1: Write the complete implementation**

```c
#include "prsl_ws.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

static prsl_store_t *g_store = NULL;

static void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client,
                     AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        cJSON *status = cJSON_CreateObject();
        cJSON_AddStringToObject(status, "type", "status");
        cJSON_AddItemToObject(status, "data", prsl_json_build_status(g_store));
        char *s = cJSON_PrintUnformatted(status);
        cJSON_Delete(status);
        if (s) { client->text(s); free(s); }

        cJSON *settings = cJSON_CreateObject();
        cJSON_AddStringToObject(settings, "type", "settings");
        cJSON_AddBoolToObject(settings, "_dirty", prsl_store_is_dirty(g_store));
        cJSON_AddItemToObject(settings, "data", prsl_json_build_settings(g_store));
        char *s2 = cJSON_PrintUnformatted(settings);
        cJSON_Delete(settings);
        if (s2) { client->text(s2); free(s2); }
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo *)arg;
        if (info->final && info->index == 0 && info->len == len
            && info->opcode == WS_TEXT && len > 0) {
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

                        prsl_field_t *f = prsl_store_find(g_store, group->string, field->string);
                        if (f && f->on_set) {
                            esp_err_t ae = f->on_set(group->string, field->string, val_str);
                            if (ae != ESP_OK) {
                                char err[128];
                                snprintf(err, sizeof(err), "{\"type\":\"error\",\"message\":\"on_set rejected %s.%s\"}",
                                         group->string, field->string);
                                client->text(err);
                            } else {
                                prsl_store_set_value(g_store, group->string, field->string, val_str);
                                cJSON *resp = cJSON_CreateObject();
                                cJSON_AddStringToObject(resp, "type", "settings");
                                cJSON_AddItemToObject(resp, "data", prsl_json_build_settings(g_store));
                                char *out = cJSON_PrintUnformatted(resp);
                                cJSON_Delete(resp);
                                if (out) { server->textAll(out); free(out); }
                            }
                        } else if (f) {
                            prsl_store_set_value(g_store, group->string, field->string, val_str);
                            cJSON *resp = cJSON_CreateObject();
                            cJSON_AddStringToObject(resp, "type", "settings");
                            cJSON_AddItemToObject(resp, "data", prsl_json_build_settings(g_store));
                            char *out = cJSON_PrintUnformatted(resp);
                            cJSON_Delete(resp);
                            if (out) { server->textAll(out); free(out); }
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

esp_err_t prsl_ws_init(AsyncWebSocket *ws, prsl_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;
    g_store = store;
    ws->onEvent(on_event);
    return ESP_OK;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl_ws.cpp
git commit -m "rewrite: prsl_ws.cpp — rename all symbols, on_apply→on_set"
```

---

### Task 9: Rewrite `prsl.cpp` — main implementation

**Files:**
- Modify: `components/parasol/src/prsl.cpp`

- [ ] **Step 1: Write the complete implementation**

```c
#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_ws.h"
#include "prsl_assets.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

/* ── Global state ───────────────────────────────────────────── */

static prsl_store_t g_store;
static AsyncWebServer *g_server = NULL;
static AsyncWebSocket g_ws("/api/events");
static prsl_save_cb_t g_on_save = NULL;
static bool g_initialized = false;

/* ── Group registration ─────────────────────────────────────── */

esp_err_t prsl_add_group(const char *group_id, const char *label) {
    if (!g_initialized) {
        esp_err_t err = prsl_store_init(&g_store);
        if (err != ESP_OK) return err;
        g_initialized = true;
    }
    return prsl_store_add_group(&g_store, group_id, label);
}

/* ── Field registration ─────────────────────────────────────── */

esp_err_t prsl_add_field(prsl_type_t type, const char *group_id, const char *key,
                         const char *label, const prsl_field_opts_t *opts) {
    prsl_field_t f = {0};
    f.group_id = group_id;
    f.key = key;
    f.label = label;
    f.type = type;

    if (opts) {
        f.is_status = opts->is_status;
        f.on_get    = opts->on_get;
        f.on_set    = opts->on_set;
        f.help      = opts->help ? opts->help : "";
        f.attrs     = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return prsl_store_add_field(&g_store, &f);
}

esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id, const char *key,
                              const char *label, const char *options[][2],
                              int option_count, const prsl_field_opts_t *opts) {
    prsl_field_t f = {0};
    f.group_id = group_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.options = options;
    f.option_count = option_count;

    if (opts) {
        f.is_status = opts->is_status;
        f.on_get    = opts->on_get;
        f.on_set    = opts->on_set;
        f.help      = opts->help ? opts->help : "";
        f.attrs     = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return prsl_store_add_field(&g_store, &f);
}

/* ── Dirty check ────────────────────────────────────────────── */

void prsl_set_dirty_check(prsl_is_dirty_cb_t is_dirty) {
    prsl_store_set_dirty_hook(&g_store, is_dirty);
}

bool prsl_is_dirty(void) {
    return prsl_store_is_dirty(&g_store);
}

/* ── Lifecycle ───────────────────────────────────────────────── */

esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save) {
    if (!server) return ESP_ERR_INVALID_ARG;

    prsl_store_load_values(&g_store);

    g_server = server;
    g_on_save = on_save;

    for (size_t i = 0; i < prsl_assets_count; i++) {
        const prsl_asset_t *a = &prsl_assets[i];
        server->on(a->path, HTTP_GET, [a](AsyncWebServerRequest *req) {
            AsyncWebServerResponse *resp = req->beginResponse(200, a->mime,
                a->data, a->len);
            resp->addHeader("Content-Encoding", "gzip");
            req->send(resp);
        });
    }

    server->on("/api/settings", HTTP_GET, [](AsyncWebServerRequest *req) {
        cJSON *json = prsl_json_build_settings(&g_store);
        if (json) {
            cJSON_AddBoolToObject(json, "_dirty", prsl_store_is_dirty(&g_store));
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
                                prsl_field_t *f = prsl_store_find(&g_store, group->string, field->string);
                                if (f && f->on_set) {
                                    esp_err_t ae = f->on_set(group->string, field->string, val_str);
                                    if (ae != ESP_OK) {
                                        char err[128];
                                        snprintf(err, sizeof(err), "on_set rejected %s.%s", group->string, field->string);
                                        req->send(400, "text/plain", err);
                                        cJSON_Delete(msg);
                                        return;
                                    }
                                }
                                prsl_store_set_value(&g_store, group->string, field->string, val_str);
                            }
                            field = field->next;
                        }
                    }
                    group = group->next;
                }

                enum { MAX_PAIRS = 64 };
                const char *pairs[MAX_PAIRS][2];
                char paths[MAX_PAIRS][128];
                int pair_count = 0;
                if (g_on_save) {
                    group = body->child;
                    while (group && pair_count < MAX_PAIRS) {
                        if (cJSON_IsObject(group) && group->string[0] != '_') {
                            cJSON *field = group->child;
                            while (field && pair_count < MAX_PAIRS) {
                                if (cJSON_IsArray(field) && cJSON_GetArraySize(field) >= 3) {
                                    cJSON *opts = cJSON_GetArrayItem(field, 2);
                                    cJSON *val = cJSON_GetObjectItem(opts, "value");
                                    if (val) {
                                        cJSON *sv = prsl_store_get_value(&g_store, group->string, field->string);
                                        if (sv && cJSON_IsString(sv)) {
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
                }
                if (pair_count > 0 && g_on_save) {
                    g_on_save(pairs, pair_count);
                }
                prsl_store_check_dirty(&g_store);
            }
            cJSON_Delete(msg);
            req->send(200, "text/plain", "OK");
        });

    return ESP_OK;
}

esp_err_t prsl_start(void) {
    if (!g_server) return ESP_ERR_INVALID_STATE;

    prsl_ws_init(&g_ws, &g_store);
    g_server->addHandler(&g_ws);

    g_server->begin();
    return ESP_OK;
}

esp_err_t prsl_reset(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;
    prsl_store_reset_values(&g_store);
    return prsl_push();
}

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t prsl_set(const char *path, const char *value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_INVALID_ARG;
    size_t clen = dot - path;
    if (clen >= PRSL_MAX_PATH) return ESP_ERR_INVALID_ARG;
    memcpy(group_id, path, clen);
    group_id[clen] = '\0';
    strncpy(key, dot + 1, PRSL_MAX_PATH - 1);
    key[PRSL_MAX_PATH - 1] = '\0';
    return prsl_store_set_value(&g_store, group_id, key, value);
}

const char *prsl_get(const char *path) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return NULL;
    size_t clen = dot - path;
    if (clen >= PRSL_MAX_PATH) return NULL;
    memcpy(group_id, path, clen);
    group_id[clen] = '\0';
    strncpy(key, dot + 1, PRSL_MAX_PATH - 1);
    key[PRSL_MAX_PATH - 1] = '\0';
    cJSON *v = prsl_store_get_value(&g_store, group_id, key);
    if (!v || !cJSON_IsString(v)) return NULL;
    return cJSON_GetStringValue(v);
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t prsl_push(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");
    cJSON_AddBoolToObject(root, "_dirty", prsl_store_is_dirty(&g_store));
    cJSON *data = prsl_json_build_settings(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    return ESP_OK;
}

esp_err_t prsl_broadcast_status(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "status");
    cJSON *data = prsl_json_build_status(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    return ESP_OK;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/src/prsl.cpp
git commit -m "rewrite: prsl.cpp — new API with groups, get/set/save, dirty check, no begin/end"
```

---

### Task 10: Update CMake and build files

**Files:**
- Modify: `components/parasol/CMakeLists.txt`
- Modify: `components/parasol/cmake/generate_assets.cmake`
- Modify: `components/parasol/library.json`
- Modify: `components/parasol/scripts/generate_assets.py`

- [ ] **Step 1: Update CMakeLists.txt**

```cmake
# C sources built from source files (not generated)
set(COMPONENT_SRCS "src/prsl_store.c" "src/prsl_json.c" "src/prsl.cpp" "src/prsl_ws.cpp")

# Asset files to watch for changes (relative to repo root)
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}/../../..")

# Generated asset files
set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(ASSETS_C "${GENERATED_DIR}/prsl_assets.c")
set(ASSETS_H "${GENERATED_DIR}/prsl_assets.h")

add_custom_command(
    OUTPUT ${ASSETS_C} ${ASSETS_H}
    COMMAND ${CMAKE_COMMAND}
        -DASSETS_SRC="${ASSETS_SRC}"
        -DCONFIG_FILE="${CMAKE_SOURCE_DIR}/parasol_config.json"
        -DOUT_DIR="${GENERATED_DIR}"
        -P "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    DEPENDS
        "${ASSETS_SRC}/index.html"
        "${ASSETS_SRC}/app.min.js"
        "${ASSETS_SRC}/pico.jade.min.css"
        "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    COMMENT "Generating parasol assets"
)

idf_component_register(
    SRCS ${COMPONENT_SRCS} ${ASSETS_C}
    INCLUDE_DIRS "include" "src" "dependencies/cJSON" "${GENERATED_DIR}"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
)
```

- [ ] **Step 2: Update generate_assets.cmake — add logo and favicon support**

```cmake
# cmake/generate_assets.cmake
find_program(GZIP gzip REQUIRED)

# Default values
set(PARASOL_TITLE "PARASOL")
set(PARASOL_LOGO "/logo.png")
set(PARASOL_FAVICON "/favicon.ico")

# Read config if present
if(EXISTS "${CONFIG_FILE}")
    file(READ "${CONFIG_FILE}" PARASOL_JSON)
    string(JSON PARASOL_TITLE ERROR_VARIABLE _T GET "${PARASOL_JSON}" title)
    if(NOT _T STREQUAL "NOTFOUND")
        string(JSON PARASOL_LOGO ERROR_VARIABLE _L GET "${PARASOL_JSON}" logo)
    endif()
    if(_T STREQUAL "NOTFOUND" OR NOT _L STREQUAL "NOTFOUND")
        string(JSON PARASOL_FAVICON ERROR_VARIABLE _F GET "${PARASOL_JSON}" favicon)
    endif()
endif()

# Read and inject config into HTML
file(READ "${ASSETS_SRC}/index.html" HTML_CONTENT)
string(REPLACE "{{TITLE}}" "${PARASOL_TITLE}" HTML_CONTENT "${HTML_CONTENT}")
string(REPLACE "{{LOGO}}" "${PARASOL_LOGO}" HTML_CONTENT "${HTML_CONTENT}")
string(REPLACE "{{FAVICON}}" "${PARASOL_FAVICON}" HTML_CONTENT "${HTML_CONTENT}")

# Read JS and CSS
file(READ "${ASSETS_SRC}/app.min.js" JS_CONTENT)
file(READ "${ASSETS_SRC}/pico.jade.min.css" CSS_CONTENT)

# Gzip each piece
foreach(PAIR IN ITEMS
    "html;${HTML_CONTENT};index_html_gz"
    "js;${JS_CONTENT};app_min_js_gz"
    "css;${CSS_CONTENT};pico_jade_min_css_gz"
)
    list(GET PAIR 0 TYPE)
    list(GET PAIR 1 CONTENT)
    list(GET PAIR 2 VARNAME)

    file(WRITE "${OUT_DIR}/tmp_${VARNAME}.tmp" "${CONTENT}")

    execute_process(
        COMMAND ${GZIP} -9 -c "${OUT_DIR}/tmp_${VARNAME}.tmp"
        OUTPUT_FILE "${OUT_DIR}/tmp_${VARNAME}.gz"
        RESULT_VARIABLE GZIP_RESULT
    )
    if(NOT GZIP_RESULT EQUAL 0)
        message(FATAL_ERROR "gzip failed for ${VARNAME}")
    endif()

    file(READ "${OUT_DIR}/tmp_${VARNAME}.gz" GZIPPED HEX)
    file(REMOVE "${OUT_DIR}/tmp_${VARNAME}.tmp" "${OUT_DIR}/tmp_${VARNAME}.gz")

    set("${VARNAME}_DATA" "${GZIPPED}")
endforeach()

# Write prsl_assets.h
file(WRITE "${OUT_DIR}/prsl_assets.h" [=[
#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *path;
    const char *mime;
    const uint8_t *data;
    size_t len;
} prsl_asset_t;

extern const prsl_asset_t prsl_assets[];
extern const size_t prsl_assets_count;
]=])

# Write prsl_assets.c
set(OUT_C "${OUT_DIR}/prsl_assets.c")
file(WRITE "${OUT_C}" [=[#include "prsl_assets.h"

]=])

function(write_byte_array VARNAME HEX_DATA OUT_FILE)
    file(APPEND "${OUT_FILE}" "const uint8_t ${VARNAME}[] = {\n")
    set(COL 0)
    while(HEX_DATA)
        string(SUBSTRING "${HEX_DATA}" 0 2 BYTE)
        string(SUBSTRING "${HEX_DATA}" 2 -1 HEX_DATA)
        if(COL EQUAL 0)
            file(APPEND "${OUT_FILE}" "    ")
        endif()
        file(APPEND "${OUT_FILE}" "0x${BYTE}")
        math(EXPR COL "${COL} + 1")
        if(HEX_DATA AND COL LESS 12)
            file(APPEND "${OUT_FILE}" ",")
        elseif(HEX_DATA)
            file(APPEND "${OUT_FILE}" ",\n")
            set(COL 0)
        endif()
    endwhile()
    file(APPEND "${OUT_FILE}" "\n};\n")
endfunction()

macro(write_count VARNAME HEX_DATA OUT_FILE)
    string(LENGTH "${HEX_DATA}" HEX_LEN)
    math(EXPR BYTE_LEN "${HEX_LEN} / 2")
    file(APPEND "${OUT_FILE}" "const size_t ${VARNAME} = ${BYTE_LEN};\n\n")
endmacro()

write_byte_array("index_html_gz" "${index_html_gz_DATA}" "${OUT_C}")
write_count("index_html_gz_len" "${index_html_gz_DATA}" "${OUT_C}")
write_byte_array("app_min_js_gz" "${app_min_js_gz_DATA}" "${OUT_C}")
write_count("app_min_js_gz_len" "${app_min_js_gz_DATA}" "${OUT_C}")
write_byte_array("pico_jade_min_css_gz" "${pico_jade_min_css_gz_DATA}" "${OUT_C}")
write_count("pico_jade_min_css_gz_len" "${pico_jade_min_css_gz_DATA}" "${OUT_C}")

file(APPEND "${OUT_C}" [=[
const prsl_asset_t prsl_assets[] = {
    {"/", "text/html", index_html_gz, index_html_gz_len},
    {"/app.min.js", "application/javascript", app_min_js_gz, app_min_js_gz_len},
    {"/pico.jade.min.css", "text/css", pico_jade_min_css_gz, pico_jade_min_css_gz_len},
};
const size_t prsl_assets_count = 3;
]=])
```

- [ ] **Step 3: Update library.json**

```json
{
    "name": "parasol",
    "version": "1.0.0",
    "description": "Pico Async Realtime Application - Socket Operated Library",
    "keywords": "settings, config, websocket, pico-css, parasol",
    "authors": { "name": "parasol" },
    "frameworks": "arduino,espidf",
    "platforms": "espressif32",
    "headers": ["prsl.h"],
    "dependencies": {
        "me-no-dev/ESP Async WebServer": "~3.11",
        "DaveGamble/cJSON": "~1.7"
    }
}
```

- [ ] **Step 4: Update generate_assets.py — rename pwui → prsl**

Read the file and apply: `pwui_assets` → `prsl_assets`, `pwui_asset_t` → `prsl_asset_t`.

- [ ] **Step 5: Commit**

```bash
git add components/parasol/CMakeLists.txt components/parasol/cmake/generate_assets.cmake components/parasol/library.json components/parasol/scripts/generate_assets.py
git commit -m "build: update CMake, library.json, scripts for PRSL rename + page config"
```

---

### Task 11: Update index.html with placeholders

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace hardcoded values with template placeholders**

Read `index.html` and apply three edits:

Edit A — line 6-7, replace favicon and title:
```html
    <link rel="icon" href="{{FAVICON}}">
    <title>{{TITLE}}</title>
```

Edit B — line 53, replace `<h1>` (the existing `{{TITLE}}` is already there in current file):
No change needed — the current file already has `<h1>{{TITLE}}</h1>` at line 53.

Edit C — line 53, replace hardcoded `/logo.png` in `<img>`:
Change `src="/logo.png"` to `src="{{LOGO}}"`.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "html: replace hardcoded favicon/logo with {{FAVICON}} and {{LOGO}} placeholders"
```

---

### Task 12: Create `parasol_config.json`

**Files:**
- Create: `parasol_config.json`

- [ ] **Step 1: Create the example config file**

```json
{
  "title": "PARASOL",
  "logo": "/logo.png",
  "favicon": "/favicon.ico"
}
```

- [ ] **Step 2: Commit**

```bash
git add parasol_config.json
git commit -m "add: parasol_config.json — build-time page configuration"
```

---

### Task 13: Rewrite example `main.c`

**Files:**
- Modify: `components/parasol/examples/basic/main.c`

- [ ] **Step 1: Write the updated example**

```c
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

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

static const char *load_pass(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("parasol", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.pass", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "";
}

static esp_err_t on_ssid_change(const char *group_id, const char *key,
                                 const char *value) {
    printf("%s.%s changed to: %s\n", group_id, key, value);
    if (value && strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

static void save_to_nvs(const char *pairs[][2], int count) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READWRITE, &h) != ESP_OK) return;

    for (int i = 0; i < count; i++) {
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

void app_main(void) {
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-config", NULL);
    AsyncWebServer server(80);

    prsl_set_dirty_check(check_dirty);

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

    prsl_init(&server, save_to_nvs);
    prsl_start();

    int seconds = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        seconds += 3;
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", seconds);
        prsl_set("system.uptime", buf);
        prsl_broadcast_status();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add components/parasol/examples/basic/main.c
git commit -m "rewrite: example for new PRSL API with get/set/save, dirty check, groups"
```

---

### Task 14: Rewrite C unit tests

**Files:**
- Modify: `components/parasol/test/test_prsl_store.c`
- Modify: `components/parasol/test/test_prsl_json.c`

- [ ] **Step 1: Rewrite test_prsl_store.c**

Apply `s/pwui_/prsl_/g`, `s/PWUI_/PRSL_/g`, `s/comp_id/group_id/g`, `s/comp_count/group_count/g`, `s/comp_capacity/group_capacity/g`, `s/comps/groups/g`, `s/add_component/add_group/g`, `s/on_load/on_get/g`, `s/on_apply/on_set/g` across the entire file.

- [ ] **Step 2: Rewrite test_prsl_json.c**

Same replacements as Step 1 across the entire file.

- [ ] **Step 3: Verify tests compile**

Build is validated on-device — not runnable in CI for C tests. Verify with `git diff` that all renames are complete.

- [ ] **Step 4: Commit**

```bash
git add components/parasol/test/
git commit -m "test: rename all symbols in C unit tests"
```

---

### Task 15: Update Python test server

**Files:**
- Modify: `test_server/main.py`
- Modify: `test_server/test_main.py`

- [ ] **Step 1: Update test_server/main.py**

Apply these edits:
- `s/"components/{name:path}"/"/groups/{name:path}"/` — rename deprecated route
- `s/def old_component/def old_group/` — function rename
- `s/comp_id/group_id/g` — all variable renames
- `s/# Each top-level key is a component group./# Each top-level key is a group./` — comment fix
- Remove `@app.api_route("/components/{name:path}", methods=["GET", "POST"])` route entirely (or just rename the path)

- [ ] **Step 2: Update test_server/test_main.py**

- `s/\|components\/wifi\.json/\/groups\/wifi.json/` — line 72, old route test path
- `s/comp_id/group_id/g` — any remaining variable references (none expected)

- [ ] **Step 3: Run Python tests**

```bash
cd test_server && python -m pytest test_main.py -v
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add test_server/
git commit -m "test-server: rename comp_id→group_id, update deprecated route, fix comments"
```

---

### Task 16: Update JS unit tests

**Files:**
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Update test descriptions**

Apply `s/component/group/g` across the file — these are test description strings only (the variable names were already renamed in a prior change).

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: rename component→group in JS test descriptions"
```

---

### Task 17: Update docs

**Files:**
- Modify: `API_REFERENCE.md`
- Modify: `WS_PROTOCOL.md`
- Modify: `README.md`

- [ ] **Step 1: Rewrite API_REFERENCE.md**

Full rewrite to match the new API from the spec. Replace all `pwui_` → `prsl_`, `PWUI_` → `PRSL_`, `component` → `group`, `comp_id` → `group_id`, `commit_cb` → `save_cb`, `on_commit` → `on_save`, `on_load` → `on_get`, `on_apply` → `on_set`. Remove `## Component Registration` section, replace with `## Group Registration`. Update example code.

- [ ] **Step 2: Update WS_PROTOCOL.md**

`s/under a component/under a group/`, `s/component share/group share/`, `s/component object/group object/`, `s/component ID/group ID/` — prose-only changes.

- [ ] **Step 3: Update README.md**

`s/component/group/g`, `s/pico-settings/parasol/g`, `s/pwui/prsl/g` — project name and terminology updates.

- [ ] **Step 4: Update spec docs in `docs/superpowers/specs/`**

For each spec file under `docs/superpowers/specs/*.md`, apply: `s/pwui_/prsl_/g`, `s/PWUI_/PRSL_/g`, `s/pico-settings/parasol/g`, `s/component/group/g`. Review manually — `component` may have false positives in filenames/paths. The `2026-07-09-parasol-api-redesign.md` spec itself is already clean.

- [ ] **Step 5: Commit**

```bash
git add API_REFERENCE.md WS_PROTOCOL.md README.md docs/superpowers/specs/
git commit -m "docs: full rewrite for PRSL API, component→group, get/set/save"
```

---

### Task 18: Build and run full test suite

**Files:**
- No file changes — verification only

- [ ] **Step 1: Build minified JS**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run build
```

Expected: `app.min.js` generated without errors.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: unit tests pass, e2e tests pass.

- [ ] **Step 3: Verify no old names remain in source**

```bash
rg -l 'pwui_' components/parasol/src/ components/parasol/include/ test_server/ app.js index.html 2>/dev/null
```

Expected: no output (all `pwui_` references removed from live source).

- [ ] **Step 4: Commit if any build artifacts changed**

```bash
git add -A && git diff --cached --stat
git commit -m "build: final verification pass, regenerate assets"
```

---

### Task 19: Version bump

**Files:**
- Modify: `components/parasol/library.json`

- [ ] **Step 1: library.json already set to "1.0.0" in Task 10. Tag.**

```bash
git tag v1.0.0
git commit --allow-empty -m "release: v1.0.0 — PARASOL API redesign"
```
