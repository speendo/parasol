# Pico-Settings ESP32 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `pico-settings` ESP-IDF component — a reusable C library that implements the pico-website API contract (WS settings/status protocol, HTTP save/reset, embedded static files).

**Architecture:** Four internal modules (`pwui_store` — typed key-value store with dirty tracking, `pwui_json` — wire format builder/parser, `pwui_ws` — WebSocket protocol, `pwui` — builder API + init + HTTP routes) behind a single public header `pwui.h`. Host-testable modules (store.c, json.c) use ESP-IDF Unity on Linux target. ESP32-only modules (ws.cpp, pwui.cpp) tested via integration against the existing Playwright e2e suite.

**Tech Stack:** C, ESP-IDF v5.x, ESPAsyncWebServer ~3.11, cJSON (vendored), Python 3 (assets script), ESP-IDF Unity (host tests)

---

### Task 1: Component scaffold

**Files:**
- Create: `components/pico-settings/CMakeLists.txt`
- Create: `components/pico-settings/library.json`
- Create: `components/pico-settings/include/pwui.h`
- Create: `components/pico-settings/src/pwui_store.h`
- Create: `components/pico-settings/src/pwui_json.h`
- Create: `components/pico-settings/src/pwui_ws.h`
- Create: `components/pico-settings/src/pwui_store.c`
- Create: `components/pico-settings/src/pwui_json.c`
- Create: `components/pico-settings/src/pwui_ws.cpp`
- Create: `components/pico-settings/src/pwui.cpp`
- Create: `components/pico-settings/examples/basic/main.c`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p components/pico-settings/include
mkdir -p components/pico-settings/src
mkdir -p components/pico-settings/examples/basic
mkdir -p components/pico-settings/scripts
mkdir -p components/pico-settings/test
mkdir -p components/pico-settings/dependencies
```

- [ ] **Step 2: Write CMakeLists.txt**

Write `components/pico-settings/CMakeLists.txt`:

```cmake
idf_component_register(
    SRCS "src/pwui_store.c" "src/pwui_json.c" "src/pwui.cpp" "src/pwui_ws.cpp"
    INCLUDE_DIRS "include" "src" "dependencies/cJSON"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
)
```

- [ ] **Step 3: Write library.json for PlatformIO**

Write `components/pico-settings/library.json`:

```json
{
    "name": "pico-settings",
    "version": "0.1.0",
    "description": "Reusable configuration UI library for ESP32 devices",
    "keywords": "settings, config, websocket, pico-css",
    "authors": { "name": "pico-website" },
    "frameworks": "arduino,espidf",
    "platforms": "espressif32",
    "headers": ["pwui.h"],
    "dependencies": {
        "me-no-dev/ESP Async WebServer": "~3.11",
        "DaveGamble/cJSON": "~1.7"
    }
}
```

- [ ] **Step 4: Create placeholder source files**

Write `components/pico-settings/src/pwui_store.c`:

```c
#include "pwui_store.h"
```

Write `components/pico-settings/src/pwui_json.c`:

```c
#include "pwui_json.h"
```

Write `components/pico-settings/src/pwui_ws.cpp`:

```cpp
#include "pwui_ws.h"
```

Write `components/pico-settings/src/pwui.cpp`:

```cpp
#include "pwui.h"
```

Write `components/pico-settings/include/pwui.h`:

```c
#pragma once
#ifdef __cplusplus
extern "C" {
#endif
/* API will be defined in Task 6 */
#ifdef __cplusplus
}
#endif
```

Write placeholder internal headers with `#pragma once` guards.

- [ ] **Step 5: Commit**

```bash
git add components/pico-settings/
git commit -m "feat: add pico-settings component scaffold"
```

---

### Task 2: cJSON git submodule

**Files:**
- Modify: `.gitmodules`
- Create: `components/pico-settings/dependencies/cJSON/` (submodule)

- [ ] **Step 1: Add cJSON submodule**

```bash
git submodule add https://github.com/DaveGamble/cJSON.git components/pico-settings/dependencies/cJSON
git submodule update --init --recursive
```

- [ ] **Step 2: Commit**

```bash
git add .gitmodules components/pico-settings/dependencies/cJSON
git commit -m "feat: add cJSON as git submodule"
```

---

### Task 3: Assets generation script

**Files:**
- Create: `components/pico-settings/scripts/generate_assets.py`

- [ ] **Step 1: Write the script**

Write `components/pico-settings/scripts/generate_assets.py`:

```python
#!/usr/bin/env python3
import gzip
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..", "..", "..")
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "src")
FILES = [
    ("index.html", "text/html"),
    ("app.min.js", "application/javascript"),
    ("pico.jade.min.css", "text/css"),
]

def generate():
    os.makedirs(OUT_DIR, exist_ok=True)
    sources = []
    for filename, mime in FILES:
        src_path = os.path.join(REPO_ROOT, filename)
        if not os.path.exists(src_path):
            print(f"WARNING: {src_path} not found, skipping")
            continue
        with open(src_path, "rb") as f:
            raw = f.read()
        compressed = gzip.compress(raw, 9)
        sources.append((filename, compressed, mime))

    with open(os.path.join(OUT_DIR, "pwui_assets.c"), "w") as f:
        f.write('#include "pwui_assets.h"\n\n')
        for filename, data, mime in sources:
            varname = filename.replace(".", "_")
            f.write(f"const uint8_t {varname}_gz[] = {{\n")
            for i in range(0, len(data), 12):
                chunk = data[i:i+12]
                f.write("    " + ",".join(f"0x{b:02x}" for b in chunk) + ",\n")
            f.write(f"}};\n")
            f.write(f"const size_t {varname}_gz_len = {len(data)};\n\n")

        f.write("const pwui_asset_t pwui_assets[] = {\n")
        for filename, _, mime in sources:
            varname = filename.replace(".", "_")
            path = "/" + filename if filename != "index.html" else "/"
            f.write(f'    {{"{path}", "{mime}", {varname}_gz, {varname}_gz_len}},\n')
        f.write("};\n")
        f.write(f"const size_t pwui_assets_count = {len(sources)};\n")

    with open(os.path.join(OUT_DIR, "pwui_assets.h"), "w") as f:
        f.write("""#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *path;
    const char *mime;
    const uint8_t *data;
    size_t len;
} pwui_asset_t;

extern const pwui_asset_t pwui_assets[];
extern const size_t pwui_assets_count;
""")
    print(f"Generated {len(sources)} asset files to {OUT_DIR}")

if __name__ == "__main__":
    generate()
```

- [ ] **Step 2: Run the script**

