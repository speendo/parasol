# Pico-Settings Backend — Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the pico-settings ESP-IDF component through three phases — standalone host tests (C logic), ESP-IDF Linux target (compile + runtime), and FlushFM-2.0 integration (real hardware). Each phase adds confidence before the next.

**Key insight:** The FlushFM-2.0 project (sibling repo) has 16 settings across 5 components, ESPAsyncWebServer via ESPUI, NVS-backed dirty tracking, and an `ISystemComponent` settings API — everything needed to stress-test pico-settings in real conditions.

---

## Phase 0: Prerequisites

Before testing, two gaps must be closed.

### P0-1 Fix `pwui_store_add_component` duplicate check

**Bug:** The design spec (D7) says the same component ID may exist in both settings AND status registries (e.g., "WiFi" for settings + "WiFi" for signal strength status). But `pwui_store_add_component` rejects any duplicate comp_id regardless of type.

**Fix:** Change the duplicate check to return `ESP_OK` (no-op) when the same comp_id and label already exist. The field-level check in `pwui_begin_component` already prevents same-type duplicates.

**Files:** `components/pico-settings/src/pwui_store.c`

- [ ] **Step 1:** Change `pwui_store_add_component` duplicate detection from `return ESP_ERR_INVALID_STATE` to `return ESP_OK` when `strcmp(store->comps[i].label, label) == 0` (same comp_id + same label = no-op). Only error if same ID with different label.
- [ ] **Step 2:** Commit: `fix: allow same comp_id across settings/status registries (D7)`

### P0-2 Add client-side Reset button

**Scope:** The C backend already implements `POST /api/settings/reset` (`handle_reset` in `pwui.cpp`). The test server already has it. The client needs a button.

**Files:** `app.js`, `index.html`

- [ ] **Step 1:** Add a Reset button in `<footer>` next to the Save button.
- [ ] **Step 2:** Wire click handler: POST `/api/settings/reset`, on success clear dirty flag.
- [ ] **Step 3:** Add unit test: click Reset → POST fires, WS settings push updates form.
- [ ] **Step 4:** Add e2e test: click Reset → settings revert to defaults.
- [ ] **Step 5:** Commit: `feat: add Reset button to restore NVS defaults`

### P0-3 Verify all existing tests pass

- [ ] **Step 1:** `npm run test:unit` — 160+ tests pass
- [ ] **Step 2:** `npm run test:e2e` — 44 tests pass
- [ ] **Step 3:** If failures, fix before proceeding

---

## Phase 1: Standalone Host Tests (no ESP-IDF needed)

**Why:** The `pwui_store` and `pwui_json` modules have zero ESP dependencies — just stdlib + cJSON. Test them directly with gcc on this Linux machine. Fast feedback (seconds vs minutes for ESP-IDF compile).

**Context:** cJSON and Unity are already present via the git submodule at `dependencies/cJSON/`.

### P1-1 Create stub ESP headers

Create `components/pico-settings/test/stub/esp_err.h`:

```c
#pragma once
#include <stdint.h>
typedef int32_t esp_err_t;
#define ESP_OK                    0
#define ESP_ERR_INVALID_ARG     -1
#define ESP_ERR_INVALID_STATE   -2
#define ESP_ERR_NO_MEM          -3
#define ESP_ERR_NOT_FOUND       -4
```

- [ ] **Step 1:** Create stub directory and header

### P1-2 Compile and run existing store tests

```bash
cd components/pico-settings
gcc -I src -I dependencies/cJSON -I dependencies/cJSON/tests/unity/src -I test/stub \
    dependencies/cJSON/cJSON.c \
    src/pwui_store.c test/test_pwui_store.c \
    dependencies/cJSON/tests/unity/src/unity.c -o test_store && ./test_store
```

- [ ] **Step 1:** Run the command
- [ ] **Step 2:** Expected: 14 tests pass (init_empty, add_and_find, find_nonexistent, set_value_text, set_value_switch, set_value_number, set_value_null, set_value_marks_dirty, status_does_not_mark_dirty, clear_dirty, settings_and_status_counts, populate_from_cjson, set_unknown_field, capacity_growth)

### P1-3 Compile and run existing JSON tests

```bash
cd components/pico-settings
gcc -I src -I dependencies/cJSON -I dependencies/cJSON/tests/unity/src -I test/stub \
    dependencies/cJSON/cJSON.c \
    src/pwui_store.c src/pwui_json.c test/test_pwui_json.c \
    dependencies/cJSON/tests/unity/src/unity.c -o test_json && ./test_json
```

- [ ] **Step 1:** Run the command
- [ ] **Step 2:** Expected: 9 tests pass (build_settings_output, build_status_no_dirty, build_with_options, build_with_attrs, attrs_quote_fixer, attrs_quote_fixer_empty, parse_apply_single_field, parse_apply_unknown_field_skipped, parse_apply_malformed)