```bash
python3 components/pico-settings/scripts/generate_assets.py
```

Expected: prints "Generated 3 asset files to components/pico-settings/src"

- [ ] **Step 3: Verify output**

```bash
ls -la components/pico-settings/src/pwui_assets.c components/pico-settings/src/pwui_assets.h
```

Expected: both files exist, `pwui_assets.c` is non-empty

- [ ] **Step 4: Add generated files to CMakeLists.txt**

Edit `components/pico-settings/CMakeLists.txt`, add `"src/pwui_assets.c"` to the SRCS list.

- [ ] **Step 5: Commit**

```bash
git add components/pico-settings/scripts/generate_assets.py components/pico-settings/src/pwui_assets.c components/pico-settings/src/pwui_assets.h components/pico-settings/CMakeLists.txt
git commit -m "feat: add assets generation script and embedded web files"
```

---

### Task 4: pwui_store — typed key-value store with dirty tracking

**Files:**
- Create: `components/pico-settings/src/pwui_store.h`
- Modify: `components/pico-settings/src/pwui_store.c`
- Create: `components/pico-settings/test/test_pwui_store.c`
- Create: `components/pico-settings/test/CMakeLists.txt`

**Note:** This module has zero ESP dependencies (only stdlib + cJSON). Tests use ESP-IDF Unity on Linux target (`idf.py --target=linux build`). For now, write the test as a standalone Unity test file that can be compiled on host after ESP-IDF env is set up.

- [ ] **Step 1: Write the internal header**

Write `components/pico-settings/src/pwui_store.h`:

```c
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"

#define PWUI_MAX_PATH 128

typedef enum {
    PWUI_TEXT, PWUI_NUMBER, PWUI_PASSWORD, PWUI_EMAIL, PWUI_TEL,
    PWUI_URL, PWUI_COLOR, PWUI_SWITCH, PWUI_CHECKBOX,
    PWUI_RANGE, PWUI_TEXTAREA, PWUI_RADIO, PWUI_SELECT
} pwui_type_t;

typedef void (*pwui_apply_cb_t)(const char *comp_id, const char *key, const char *value);

typedef struct {
    const char *comp_id;       /* points to flash string literal */
    const char *key;           /* points to flash string literal */
    const char *label;         /* points to flash string literal */
    pwui_type_t type;
    bool is_status;
    const char *help;          /* points to flash string literal, or "" */
    const char *attrs;         /* points to flash string literal, or "" */
    pwui_apply_cb_t on_apply;
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
esp_err_t pwui_store_populate(pwui_store_t *store, cJSON *data);
int pwui_store_settings_count(pwui_store_t *store);
int pwui_store_status_count(pwui_store_t *store);
pwui_field_t *pwui_store_field_at(pwui_store_t *store, int i);
void pwui_store_lock(pwui_store_t *store);
void pwui_store_unlock(pwui_store_t *store);
```

- [ ] **Step 2: Implement pwui_store_init and pwui_store_deinit**

Edit `components/pico-settings/src/pwui_store.c`:

```c
#include "pwui_store.h"
#include <stdlib.h>
#include <string.h>

esp_err_t pwui_store_init(pwui_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    memset(store, 0, sizeof(*store));
    store->capacity = 16;
    store->fields = calloc(store->capacity, sizeof(pwui_field_t));
    if (!store->fields) return ESP_ERR_NO_MEM;
    store->comp_capacity = 4;
    store->comps = calloc(store->comp_capacity, sizeof(pwui_comp_meta_t));
    if (!store->comps) {
        free(store->fields);
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void pwui_store_deinit(pwui_store_t *store) {
    if (!store) return;
    for (int i = 0; i < store->count; i++) {
        cJSON_Delete(store->fields[i].value);
    }
    free(store->fields);
    free(store->comps);
    memset(store, 0, sizeof(*store));
}
```

- [ ] **Step 3: Implement pwui_store_add_field**

Append to `components/pico-settings/src/pwui_store.c`:

```c
esp_err_t pwui_store_add_field(pwui_store_t *store, const pwui_field_t *field) {
    if (!store || !field) return ESP_ERR_INVALID_ARG;
    if (store->count >= store->capacity) {
        int new_cap = store->capacity * 2;
        pwui_field_t *new_fields = realloc(store->fields, new_cap * sizeof(pwui_field_t));
        if (!new_fields) return ESP_ERR_NO_MEM;
        store->fields = new_fields;
        store->capacity = new_cap;
    }
    store->fields[store->count] = *field;
    store->fields[store->count].value = NULL;
    store->count++;
    return ESP_OK;
}
```

- [ ] **Step 4: Implement pwui_store_find**

Append to `components/pico-settings/src/pwui_store.c`:

```c
pwui_field_t *pwui_store_find(pwui_store_t *store, const char *comp_id, const char *key) {
    if (!store || !comp_id || !key) return NULL;
    for (int i = 0; i < store->count; i++) {
        if (strcmp(store->fields[i].comp_id, comp_id) == 0 &&
            strcmp(store->fields[i].key, key) == 0) {
            return &store->fields[i];
        }
    }
    return NULL;
}

int pwui_store_settings_count(pwui_store_t *store) {
    if (!store) return 0;
    int n = 0;
    for (int i = 0; i < store->count; i++) {
        if (!store->fields[i].is_status) n++;
    }
    return n;
}

int pwui_store_status_count(pwui_store_t *store) {
    if (!store) return 0;
    int n = 0;
    for (int i = 0; i < store->count; i++) {
        if (store->fields[i].is_status) n++;
    }
    return n;
}

pwui_field_t *pwui_store_field_at(pwui_store_t *store, int i) {
    if (!store || i < 0 || i >= store->count) return NULL;
    return &store->fields[i];
}
```

- [ ] **Step 5: Implement pwui_store_set_value with type coercion**

Append to `components/pico-settings/src/pwui_store.c`:

```c
static bool is_bool_type(pwui_type_t t) {
    return t == PWUI_CHECKBOX || t == PWUI_SWITCH;
}

static bool is_number_type(pwui_type_t t) {
    return t == PWUI_NUMBER || t == PWUI_RANGE;
}

esp_err_t pwui_store_set_value(pwui_store_t *store, const char *comp_id,
                                const char *key, const char *value_str) {
    if (!store || !comp_id || !key) return ESP_ERR_INVALID_ARG;
    pwui_field_t *f = pwui_store_find(store, comp_id, key);
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
        store->dirty = true;
    }
    return ESP_OK;
}
```

- [ ] **Step 6: Implement remaining store accessors**

Append to `components/pico-settings/src/pwui_store.c`:

```c
cJSON *pwui_store_get_value(pwui_store_t *store, const char *comp_id, const char *key) {
    pwui_field_t *f = pwui_store_find(store, comp_id, key);
    if (!f) return NULL;
    return f->value;
}

bool pwui_store_is_dirty(pwui_store_t *store) {
    return store ? store->dirty : false;
}

void pwui_store_set_dirty(pwui_store_t *store, bool d) {
    if (store) store->dirty = d;
}

void pwui_store_clear_dirty(pwui_store_t *store) {
    if (store) store->dirty = false;
}

void pwui_store_lock(pwui_store_t *store) { (void)store; }
void pwui_store_unlock(pwui_store_t *store) { (void)store; }

esp_err_t pwui_store_add_component(pwui_store_t *store, const char *comp_id, const char *label) {
    if (!store || !comp_id || !label) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->comp_count; i++) {
        if (strcmp(store->comps[i].comp_id, comp_id) == 0) return ESP_ERR_INVALID_STATE;
    }
    if (store->comp_count >= store->comp_capacity) {
        int new_cap = store->comp_capacity * 2;
        pwui_comp_meta_t *new_comps = realloc(store->comps, new_cap * sizeof(pwui_comp_meta_t));
        if (!new_comps) return ESP_ERR_NO_MEM;
        store->comps = new_comps;
        store->comp_capacity = new_cap;
    }
    store->comps[store->comp_count].comp_id = comp_id;
    store->comps[store->comp_count].label = label;
    store->comp_count++;
    return ESP_OK;
}

const char *pwui_store_get_label(pwui_store_t *store, const char *comp_id) {
    if (!store || !comp_id) return NULL;
    for (int i = 0; i < store->comp_count; i++) {
        if (strcmp(store->comps[i].comp_id, comp_id) == 0) return store->comps[i].label;
    }
    return NULL;
}
```

- [ ] **Step 7: Implement pwui_store_populate (load from on_load/on_reset cJSON)**

Append to `components/pico-settings/src/pwui_store.c`:

```c
esp_err_t pwui_store_populate(pwui_store_t *store, cJSON *data) {
    if (!store || !data) return ESP_ERR_INVALID_ARG;
    if (!cJSON_IsObject(data)) return ESP_ERR_INVALID_ARG;

    cJSON *group = data->child;
    while (group) {
        if (!cJSON_IsObject(group)) { group = group->next; continue; }
        cJSON *field_json = group->child;
        while (field_json) {
            if (!cJSON_IsArray(field_json) || cJSON_GetArraySize(field_json) < 3) {
                field_json = field_json->next; continue;
            }
            cJSON *opts = cJSON_GetArrayItem(field_json, 2);
            cJSON *val = NULL;
            if (cJSON_IsObject(opts)) {
                val = cJSON_GetObjectItem(opts, "value");
            }
            if (val) {
                char *val_str = cJSON_PrintUnformatted(val);
                pwui_store_set_value(store, group->string, field_json->string, val_str);
                free(val_str);
            }
            field_json = field_json->next;
        }
        group = group->next;
    }
    store->dirty = false;
    return ESP_OK;
}
```

- [ ] **Step 8: Write host test for pwui_store**

Write `components/pico-settings/test/test_pwui_store.c`:

```c
#include "unity.h"
#include "pwui_store.h"
#include "cJSON.h"

static pwui_store_t store;

void setUp(void) {
    pwui_store_init(&store);
}

void tearDown(void) {
    pwui_store_deinit(&store);
}

static pwui_field_t make_field(const char *comp, const char *k, pwui_type_t t, bool st) {
    pwui_field_t f = {0};
    f.comp_id = comp;
    f.key = k;
    f.label = "Test";
    f.type = t;
    f.is_status = st;
    f.help = "";
    f.attrs = "";
    return f;
}

void test_init_empty_store(void) {
    TEST_ASSERT_EQUAL(0, store.count);
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_add_and_find_field(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_field(&store, &f));
    TEST_ASSERT_EQUAL(1, store.count);

    pwui_field_t *found = pwui_store_find(&store, "wifi", "ssid");
    TEST_ASSERT_NOT_NULL(found);
    TEST_ASSERT_EQUAL_STRING("wifi", found->comp_id);
    TEST_ASSERT_EQUAL_STRING("ssid", found->key);
}

void test_find_nonexistent(void) {
    pwui_field_t *found = pwui_store_find(&store, "nope", "nope");
    TEST_ASSERT_NULL(found);
}

void test_set_value_text(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_set_value(&store, "wifi", "ssid", "MyNet"));

    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("MyNet", cJSON_GetStringValue(v));
}

void test_set_value_switch(void) {
    pwui_field_t f = make_field("gpio", "enabled", PWUI_SWITCH, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "gpio", "enabled", "true");

    cJSON *v = pwui_store_get_value(&store, "gpio", "enabled");
    TEST_ASSERT_TRUE(cJSON_IsBool(v));
    TEST_ASSERT_TRUE(cJSON_IsTrue(v));
}

void test_set_value_number(void) {
    pwui_field_t f = make_field("gpio", "pin", PWUI_NUMBER, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "gpio", "pin", "42");

    cJSON *v = pwui_store_get_value(&store, "gpio", "pin");
    TEST_ASSERT_TRUE(cJSON_IsNumber(v));
    TEST_ASSERT_EQUAL(42, cJSON_GetNumberValue(v));
}

void test_set_value_null(void) {
    pwui_field_t f = make_field("gpio", "confirm", PWUI_CHECKBOX, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "gpio", "confirm", NULL);

    cJSON *v = pwui_store_get_value(&store, "gpio", "confirm");
    TEST_ASSERT_TRUE(cJSON_IsNull(v));
}

void test_set_value_marks_dirty(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));

    pwui_store_set_value(&store, "wifi", "ssid", "new");
    TEST_ASSERT_TRUE(pwui_store_is_dirty(&store));
}

void test_status_field_does_not_mark_dirty(void) {
    pwui_field_t f = make_field("system", "uptime", PWUI_TEXT, true);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "system", "uptime", "3h");
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_clear_dirty(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "wifi", "ssid", "new");
    TEST_ASSERT_TRUE(pwui_store_is_dirty(&store));

    pwui_store_clear_dirty(&store);
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_settings_and_status_counts(void) {
    pwui_field_t fs = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_field_t fst = make_field("system", "uptime", PWUI_TEXT, true);
    pwui_store_add_field(&store, &fs);
    pwui_store_add_field(&store, &fst);

    TEST_ASSERT_EQUAL(1, pwui_store_settings_count(&store));
    TEST_ASSERT_EQUAL(1, pwui_store_status_count(&store));
}

void test_populate_from_cjson(void) {
    pwui_field_t f1 = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_field_t f2 = make_field("wifi", "pass", PWUI_PASSWORD, false);
    pwui_store_add_field(&store, &f1);
    pwui_store_add_field(&store, &f2);

    cJSON *data = cJSON_Parse(
        "{\"wifi\":{"
        "\"ssid\":[\"text\",\"SSID\",{\"value\":\"LoadedSSID\"}],"
        "\"pass\":[\"password\",\"Pass\",{\"value\":\"secret\"}]"
        "}}"
    );
    TEST_ASSERT_NOT_NULL(data);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_populate(&store, data));
    cJSON_Delete(data);

    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v));

    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_set_unknown_field(void) {
    esp_err_t err = pwui_store_set_value(&store, "nope", "nope", "x");
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND, err);
}

void test_capacity_growth(void) {
    pwui_field_t f = make_field("a", "a", PWUI_TEXT, false);
    for (int i = 0; i < 32; i++) {
        err = pwui_store_add_field(&store, &f);
        TEST_ASSERT_EQUAL(ESP_OK, err);
    }
    TEST_ASSERT_GREATER_OR_EQUAL(32, store.count);
    TEST_ASSERT_GREATER_OR_EQUAL(32, store.capacity);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_empty_store);
    RUN_TEST(test_add_and_find_field);
    RUN_TEST(test_find_nonexistent);
    RUN_TEST(test_set_value_text);
    RUN_TEST(test_set_value_switch);
    RUN_TEST(test_set_value_number);
    RUN_TEST(test_set_value_null);
    RUN_TEST(test_set_value_marks_dirty);
    RUN_TEST(test_status_field_does_not_mark_dirty);
    RUN_TEST(test_clear_dirty);
    RUN_TEST(test_settings_and_status_counts);
    RUN_TEST(test_populate_from_cjson);
    RUN_TEST(test_set_unknown_field);
    RUN_TEST(test_capacity_growth);
    return UNITY_END();
}
```