### P1-4 Add edge case tests for pwui_store

Append to `components/pico-settings/test/test_pwui_store.c`:

| Test | Validates |
|---|---|
| `test_deinit_empty_store` | deinit on empty store doesn't crash |
| `test_set_value_overwrite` | second set_value frees old cJSON, new value sticks |
| `test_find_null_args` | find(NULL, "x", NULL) returns NULL, no crash |
| `test_store_field_at_bounds` | field_at(-1) and field_at(count) both return NULL |
| `test_populate_null_data` | populate(NULL) returns ESP_ERR_INVALID_ARG |
| `test_populate_non_object` | populate with cJSON array returns ESP_ERR_INVALID_ARG |
| `test_add_component_same_id_label` | add_component with same ID+label → ESP_OK (P0-1 fix) |
| `test_add_component_same_id_different_label` | add_component with same ID, different label → ESP_ERR_INVALID_STATE |
| `test_get_label_nonexistent` | get_label for unknown comp_id → NULL |
| `test_get_label_after_add` | add_component + get_label → returns label |
| `test_capacity_growth_comps` | add 8 components to exercise comp_capacity doubling |
| `test_populate_with_group_label` | populate from JSON containing `"label"` key → label skipped silently, no crash |
| `test_store_init_null` | init(NULL) returns ESP_ERR_INVALID_ARG |
| `test_add_field_null_store` | add_field(NULL, &f) returns ESP_ERR_INVALID_ARG |

- [ ] **Step 1:** Write all 14 new test functions
- [ ] **Step 2:** Add RUN_TEST calls to main() for each
- [ ] **Step 3:** Recompile and run — expected 14 + 14 = 28 tests pass

### P1-5 Add edge case tests for pwui_json

Append to `components/pico-settings/test/test_pwui_json.c`:

| Test | Validates |
|---|---|
| `test_build_empty_store` | build_settings on empty store → `{}` |
| `test_build_with_help` | field with help text → `"help"` in opts |
| `test_build_group_label` | register component via store, build → group has `"label"` key |
| `test_build_group_no_label` | unregistered component → no `"label"` key in group |
| `test_parse_apply_empty_data` | `{"action":"apply","data":{}}` → 0 changes |
| `test_parse_apply_max_changes` | 5 changes, max_changes=3 → only 3 returned |
| `test_parse_apply_skips_prefix` | data has `"_meta":{...}` → `_`-prefixed group skipped |
| `test_parse_apply_null_value` | field value is `null` → values entry is `""` |
| `test_parse_apply_number_value` | field value is `42` → values entry is `"42"` |
| `test_parse_apply_bool_values` | field values are `true`/`false` → values entries are `"true"`/`"false"` |
| `test_attrs_fixer_null_input` | fix_attrs_quotes(NULL) → `"{}"` |

- [ ] **Step 1:** Write all 11 new test functions
- [ ] **Step 2:** Add RUN_TEST calls to main() for each
- [ ] **Step 3:** Recompile and run — expected 9 + 11 = 20 tests pass

### P1-6 Final standalone test run

- [ ] **Step 1:** Run both test_store and test_json
- [ ] **Step 2:** Expected: 28 + 20 = 48 tests, all pass
- [ ] **Step 3:** Commit: `test: add standalone host tests with 25 edge cases`

---

## Phase 2: ESP-IDF Linux Target

**Why:** Validate that `pwui_ws.cpp` and `pwui.cpp` compile against real ESP-IDF headers (not stubs). Catch C++ compilation errors, linking issues, and ESPAsyncWebServer API mismatches before flashing hardware.

### P2-1 Install ESP-IDF

```bash
mkdir -p ~/esp && cd ~/esp
git clone --recursive https://github.com/espressif/esp-idf.git -b v5.3
cd esp-idf && ./install.sh esp32
```

- [ ] **Step 1:** Clone and install ESP-IDF v5.3
- [ ] **Step 2:** Source `export.sh` to set environment

### P2-2 Set up Linux-target test project

Create a minimal ESP-IDF project at `/tmp/pwui-test/`:

```
/tmp/pwui-test/
├── CMakeLists.txt
├── main/
│   ├── CMakeLists.txt
│   └── main.c                        # empty app_main
├── components/
│   └── pico-settings -> /config/workspace/pico-website/components/pico-settings
└── sdkconfig  (from idf.py set-target linux)
```

Top-level `CMakeLists.txt`:
```cmake
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(pwui_test)
```

- [ ] **Step 1:** Create project structure
- [ ] **Step 2:** Symlink pico-settings component
- [ ] **Step 3:** `idf.py set-target linux`

### P2-3 Build and verify

```bash
cd /tmp/pwui-test
idf.py set-target linux
idf.py build
```