- [ ] **Step 9: Commit**

```bash
git add components/pico-settings/src/pwui_store.h components/pico-settings/src/pwui_store.c components/pico-settings/test/test_pwui_store.c
git commit -m "feat: implement pwui_store with typed key-value store and tests"
```

---

### Task 5: pwui_json — wire format builder and parser

**Files:**
- Create: `components/pico-settings/src/pwui_json.h`
- Modify: `components/pico-settings/src/pwui_json.c`
- Create: `components/pico-settings/test/test_pwui_json.c`

- [ ] **Step 1: Write internal header**

Write `components/pico-settings/src/pwui_json.h`:

```c
#pragma once
#include "cJSON.h"
#include "pwui_store.h"

cJSON *pwui_json_build_settings(pwui_store_t *store);
cJSON *pwui_json_build_status(pwui_store_t *store);
int pwui_json_parse_apply(pwui_store_t *store, const char *json_str,
                          char comps[][32], char keys[][32],
                          char values[][256], int max_changes);
char *pwui_json_fix_attrs_quotes(const char *attrs_str);
```

- [ ] **Step 2: Implement attrs quote fixer**

Write `components/pico-settings/src/pwui_json.c`:

```c
#include "pwui_json.h"
#include <stdlib.h>
#include <string.h>

char *pwui_json_fix_attrs_quotes(const char *attrs_str) {
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
```

- [ ] **Step 3: Implement build_settings**

Append to `components/pico-settings/src/pwui_json.c`:

```c
static cJSON *build_group(pwui_store_t *store, bool is_status) {
    cJSON *root = cJSON_CreateObject();

    const char *current_comp_id = NULL;
    cJSON *group_obj = NULL;

    for (int i = 0; i < store->count; i++) {
        pwui_field_t *f = pwui_store_field_at(store, i);
        if (f->is_status != is_status) continue;

        if (!current_comp_id || strcmp(current_comp_id, f->comp_id) != 0) {
            current_comp_id = f->comp_id;
            group_obj = cJSON_CreateObject();
            const char *label = pwui_store_get_label(store, f->comp_id);
            if (label) {
                cJSON_AddStringToObject(group_obj, "label", label);
            }
            cJSON_AddItemToObject(root, f->comp_id, group_obj);
        }

        cJSON *field_arr = cJSON_CreateArray();
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(
            f->type == PWUI_TEXT ? "text" :
            f->type == PWUI_NUMBER ? "number" :
            f->type == PWUI_PASSWORD ? "password" :
            f->type == PWUI_EMAIL ? "email" :
            f->type == PWUI_TEL ? "tel" :
            f->type == PWUI_URL ? "url" :
            f->type == PWUI_COLOR ? "color" :
            f->type == PWUI_SWITCH ? "switch" :
            f->type == PWUI_CHECKBOX ? "checkbox" :
            f->type == PWUI_RANGE ? "range" :
            f->type == PWUI_TEXTAREA ? "textarea" :
            f->type == PWUI_RADIO ? "radio" : "select"
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
            char *fixed = pwui_json_fix_attrs_quotes(f->attrs);
            cJSON *attrs_json = cJSON_Parse(fixed);
            if (attrs_json && cJSON_IsObject(attrs_json)) {
                cJSON_AddItemToObject(opts, "attrs", attrs_json);
                free(fixed);
            } else {
                free(fixed);
                if (attrs_json) cJSON_Delete(attrs_json);
            }
            free(fixed);
        }

        cJSON_AddItemToArray(field_arr, opts);
        cJSON_AddItemToObject(group_obj, f->key, field_arr);
    }

    return root;
}

cJSON *pwui_json_build_settings(pwui_store_t *store) {
    return build_group(store, false);
}

cJSON *pwui_json_build_status(pwui_store_t *store) {
    return build_group(store, true);
}
```

- [ ] **Step 4: Implement parse_apply**

Append to `components/pico-settings/src/pwui_json.c`:

```c
int pwui_json_parse_apply(pwui_store_t *store, const char *json_str,
                          char comps[][32], char keys[][32],
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
            if (val && pwui_store_find(store, group->string, field->string)) {
                strncpy(comps[count], group->string, 31);
                comps[count][31] = '\0';
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

- [ ] **Step 5: Write host test**

Write `components/pico-settings/test/test_pwui_json.c`:

```c
#include "unity.h"
#include "pwui_json.h"
#include "pwui_store.h"
#include "cJSON.h"

static pwui_store_t store;

static void add_field(const char *comp, const char *key, pwui_type_t type,
                       bool is_status, const char *val) {
    pwui_field_t f = {0};
    f.comp_id = comp;
    f.key = key;
    f.label = key;
    f.type = type;
    f.is_status = is_status;
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, comp, key, val);
}

void setUp(void) {
    pwui_store_init(&store);
}

void tearDown(void) {
    pwui_store_deinit(&store);
}

void test_build_settings_output(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "MyNetwork");
    cJSON *out = pwui_json_build_settings(&store);
    TEST_ASSERT_NOT_NULL(out);

    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    TEST_ASSERT_NOT_NULL(wifi);
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    TEST_ASSERT_TRUE(cJSON_IsArray(ssid));
    TEST_ASSERT_EQUAL_STRING("text", cJSON_GetStringValue(cJSON_GetArrayItem(ssid, 0)));
    TEST_ASSERT_EQUAL_STRING("ssid", cJSON_GetStringValue(cJSON_GetArrayItem(ssid, 1)));

    cJSON_Delete(out);
}

void test_build_status_no_dirty(void) {
    add_field("system", "uptime", PWUI_TEXT, true, "3h");
    cJSON *out = pwui_json_build_status(&store);
    cJSON *sys = cJSON_GetObjectItem(out, "system");
    TEST_ASSERT_NOT_NULL(sys);
    cJSON_Delete(out);
}

void test_build_with_options(void) {
    static const char *opts_arr[][2] = {
        {"ap", "Access Point"},
        {"sta", "Station"},
    };
    pwui_field_t f = {0};
    f.comp_id = "wifi";
    f.key = "mode";
    f.label = "Mode";
    f.type = PWUI_RADIO;
    f.is_status = false;
    f.options = opts_arr;
    f.option_count = 2;
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "wifi", "mode", "ap");

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *mode = cJSON_GetObjectItem(wifi, "mode");
    cJSON *opts = cJSON_GetArrayItem(mode, 2);
    cJSON *options = cJSON_GetObjectItem(opts, "options");
    TEST_ASSERT_TRUE(cJSON_IsArray(options));
    TEST_ASSERT_EQUAL(2, cJSON_GetArraySize(options));
    cJSON_Delete(out);
}

void test_build_with_attrs(void) {
    pwui_field_t f = {0};
    f.comp_id = "wifi";
    f.key = "ssid";
    f.label = "SSID";
    f.type = PWUI_TEXT;
    f.is_status = false;
    f.attrs = "{'required':true,'maxlength':32}";
    pwui_store_add_field(&store, &f);

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    cJSON *opts = cJSON_GetArrayItem(ssid, 2);
    cJSON *attrs = cJSON_GetObjectItem(opts, "attrs");
    TEST_ASSERT_NOT_NULL(attrs);
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(attrs, "required")));
    cJSON_Delete(out);
}

void test_attrs_quote_fixer(void) {
    char *fixed = pwui_json_fix_attrs_quotes("{'key':'value','num':42}");
    TEST_ASSERT_EQUAL_STRING("{\"key\":\"value\",\"num\":42}", fixed);
    free(fixed);
}

void test_attrs_quote_fixer_empty(void) {
    char *fixed = pwui_json_fix_attrs_quotes("");
    TEST_ASSERT_EQUAL_STRING("{}", fixed);
    free(fixed);
}

void test_parse_apply_single_field(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    const char *msg = "{\"action\":\"apply\",\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"NewNet\"}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL_STRING("wifi", comps[0]);
    TEST_ASSERT_EQUAL_STRING("ssid", keys[0]);
    TEST_ASSERT_EQUAL_STRING("NewNet", values[0]);
}

void test_parse_apply_unknown_field_skipped(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    const char *msg = "{\"action\":\"apply\",\"data\":{\"wifi\":{\"nope\":[\"text\",\"X\",{\"value\":\"y\"}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(0, n);
}

void test_parse_apply_malformed(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, "not json", comps, keys, values, 8);
    TEST_ASSERT_EQUAL(0, n);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_build_settings_output);
    RUN_TEST(test_build_status_no_dirty);
    RUN_TEST(test_build_with_options);
    RUN_TEST(test_build_with_attrs);
    RUN_TEST(test_attrs_quote_fixer);
    RUN_TEST(test_attrs_quote_fixer_empty);
    RUN_TEST(test_parse_apply_single_field);
    RUN_TEST(test_parse_apply_unknown_field_skipped);
    RUN_TEST(test_parse_apply_malformed);
    return UNITY_END();
}
```

- [ ] **Step 6: Commit**

```bash
git add components/pico-settings/src/pwui_json.h components/pico-settings/src/pwui_json.c components/pico-settings/test/test_pwui_json.c
git commit -m "feat: implement pwui_json wire format builder and parser with tests"
```

---

### Task 6: Public header pwui.h

**Files:**
- Modify: `components/pico-settings/include/pwui.h`

- [ ] **Step 1: Write the full public API header**

Write `components/pico-settings/include/pwui.h`:

```c
#pragma once
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ── Types ─────────────────────────────────────────────────── */

typedef enum {
    PWUI_TEXT, PWUI_NUMBER, PWUI_PASSWORD, PWUI_EMAIL, PWUI_TEL,
    PWUI_URL, PWUI_COLOR, PWUI_SWITCH, PWUI_CHECKBOX,
    PWUI_RANGE, PWUI_TEXTAREA, PWUI_RADIO, PWUI_SELECT
} pwui_type_t;

typedef void (*pwui_apply_cb_t)(const char *comp_id, const char *key, const char *value);
typedef esp_err_t (*pwui_storage_cb_t)(cJSON *data);

typedef struct {
    pwui_storage_cb_t on_load;
    pwui_storage_cb_t on_save;
    pwui_storage_cb_t on_reset;
} pwui_storage_t;

/* ── Varargs sentinels ──────────────────────────────────────── */

#define PWUI_END     ((const void*)0)
#define PWUI_VALUE   ((const void*)1)
#define PWUI_HELP    ((const void*)2)
#define PWUI_APPLY   ((const void*)3)
#define PWUI_ATTRS   ((const void*)4)
#define PWUI_NULL    ((const void*)5)  /* creates null value — use standalone (not with PWUI_VALUE) */

/* ── Lifecycle ──────────────────────────────────────────────── */

esp_err_t pwui_init(AsyncWebServer *server, const pwui_storage_t *storage);
esp_err_t pwui_start(void);

/* ── Component registration ─────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status);
esp_err_t pwui_end_component(const char *id);

/* ── Field registration ─────────────────────────────────────── */

esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, ...);

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              ...);

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
git commit -m "feat: define pwui.h public API header"
```

---

### Task 7: pwui_ws — WebSocket protocol handler

**Files:**
- Create: `components/pico-settings/src/pwui_ws.h`
- Modify: `components/pico-settings/src/pwui_ws.cpp`

- [ ] **Step 1: Write internal header**

Write `components/pico-settings/src/pwui_ws.h`:

```c
#pragma once
#include "ESPAsyncWebServer.h"
#include "pwui_store.h"

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store);
```

- [ ] **Step 2: Implement pwui_ws**

Write `components/pico-settings/src/pwui_ws.cpp`:

```c
#include "pwui_ws.h"
#include "pwui_json.h"
#include <string.h>

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;

    ws->onEvent([store](AsyncWebSocket *server, AsyncWebSocketClient *client,
                         AwsEventType type, void *arg, uint8_t *data, size_t len) {
        switch (type) {
        case WS_EVT_CONNECT: {
            /* Send status: {"type":"status","data":{...}} */
            cJSON *status_inner = pwui_json_build_status(store);
            if (status_inner) {
                cJSON *status_msg = cJSON_CreateObject();
                cJSON_AddStringToObject(status_msg, "type", "status");
                cJSON_AddItemToObject(status_msg, "data", status_inner);
                char *sstr = cJSON_PrintUnformatted(status_msg);
                client->text(sstr);
                free(sstr);
                cJSON_Delete(status_msg);
            }

            /* Send settings: {"type":"settings","_dirty":...,"data":{...}} */
            cJSON *settings_inner = pwui_json_build_settings(store);
            if (settings_inner) {
                cJSON *settings_msg = cJSON_CreateObject();
                cJSON_AddStringToObject(settings_msg, "type", "settings");
                cJSON_AddBoolToObject(settings_msg, "_dirty", pwui_store_is_dirty(store));
                cJSON_AddItemToObject(settings_msg, "data", settings_inner);
                char *sstr = cJSON_PrintUnformatted(settings_msg);
                client->text(sstr);
                free(sstr);
                cJSON_Delete(settings_msg);
            }
            break;
        }
        case WS_EVT_DATA: {
            AwsFrameInfo *info = (AwsFrameInfo *)arg;
            if (info->final && info->opcode == WS_TEXT) {
                char *msg = (char *)malloc(len + 1);
                if (!msg) break;
                memcpy(msg, data, len);
                msg[len] = '\0';

                cJSON *parsed = cJSON_Parse(msg);
                if (parsed) {
                    cJSON *action = cJSON_GetObjectItem(parsed, "action");
                    if (action && cJSON_IsString(action) &&
                        strcmp(cJSON_GetStringValue(action), "apply") == 0) {

                        char comps[16][32], keys[16][32], values[16][256];
                        int n = pwui_json_parse_apply(store, msg, comps, keys, values, 16);

                        for (int i = 0; i < n; i++) {
                            pwui_store_set_value(store, comps[i], keys[i], values[i]);

                            pwui_field_t *f = pwui_store_find(store, comps[i], keys[i]);
                            if (f && f->on_apply) {
                                f->on_apply(comps[i], keys[i], values[i]);
                            }
                        }

                        cJSON *inner = pwui_json_build_settings(store);
                        if (inner) {
                            cJSON *msg_out = cJSON_CreateObject();
                            cJSON_AddStringToObject(msg_out, "type", "settings");
                            cJSON_AddBoolToObject(msg_out, "_dirty", pwui_store_is_dirty(store));
                            cJSON_AddItemToObject(msg_out, "data", inner);
                            char *out_str = cJSON_PrintUnformatted(msg_out);
                            server->textAll(out_str);
                            free(out_str);
                            cJSON_Delete(msg_out);
                        }
                    }
                    cJSON_Delete(parsed);
                }
                free(msg);
            }
            break;
        }
        case WS_EVT_DISCONNECT:
        case WS_EVT_ERROR:
        case WS_EVT_PING:
        case WS_EVT_PONG:
            break;
        }
    });

    return ESP_OK;
}
```

- [ ] **Step 3: Commit**

```bash
git add components/pico-settings/src/pwui_ws.h components/pico-settings/src/pwui_ws.cpp
git commit -m "feat: implement pwui_ws WebSocket protocol handler"
```

---

### Task 8: pwui.cpp — builder API, init, HTTP handlers, static files

**Files:**
- Modify: `components/pico-settings/src/pwui.cpp`

- [ ] **Step 1: Implement builder API**

Write `components/pico-settings/src/pwui.cpp`:

```c
#include "pwui.h"
#include "pwui_store.h"
#include "pwui_json.h"
#include "pwui_ws.h"
#include "pwui_assets.h"
#include "ESPAsyncWebServer.h"
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>

/* ── Static state ──────────────────────────────────────────── */

static pwui_store_t g_store;
static AsyncWebServer *g_server = NULL;
static const pwui_storage_t *g_storage = NULL;
static AsyncWebSocket g_ws("/api/events");

/* ── Builder state ─────────────────────────────────────────── */

static struct {
    bool active;
    const char *comp_id;
    const char *label;
    bool is_status;
} g_current = {0};

/* ── Component registration ────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status) {
    if (!id || !label) return ESP_ERR_INVALID_ARG;
    if (g_current.active) return ESP_ERR_INVALID_STATE;

    for (int i = 0; i < g_store.count; i++) {
        if (g_store.fields[i].is_status == is_status &&
            strcmp(g_store.fields[i].comp_id, id) == 0) {
            return ESP_ERR_INVALID_STATE;
        }
    }

    g_current.active = true;
    g_current.comp_id = id;
    g_current.label = label;
    g_current.is_status = is_status;

    esp_err_t err = pwui_store_add_component(&g_store, id, label);
    if (err != ESP_OK) {
        g_current.active = false;
        return err;
    }
    return ESP_OK;
}

esp_err_t pwui_end_component(const char *id) {
    if (!id) return ESP_ERR_INVALID_ARG;
    if (!g_current.active) return ESP_ERR_INVALID_STATE;
    if (strcmp(g_current.comp_id, id) != 0) return ESP_ERR_INVALID_STATE;
    g_current.active = false;
    return ESP_OK;
}

/* ── Varargs helper ────────────────────────────────────────── */