- [ ] **Step 1:** `idf.py build` — expected: compiles without errors or warnings
- [ ] **Step 2:** Fix any warnings. With `-Werror` enabled, treat warnings as errors.

### P2-4 Runtime integration tests (Linux target)

Write a test program (`/tmp/pwui-test/main/main.c`) that exercises the pico-settings API at runtime. Since there's no actual AsyncWebServer on Linux, these tests verify the API surface: init, registration, value get/set, JSON serialization, push/broadcast.

```c
// Test 1: pwui_init validates storage callbacks
// Test 2: begin_component / end_component happy path
// Test 3: add_field with varargs (all sentinel types)
// Test 4: add_field without begin_component → error
// Test 5: end_component with wrong id → error
// Test 6: duplicate component same type → error
// Test 7: duplicate component cross-type → OK (P0-1)
// Test 8: pwui_set / pwui_get on existing field
// Test 9: pwui_set on unknown path → error
// Test 10: pwui_get on number field → returns string
// Test 11: build_settings / build_status return valid cJSON
// Test 12: parse_apply on valid payload
// Test 13: parse_apply on malformed JSON
// Test 14: populate via on_load callback
```

- [ ] **Step 1:** Write test main.c with 14 test functions
- [ ] **Step 2:** Build with `idf.py build`
- [ ] **Step 3:** Run with `build/pwui_test.elf`
- [ ] **Step 4:** All 14 tests pass
- [ ] **Step 5:** Commit: `test: add ESP-IDF Linux target integration tests`

---

## Phase 3: FlushFM-2.0 Integration

**Why:** Real hardware, real settings, real NVS. This validates that pico-settings works in a production ESP32 project with WiFi, audio streaming, sensors, and a multi-component architecture. It also provides a concrete usage example for the library.

**Context from exploring FlushFM-2.0:**
- PlatformIO with Arduino-ESP32 3.x / IDF 5.5 on ESP32-S3 (8MB PSRAM, 16MB flash)
- 16 settings across 5 components: WiFi, AudioRuntime, LightSensor, Supervisor, WebUI
- ESPAsyncWebServer already in lib_deps (currently used by ESPUI)
- NVS with per-component namespaces and dirty tracking
- `ISystemComponent` API: `settingCount()`, `settingMeta()`, `getSetting()`, `setSetting()`

### P3-1 Link pico-settings into FlushFM-2.0

```bash
cd /config/workspace/FlushFM-2.0
ln -s /config/workspace/pico-website/components/pico-settings lib/pico-settings
```

Add to `platformio.ini`:
```
lib_extra_dirs = lib/pico-settings
build_flags =
    -Ilib/pico-settings/include
    -Ilib/pico-settings/dependencies/cJSON
```

- [ ] **Step 1:** Symlink and configure build system

### P3-2 Build NVS bridge

Create `lib/pico-settings-bridge/pwui_nvs_bridge.h` and `.cpp`:

**on_load:** For each registered `ISystemComponent`, iterate `settingCount()`/`settingMeta()`, call `getSetting(key)`, and build cJSON matching the pico wire format `["type", "label", {"value": val}]`.

**on_save:** Parse the cJSON save payload, iterate groups and fields, call `comp->setSetting(key, value)` then `comp->saveSettings()`.

**on_reset:** For each component, set defaults from `defaults.h`, call `saveSettings()`, then re-populate cJSON from the fresh NVS state.

**Type mappings (FlushFM SettingType → pwui_type_t):**
| FlushFM | pwui |
|---|---|
| TEXT | PWUI_TEXT |
| PASSWORD | PWUI_PASSWORD |
| NUMBER | PWUI_NUMBER |
| SLIDER | PWUI_RANGE |
| SELECT | PWUI_SELECT |
| URL | PWUI_URL |

- [ ] **Step 1:** Write `pwui_nvs_bridge.h` and `.cpp`
- [ ] **Step 2:** Verify compiles against FlushFM's ISystemComponent

### P3-3 Register all settings and status fields

In `app_main()`, replace the ESPUI `buildUI()` call with pico-settings registration.

**Settings components (is_status=false):**

| Group | Label | Fields (key, type, default) |
|---|---|---|
| WiFi | "Wi-Fi" | ssid (TEXT, ""), pass (PASSWORD, "") |
| AudioRuntime | "Audio" | station (URL, ""), volume (RANGE, 255, min=0, max=255), balance (RANGE, 0, min=-16, max=16) |
| LightSensor | "Light Sensor" | baseThresh (NUMBER, 150), atten (SELECT, "3.3"), fastWeight (NUMBER, 400), trendWeight (NUMBER, 20), intervalMs (NUMBER, 20) |
| Supervisor | "Supervisor" | maxRecv (NUMBER, 3) |
| WebUI | "Colors" | cardBg, cardBorder, actionCardBg, saveBtnColor, resetBtnColor (all PWUI_COLOR) |