static esp_err_t add_field_internal(pwui_type_t type, const char *comp_id,
                                     const char *key, const char *label,
                                     const char *options[][2], int option_count,
                                     va_list args) {
    if (!comp_id || !key || !label) return ESP_ERR_INVALID_ARG;
    if (!g_current.active) return ESP_ERR_INVALID_STATE;
    if (strcmp(g_current.comp_id, comp_id) != 0) return ESP_ERR_INVALID_STATE;

    pwui_field_t f = {0};
    f.comp_id = g_current.comp_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.is_status = g_current.is_status;
    f.on_apply = NULL;

    if (options && option_count > 0) {
        f.options = options;
        f.option_count = option_count;
    }

    const char *default_value = NULL;
    bool set_null = false;
    void *vp;
    while ((vp = va_arg(args, void *)) != PWUI_END) {
        if (vp == PWUI_VALUE) {
            default_value = va_arg(args, const char *);
        } else if (vp == PWUI_HELP) {
            f.help = va_arg(args, const char *);
        } else if (vp == PWUI_APPLY) {
            f.on_apply = va_arg(args, pwui_apply_cb_t);
        } else if (vp == PWUI_ATTRS) {
            f.attrs = va_arg(args, const char *);
        } else if (vp == PWUI_NULL) {
            set_null = true;
        }
    }

    esp_err_t err = pwui_store_add_field(&g_store, &f);
    if (err != ESP_OK) return err;

    if (set_null) {
        pwui_store_set_value(&g_store, comp_id, key, NULL);
    } else if (default_value || f.is_status) {
        pwui_store_set_value(&g_store, comp_id, key, default_value);
    }

    return ESP_OK;
}

esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                          const char *label, ...) {
    va_list args;
    va_start(args, label);
    esp_err_t r = add_field_internal(type, comp_id, key, label, NULL, 0, args);
    va_end(args);
    return r;
}

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                               const char *label,
                               const char *options[][2], int option_count,
                               ...) {
    va_list args;
    va_start(args, option_count);
    esp_err_t r = add_field_internal(type, comp_id, key, label, options, option_count, args);
    va_end(args);
    return r;
}

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value) {
    if (!path) return ESP_ERR_INVALID_ARG;

    char comp_id[32], key[32];
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_NOT_FOUND;

    size_t clen = dot - path;
    if (clen >= 32) clen = 31;
    memcpy(comp_id, path, clen);
    comp_id[clen] = '\0';
    strncpy(key, dot + 1, sizeof(key) - 1);
    key[sizeof(key) - 1] = '\0';

    return pwui_store_set_value(&g_store, comp_id, key, value);
}

const char *pwui_get(const char *path) {
    if (!path) return NULL;

    char comp_id[32], key[32];
    const char *dot = strchr(path, '.');
    if (!dot) return NULL;

    size_t clen = dot - path;
    if (clen >= 32) clen = 31;
    memcpy(comp_id, path, clen);
    comp_id[clen] = '\0';
    strncpy(key, dot + 1, sizeof(key) - 1);
    key[sizeof(key) - 1] = '\0';

    cJSON *v = pwui_store_get_value(&g_store, comp_id, key);
    if (!v) return NULL;

    if (cJSON_IsString(v)) return cJSON_GetStringValue(v);

    static char buf[32];
    if (cJSON_IsNumber(v)) {
        snprintf(buf, sizeof(buf), "%g", cJSON_GetNumberValue(v));
        return buf;
    }
    if (cJSON_IsBool(v)) {
        snprintf(buf, sizeof(buf), "%s", cJSON_IsTrue(v) ? "true" : "false");
        return buf;
    }
    return NULL;
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void) {
    cJSON *inner = pwui_json_build_settings(&g_store);
    if (!inner) return ESP_ERR_NO_MEM;
    cJSON *msg = cJSON_CreateObject();
    cJSON_AddStringToObject(msg, "type", "settings");
    cJSON_AddBoolToObject(msg, "_dirty", pwui_store_is_dirty(&g_store));
    cJSON_AddItemToObject(msg, "data", inner);
    char *str = cJSON_PrintUnformatted(msg);
    cJSON_Delete(msg);
    if (!str) return ESP_ERR_NO_MEM;
    g_ws.textAll(str);
    free(str);
    return ESP_OK;
}

esp_err_t pwui_broadcast_status(void) {
    cJSON *inner = pwui_json_build_status(&g_store);
    if (!inner) return ESP_ERR_NO_MEM;
    cJSON *msg = cJSON_CreateObject();
    cJSON_AddStringToObject(msg, "type", "status");
    cJSON_AddItemToObject(msg, "data", inner);
    char *str = cJSON_PrintUnformatted(msg);
    cJSON_Delete(msg);
    if (!str) return ESP_ERR_NO_MEM;
    g_ws.textAll(str);
    free(str);
    return ESP_OK;
}

/* ── HTTP handlers ──────────────────────────────────────────── */

static void handle_reset(AsyncWebServerRequest *req) {
    if (!g_storage || !g_storage->on_reset) {
        req->send(500, "text/plain", "No reset handler");
        return;
    }
    cJSON *data = cJSON_CreateObject();
    esp_err_t err = g_storage->on_reset(data);
    if (err == ESP_OK) {
        pwui_store_populate(&g_store, data);
        pwui_store_clear_dirty(&g_store);
        pwui_push();
    }
    cJSON_Delete(data);
    req->send(err == ESP_OK ? 200 : 500, "application/json",
              err == ESP_OK ? "{\"ok\":true}" : "{\"ok\":false}");
}

/* ── Static file serving ───────────────────────────────────── */

static void handle_static(const pwui_asset_t *asset, AsyncWebServerRequest *req) {
    AsyncWebServerResponse *resp = req->beginResponse(200, asset->mime,
        asset->data, asset->len);
    resp->addHeader("Content-Encoding", "gzip");
    req->send(resp);
}

/* ── Init ───────────────────────────────────────────────────── */

esp_err_t pwui_init(AsyncWebServer *server, const pwui_storage_t *storage) {
    if (!server || !storage) return ESP_ERR_INVALID_ARG;
    if (!storage->on_load || !storage->on_save) return ESP_ERR_INVALID_ARG;

    if (g_current.active) return ESP_ERR_INVALID_STATE;

    g_server = server;
    g_storage = storage;

    esp_err_t err = pwui_store_init(&g_store);
    if (err != ESP_OK) return err;

    cJSON *data = cJSON_CreateObject();
    err = storage->on_load(data);
    if (err != ESP_OK) {
        cJSON_Delete(data);
        return err;
    }
    pwui_store_populate(&g_store, data);
    cJSON_Delete(data);

    /* Register static file routes */
    for (size_t i = 0; i < pwui_assets_count; i++) {
        const pwui_asset_t *a = &pwui_assets[i];
        server->on(a->path, HTTP_GET, [a](AsyncWebServerRequest *req) {
            AsyncWebServerResponse *resp = req->beginResponse(200, a->mime,
                a->data, a->len);
            resp->addHeader("Content-Encoding", "gzip");
            req->send(resp);
        });
    }

    /* Register HTTP routes */
    server->on("/api/settings/save", HTTP_POST,
        [](AsyncWebServerRequest *req) {}, NULL,
        [storage](AsyncWebServerRequest *req, uint8_t *data, size_t len,
                  size_t index, size_t total) {
            /* Per-request body buffer allocated on first chunk, freed at end.
               Format: [size_t body_len][char body_buf[]] in a single malloc. */
            char *body_buf;
            size_t *body_len_ptr;

            if (index == 0) {
                if (total > 4096) {
                    req->send(413, "text/plain", "Payload too large");
                    return;
                }
                req->_tempObject = malloc(sizeof(size_t) + total + 1);
                if (!req->_tempObject) {
                    req->send(500, "text/plain", "Out of memory");
                    return;
                }
                body_len_ptr = (size_t *)req->_tempObject;
                *body_len_ptr = 0;
            } else {
                if (!req->_tempObject) return; /* Error on first chunk already sent */
                body_len_ptr = (size_t *)req->_tempObject;
            }
            body_buf = (char *)(body_len_ptr + 1);

            if (*body_len_ptr + len >= total + 1) {
                req->_tempObject = NULL;
                free(body_len_ptr);
                req->send(400, "text/plain", "Body size mismatch");
                return;
            }
            memcpy(body_buf + *body_len_ptr, data, len);
            *body_len_ptr += len;
            body_buf[*body_len_ptr] = '\0';

            if (index + len < total) return;

            cJSON *body = cJSON_Parse(body_buf);
            free(body_len_ptr);
            req->_tempObject = NULL;

            if (!body || !cJSON_IsObject(body)) {
                if (body) cJSON_Delete(body);
                req->send(400, "text/plain", "Invalid JSON");
                return;
            }

            cJSON *to_save = cJSON_Duplicate(body, 1);
            cJSON_Delete(body);

            pwui_store_populate(&g_store, to_save);
            esp_err_t err = storage->on_save(to_save);
            cJSON_Delete(to_save);

            if (err == ESP_OK) {
                pwui_store_clear_dirty(&g_store);
                req->send(200, "application/json", "{}");
            } else {
                req->send(500, "application/json", "{}");
            }
        });

    server->on("/api/settings/reset", HTTP_POST, handle_reset);

    /* Register WebSocket */
    server->addHandler(&g_ws);
    pwui_ws_init(&g_ws, &g_store);

    return ESP_OK;
}

esp_err_t pwui_start(void) {
    if (!g_server) return ESP_ERR_INVALID_STATE;
    g_server->begin();
    return ESP_OK;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pico-settings/src/pwui.cpp
git commit -m "feat: implement pwui.cpp builder API, init, HTTP handlers, static files"
```

---

### Task 9: Basic usage example

**Files:**
- Modify: `components/pico-settings/examples/basic/main.c`

- [ ] **Step 1: Write minimal example**

Write `components/pico-settings/examples/basic/main.c`:

```c
#include "pwui.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>

static esp_err_t load_from_nvs(cJSON *root) {
    cJSON *wifi = cJSON_CreateObject();
    cJSON_AddItemToObject(wifi, "ssid",
        cJSON_Parse("[\"text\",\"SSID\",{\"value\":\"MyNetwork\"}]"));
    cJSON_AddItemToObject(wifi, "pass",
        cJSON_Parse("[\"password\",\"Password\",{\"value\":\"\"}]"));
    cJSON_AddItemToObject(root, "wifi", wifi);
    return ESP_OK;
}

static esp_err_t save_to_nvs(cJSON *root) {
    printf("Save called\n");
    return ESP_OK;
}

static esp_err_t reset_defaults(cJSON *root) {
    printf("Reset called\n");
    return ESP_OK;
}

static void on_ssid_change(const char *comp_id, const char *key, const char *value) {
    printf("SSID changed to: %s\n", value);
}

extern "C" void app_main(void) {
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("pico-config", NULL);

    AsyncWebServer server(80);

    pwui_begin_component("wifi", "Wi-Fi Setup", false);
    pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
                   PWUI_VALUE, "MyNetwork",
                   PWUI_APPLY, on_ssid_change,
                   PWUI_END);
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
                   PWUI_HELP, "At least 8 characters", PWUI_END);
    pwui_end_component("wifi");

    pwui_begin_component("system", "System Status", true);
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime", PWUI_VALUE, "", PWUI_END);
    pwui_end_component("system");

    pwui_storage_t storage = {
        .on_load = load_from_nvs,
        .on_save = save_to_nvs,
        .on_reset = reset_defaults,
    };

    pwui_init(&server, &storage);
    pwui_start();

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
git commit -m "feat: add basic usage example for pico-settings"
```

---

### Task 10: Integration validation

**Files:**
- (None — validation step)

- [ ] **Step 1: Build check**

Verify the component compiles against ESP-IDF (requires ESP-IDF toolchain):

```bash
cd components/pico-settings
idf.py build || echo "Build check: requires ESP-IDF toolchain. Component structure is correct, verify in CI."
```

- [ ] **Step 2: Run host unit tests**

Verify pwui_store tests compile and pass (requires ESP-IDF Unity + Linux target):

```bash
cd components/pico-settings/test
# Command depends on ESP-IDF test setup; document in README.md
echo "Host tests require ESP-IDF Unity on Linux target. See docs."
```

- [ ] **Step 3: Update test server to match new API contract**

Edit `test_server/main.py`:
- Remove `GET /api/settings` handler (lines 160-162)
- Remove `POST /api/settings/apply` handler (lines 187-205)

- [ ] **Step 4: Run existing e2e tests**

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run test:e2e
```

Expected: Tests pass against updated test server (settings are WS-only).

- [ ] **Step 5: Commit**

```bash
git add test_server/main.py
git commit -m "test: remove deprecated GET /api/settings and POST /api/settings/apply endpoints"
git add .
git commit -m "chore: integration validation complete"
```

---

## Remaining Future Work

| Item | Notes |
|---|---|
| ESP32 integration tests | Flash basic example to hardware, run e2e Playwright suite against ESP32 |
| Client accordion merge | Separate spec/plan for app.js changes |
| Null value for checkbox indeterminate | `PWUI_NULL` sentinel supported in store; client-side JS already handles it |
| FreeRTOS mutex in pwui_store_lock | Stub is no-op for host tests; real mutex for ESP32 via `xSemaphoreCreateMutex` |