**Status components (is_status=true):**

| Group | Label | Fields (key, type) |
|---|---|---|
| System | "System" | uptime (TEXT), state (SELECT, options: FATAL/ERROR/SLEEP/BOOTING/CONNECTING/READY/LIVE), station_title (TEXT), signal (NUMBER), freeHeap (NUMBER) |

**on_apply callbacks:**

| Field | Callback behavior |
|---|---|
| WiFi.ssid, WiFi.pass | Call `wifiComponent->setSetting()`, trigger reconnect |
| AudioRuntime.station | Call `audioComponent->setSetting()`, start new stream |
| AudioRuntime.volume | Call `audioComponent->setSetting()`, adjust gain |
| All others | No callback (value stored in AV only, saved on demand) |

- [ ] **Step 1:** Write `register_pwui_settings()` and `register_pwui_status()` functions
- [ ] **Step 2:** Wire storage + init in app_main

### P3-4 Replace ESPUI with pico-settings

- Remove `s00500/ESPUI` from `platformio.ini` lib_deps
- Remove `#include <ESPUI.h>` and `WebServerComponent`
- Remove ESPUI's `data/` directory (no longer needed — pico-settings embeds static assets)
- Remove the `ensureServer()` / `buildUI()` / `handleUI()` lifecycle code
- Keep `AsyncWebServer *server` and pass it to `pwui_init()`

**Expected savings:** ~200KB flash, ~80KB RAM.

- [ ] **Step 1:** Remove ESPUI dependency and code
- [ ] **Step 2:** Verify build succeeds

### P3-5 Build and flash

```bash
cd /config/workspace/FlushFM-2.0
platformio run -e debug --target upload
platformio device monitor
```

- [ ] **Step 1:** Build succeeds
- [ ] **Step 2:** Flash to ESP32-S3
- [ ] **Step 3:** Monitor output: no crashes, settings loaded from NVS, WS ready

### P3-6 Protocol-level e2e tests

Point the pico-website Playwright suite at FlushFM-2.0:

```bash
# Start the Playwright tests with a custom base URL
cd /config/workspace/pico-website
PWUI_BASE_URL=http://192.168.4.1 npm run test:e2e
```

**Expected:** Protocol-level tests pass (WS connect, save, dirty tracking, status broadcast). Tests that depend on specific field schemas from `test_server/main.py` will fail — that's expected. The important thing is that the WS protocol, HTTP endpoints, and static file serving all work.

- [ ] **Step 1:** Run e2e with `PWUI_BASE_URL` pointing at FlushFM IP
- [ ] **Step 2:** Protocol tests pass. Note any failures for schema-specific tests.

### P3-7 Manual integration smoke test

- [ ] Connect to "pico-config" WiFi AP
- [ ] Open browser to device IP — all accordion sections visible
- [ ] Status section shows live uptime, state, signal, heap
- [ ] Change WiFi SSID → save → reconnect → values survive
- [ ] Change audio station → stream changes
- [ ] Adjust volume slider → audio level changes
- [ ] Click Save → reboot → all values persist in NVS
- [ ] Click Reset → defaults restored → form updates
- [ ] WiFi reconnects, audio continues streaming after save/reboot cycle

### P3-8 Stress and resource tests

- [ ] Audio streaming active + settings UI open → no heap exhaustion
- [ ] Multiple browser tabs connected → all receive WS broadcasts
- [ ] Monitoring free heap via status field while rapidly changing settings
- [ ] Verify no cJSON memory leaks across multiple save/reset cycles

---

## Phase 4: Post-Integration Polish

After Phase 3 passes, these items complete the picture:

- [ ] Copy FlushFM's NVS bridge as `examples/flushfm/` in pico-settings repo
- [ ] Update pico-website README with FlushFM as a real-world usage example
- [ ] Document the `ISystemComponent` → pico-settings migration pattern
- [ ] Add `#include <cJSON.h>` include path note to library docs (ESP-IDF vs PlatformIO)

---

## Test Summary Matrix

| Phase | Tests | Time | Requires |
|---|---|---|---|
| P0 | 2 fixes + verify | 10 min | Node.js |
| P1 | 48 C unit tests | 5 min | gcc only |
| P2 | Compile + 14 runtime tests | 30 min | ESP-IDF |
| P3 | FlushFM integration + e2e + manual | 1-2 hours | ESP32-S3 hardware |
| P4 | Docs + example | 15 min | None |

**Bottom line:** Phase 1 catches logic bugs in 5 minutes with just gcc. Phase 2 catches compile errors before flashing hardware. Phase 3 validates the full integration in a real project. Each phase gates the next — no hardware time wasted on bugs that a gcc compile could have caught.
