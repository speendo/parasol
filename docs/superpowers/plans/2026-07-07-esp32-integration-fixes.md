# ESP32 Integration Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four issues found during ESP32 testing: wrong JS reference, build integration, save button stuck, and status/settings group unification.

**Architecture:** The plan touches `app.js` (the single client-side JS file), `index.html`, `package.json`, `generate_assets.py`, and unit tests. Renames `components` → `groups` throughout to avoid confusion with the ESP-IDF `components/` directory. Merges status and settings groups at render time so groups with the same ID share one `<details>` section.

**Tech Stack:** Vanilla JS (no framework), terser for minification, vitest for unit testing.

---

### Task 1: Rename variables in `app.js`

**Files:**
- Modify: `app.js` (lines 11-13, 36-155, 243-257, 275-312, 370-500, 630-693, 740-778, 943)

- [ ] **Step 1: Rename `components` → `groups`, `statusComponents` → `statusGroups`, `comp` / `comps` / `compId` → `grp` / `grps` / `grpId`, `populateFromComponents` → `populateFromGroups`**

Apply `replaceAll` edits to `app.js` in this order:

| # | Old | New |
|---|-----|-----|
| 1 | `components` | `groups` |
| 2 | `statusComponents` | `statusGroups` |
| 3 | `compId` | `grpId` |
| 4 | `populateFromComponents` | `populateFromGroups` |
| 5 | `comps` | `grps` |
| 6 | `comp.` | `grp.` |
| 7 | ` comp` | ` grp` |

Then fix JSDoc comments and the test-expose block line (943) manually.

**Edit A: Variable declarations (lines 11-13)**
Old:
```
  var components = [];
  /** @type {Array} Read-only status component definitions, parallel to components. */
  var statusComponents = [];
```
New:
```js
  var groups = [];
  /** @type {Array} Read-only status group definitions, parallel to groups. */
  var statusGroups = [];
```

**Edit B: `populateFromComponents` → `populateFromGroups`** (use replaceAll)

**Edit C: `comp.` → `grp.`** (use replaceAll)

**Edit D: ` comp` → ` grp`** (use replaceAll, catches `var comp`, `for (...comp `, etc.)

**Edit E: `comps` → `grps`** (use replaceAll)

**Edit F: `compId` → `grpId`** (use replaceAll)

**Edit G: `components` → `groups`** (use replaceAll, catches remaining occurrences)

**Edit H: `statusComponents` → `statusGroups`** (use replaceAll)

**Edit I: Fix JSDoc — `populateFromComponents` usage on lines 74-77**
Old:
```
   * Populate form elements from component field definitions' opts.value.
   * @param {Array} [comps] - optional component array, defaults to global `components`
```
New:
```
   * Populate form elements from group field definitions' opts.value.
   * @param {Array} [grps] - optional group array, defaults to global `groups`
```

Also in the default-param line:
Old: `if (!comps) comps = components;`
New: `if (!grps) grps = groups;`

**Edit J: Fix JSDoc — `findField` on lines 122-127**
Old: `@param {string} compId - e.g. "wifi"`
New: `@param {string} grpId - e.g. "wifi"`
Old: `function findField(compId, fieldKey)`
New: `function findField(grpId, fieldKey)`
Old: `component ID and field key`
New: `group ID and field key`

**Edit K: Fix JSDoc — `sendToServer` on lines 496-515**
Old: `grpId.fieldKey` mentions and `var compId`
Replace all `compId` → `grpId` in the function body.

**Edit L: Fix JSDoc — `serialize` on line 36**
Old: `Keys are "compId.fieldKey"`
New: `Keys are "grpId.fieldKey"`

**Edit M: Fix JSDoc — `onUserInput` on line 520**
Old: `@param {string} key - "compId.fieldKey"`
New: `@param {string} key - "grpId.fieldKey"`

**Edit N: Fix JSDoc — `processSettings` on lines 236-241**
Old: `Parse the full settings JSON from the server into the \`components\` array`
New: `Parse the full settings JSON from the server into the \`groups\` array`
Old: `Called on initial WebSocket load (when components is empty).`
New: `Called on initial WebSocket load (when groups is empty).`

**Edit O: Fix JSDoc — `processStatus` on lines 269-274**
Old: `Parse a status data payload into statusComponents and render.`
New: `Parse a status data payload into statusGroups and render.`
Old: `via populateFromComponents.`
New: `via populateFromGroups.`
Old: `by component ID`
New: `by group ID`

**Edit P: Fix comment in `renderNav` (line 633)**
Old: `from statusComponents and components`
New: `from statusGroups and groups`

**Edit Q: Fix comment in `renderForm` (line 663)**
Old: `from statusComponents first, then components`
New: `from statusGroups first, then groups`

**Edit R: Fix `processStatus` line ~276**
Old: `if (statusComponents.length === 0)`
New: `if (statusGroups.length === 0)`

**Edit S: Fix comment line ~398**
Old: `// Initial load — no components yet, process settings directly`
New: `// Initial load — no groups yet, process settings directly`
Old: `if (components.length === 0)`
New: `if (groups.length === 0)`

**Edit T: Update test-expose block (line 943)**

In the long test-expose line, replace:
- `window.populateFromComponents` → `window.populateFromGroups`
- `'components'` → `'groups'` (in `Object.defineProperty`)
- `'statusComponents'` → `'statusGroups'` (in `Object.defineProperty`)
- return value `components` → `groups`
- return/set value `statusComponents` → `statusGroups`

- [ ] **Step 2: Verify no stale names remain**

```bash
grep -n 'components\|compId\|comps\b\|comp\.\|statusComponents\|populateFromComponents' app.js
```
Expected: zero matches.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "refactor: rename components to groups throughout app.js"
```

---

### Task 2: Rename `components` → `groups` in unit tests

**Files:**
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Apply renames**

Use replaceAll on `tests/unit/app.test.js`:

| Old | New |
|-----|-----|
| `window.__test.components` | `window.__test.groups` |
| `window.__test.statusComponents` | `window.__test.statusGroups` |
| `window.populateFromComponents` | `window.populateFromGroups` |
| `describe('populateFromComponents'` | `describe('populateFromGroups'` |
| `'populateFromComponents null safety'` | `'populateFromGroups null safety'` |
| `'sets form values from components data` | `'sets form values from groups data` |

- [ ] **Step 2: Verify no stale names**

```bash
grep -n 'window\.__test\.components\|window\.populateFromComponents\|window\.__test\.statusComponents' tests/unit/app.test.js
```
Expected: zero matches.

- [ ] **Step 3: Run tests**

```bash
npm run test:unit
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: rename components to groups in unit tests"
```

---

### Task 3: Change `index.html` script reference to `app.min.js`

**Files:**
- Modify: `index.html:83`

- [ ] **Step 1: Edit the script tag**

```html
    <script src="app.min.js"></script>
```
Old: `<script src="app.js"></script>`

- [ ] **Step 2: Verify**

```bash
grep 'script src' index.html
```
Expected: `    <script src="app.min.js"></script>`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix: reference app.min.js instead of app.js in HTML"
```

---

### Task 4: Update `package.json` and `AGENTS.md`

**Files:**
- Modify: `package.json:6`, `AGENTS.md`

- [ ] **Step 1: Update test script in `package.json`**

```json
    "test": "npm run build && vitest run && playwright test",
```
Old: `"test": "vitest run && playwright test",`

- [ ] **Step 2: Update `AGENTS.md` test command**

Old: `- \`npm test\` — run all tests (unit + e2e)`
New: `- \`npm test\` — build minified JS, then run all tests (unit + e2e)`

- [ ] **Step 3: Commit**

```bash
git add package.json AGENTS.md
git commit -m "chore: ensure app.min.js is built before tests"
```

---

### Task 5: CMake-based asset generation with JSON config

**Goal:** Remove the downstream dev's dependency on `generate_assets.py`. The CMake build (`pio run`) reads a `pico_config.json`, injects the title into HTML, gzips all assets, and generates `pwui_assets.c`/`.h` — all without Python scripts or external tooling beyond `gzip`.

**Downstream dev experience:**
```
project/
├── platformio.ini
├── pico_config.json    ← {"title": "My Thermostat"}
└── src/main.cpp

$ pio run              ← CMake reads JSON, injects title, gzips, embeds, compiles
```

**Files:**
- Create: `components/pico-settings/cmake/generate_assets.cmake`
- Modify: `components/pico-settings/CMakeLists.txt`
- Modify: `index.html` (add `{{TITLE}}` placeholder)
- Modify: `.gitignore`
- Git rm: `components/pico-settings/src/pwui_assets.c`
- Git rm: `components/pico-settings/src/pwui_assets.h`

- [ ] **Step 1: Create `cmake/generate_assets.cmake`**

Create directory `components/pico-settings/cmake/` and file `generate_assets.cmake`:

```cmake
# cmake/generate_assets.cmake
# Called from CMakeLists.txt via add_custom_command.
# Reads static source files, injects config from pico_config.json,
# gzips everything, writes pwui_assets.c and pwui_assets.h.
#
# Parameters (passed via -D):
#   ASSETS_SRC   — repo root with index.html, app.min.js, pico.jade.min.css
#   CONFIG_FILE  — path to pico_config.json in the downstream project
#   OUT_DIR      — output directory for pwui_assets.c / pwui_assets.h

find_program(GZIP gzip REQUIRED)

# Default title
set(PICO_TITLE "ESP32 Config")

# Read config if present
if(EXISTS "${CONFIG_FILE}")
    file(READ "${CONFIG_FILE}" PICO_JSON)
    string(JSON PICO_TITLE GET "${PICO_JSON}" title)
endif()

# Read and inject title into HTML
file(READ "${ASSETS_SRC}/index.html" HTML_CONTENT)
string(REPLACE "{{TITLE}}" "${PICO_TITLE}" HTML_CONTENT "${HTML_CONTENT}")

# Read JS and CSS (title injection not needed)
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

# Write pwui_assets.h
file(WRITE "${OUT_DIR}/pwui_assets.h" [=[
#pragma once
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
]=])

# Write pwui_assets.c
set(OUT_C "${OUT_DIR}/pwui_assets.c")
file(WRITE "${OUT_C}" [=[#include "pwui_assets.h"

]=])

# Define byte arrays (convert hex string to C array)
function(write_byte_array VARNAME HEX_DATA OUT_FILE)
    file(APPEND "${OUT_FILE}" "const uint8_t ${VARNAME}[] = {\n")
    set(COL 0)
    set(LINE_COUNT 0)
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
const pwui_asset_t pwui_assets[] = {
    {"/", "text/html", index_html_gz, index_html_gz_len},
    {"/app.min.js", "application/javascript", app_min_js_gz, app_min_js_gz_len},
    {"/pico.jade.min.css", "text/css", pico_jade_min_css_gz, pico_jade_min_css_gz_len},
};
const size_t pwui_assets_count = 3;
]=])
```

- [ ] **Step 2: Update `CMakeLists.txt`**

Replace the current `CMakeLists.txt` with:

```cmake
# C sources built from source files (not generated)
set(COMPONENT_SRCS "src/pwui_store.c" "src/pwui_json.c" "src/pwui.cpp" "src/pwui_ws.cpp")

# Asset files to watch for changes (relative to repo root)
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}/../../..")

# Generated asset files
set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(ASSETS_C "${GENERATED_DIR}/pwui_assets.c")
set(ASSETS_H "${GENERATED_DIR}/pwui_assets.h")

add_custom_command(
    OUTPUT ${ASSETS_C} ${ASSETS_H}
    COMMAND ${CMAKE_COMMAND}
        -DASSETS_SRC="${ASSETS_SRC}"
        -DCONFIG_FILE="${CMAKE_SOURCE_DIR}/pico_config.json"
        -DOUT_DIR="${GENERATED_DIR}"
        -P "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    DEPENDS
        "${ASSETS_SRC}/index.html"
        "${ASSETS_SRC}/app.min.js"
        "${ASSETS_SRC}/pico.jade.min.css"
        "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    COMMENT "Generating pico-website assets"
)

idf_component_register(
    SRCS ${COMPONENT_SRCS} ${ASSETS_C}
    INCLUDE_DIRS "include" "src" "dependencies/cJSON" "${GENERATED_DIR}"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
)
```

Key changes:
- **No `pmui_assets.c`** in the static `COMPONENT_SRCS` — it's generated at build time.
- `add_custom_command` fires when source HTML/JS/CSS or the cmake script changes.
- Includes `${GENERATED_DIR}` so `#include "pwui_assets.h"` resolves from the build dir.
- Reads `pico_config.json` from the project root (where `platformio.ini` lives).

- [ ] **Step 3: Change `<h1>` in `index.html` to `{{TITLE}}` placeholder**

Old:
```html
<h1>ESP32 Config</h1>
```
New:
```html
<h1>{{TITLE}}</h1>
```

The CMake script replaces `{{TITLE}}` with the value from `pico_config.json`.

- [ ] **Step 4: Remove generated files from git tracking**

```bash
git rm components/pico-settings/src/pwui_assets.c
git rm components/pico-settings/src/pwui_assets.h
```

Add to `.gitignore`:
```
# Generated asset files (cmake/generate_assets.cmake)
components/pico-settings/src/pwui_assets.c
components/pico-settings/src/pwui_assets.h
```

- [ ] **Step 5: Test**

Remove existing generated files and rebuild:
```bash
rm -f components/pico-settings/src/pwui_assets.c components/pico-settings/src/pwui_assets.h
cmake -DASSETS_SRC=. -DCONFIG_FILE=/nonexistent -DOUT_DIR=components/pico-settings/src \
      -P components/pico-settings/cmake/generate_assets.cmake
```
Expected: `pwui_assets.c` and `pwui_assets.h` regenerate, HTML contains `ESP32 Config` (default).

- [ ] **Step 6: Commit**

```bash
git add components/pico-settings/cmake/generate_assets.cmake
git add components/pico-settings/CMakeLists.txt
git add index.html
git add .gitignore
git commit -m "feat: CMake-based asset generation with JSON config"
```

> **Note:** `generate_assets.py` remains for optional dev convenience (host-side testing) but is no longer part of the downstream build path. It should eventually be removed or updated to call the CMake logic path.

---

### Task 6: Merge status and settings groups at render time

**Files:**
- Modify: `app.js` (lines 633-693: `renderNav`, `renderLinks`, `renderForm`, `renderSection`)

**Goal:** Status groups and settings groups with the same ID render into a single `<details>` block. Status fields go first (disabled), settings fields after (editable). No `secondary` CSS class on status summaries or nav links. Nav links deduplicated by group ID.

- [ ] **Step 1: Rewrite `renderNav` and `renderLinks` (lines 633-661)**

```js
  function renderNav() {
    navList.innerHTML = '';
    var seen = {};
    for (var si = 0; si < statusGroups.length; si++) {
      seen[statusGroups[si].id] = true;
      renderLink(statusGroups[si]);
    }
    for (var gi = 0; gi < groups.length; gi++) {
      if (seen[groups[gi].id]) continue;
      seen[groups[gi].id] = true;
      renderLink(groups[gi]);
    }
    if (navList._clickWired) return;
    navList._clickWired = true;
    navList.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link && link.hash) {
        var el = document.getElementById(link.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    });
  }

  /** Append a single nav link for a group. */
  function renderLink(grp) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + grp.id;
    a.textContent = grp.label;
    li.appendChild(a);
    navList.appendChild(li);
  }
```

Old: Replace entire `renderNav` and `renderLinks` functions.

- [ ] **Step 2: Rewrite `renderForm` and `renderSection` (lines 663-693)**

```js
  function renderForm() {
    configForm.innerHTML = '';
    var seen = {};
    for (var si = 0; si < statusGroups.length; si++) {
      var sgrp = statusGroups[si];
      seen[sgrp.id] = true;
      renderSection(sgrp.id, sgrp.label, sgrp.fields, true, null);
    }
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = groups[gi];
      if (seen[grp.id]) {
        renderSection(grp.id, null, grp.fields, false, grp.id);
      } else {
        seen[grp.id] = true;
        renderSection(grp.id, grp.label, grp.fields, false, null);
      }
    }
    var fields = configForm.querySelectorAll('input, select, textarea');
    for (var fi = 0; fi < fields.length; fi++) {
      if (fields[fi].name) fields[fi].setAttribute('aria-invalid', fields[fi].checkValidity() ? 'false' : 'true');
    }
    var details = configForm.querySelectorAll('details');
    for (var di = 0; di < details.length; di++) {
      if (details[di].querySelector('[aria-invalid="true"]')) details[di].open = true;
    }
  }

  /**
   * Render a details/section block for a group.
   * @param {string} id - group DOM id
   * @param {string|null} label - summary text (null = append to existing details)
   * @param {Array} fields - field definitions
   * @param {boolean} disabled - whether fields are read-only
   * @param {string|null} appendToId - if set, append fields to existing details instead of creating new
   */
  function renderSection(id, label, fields, disabled, appendToId) {
    var details;
    if (appendToId) {
      details = document.getElementById(appendToId);
    } else {
      details = document.createElement('details');
      details.id = id;
      var summary = document.createElement('summary');
      summary.textContent = label;
      details.appendChild(summary);
      configForm.appendChild(details);
    }
    if (!details || !fields) return;
    for (var fi = 0; fi < fields.length; fi++) {
      var fieldEl = createField(id, fields[fi], disabled ? 1 : 0);
      if (fieldEl) details.appendChild(fieldEl);
    }
  }
```

Old: Replace entire `renderForm` and `renderSection` functions.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: merge status and settings groups at render time"
```

---

### Task 7: Update unit tests for merged rendering

**Files:**
- Modify: `tests/unit/app.test.js`

- [ ] **Step 1: Update `renderNav` test**

Replace the `renderNav` describe block with:

```js
describe('renderNav', () => {
  beforeEach(() => {
    document.getElementById('nav-list').innerHTML = ''
    window.__test.groups = [
      { id: 'wifi', label: 'Wifi' },
      { id: 'gpio', label: 'Gpio' },
    ]
    window.__test.statusGroups = [
      { id: 'system', label: 'System' },
    ]
  })

  it('renders nav links for each group (status first, no secondary class)', () => {
    window.renderNav()
    var links = document.querySelectorAll('#nav-list a')
    expect(links.length).toBe(3)
    expect(links[0].textContent).toBe('System')
    expect(links[0].getAttribute('href')).toBe('#system')
    expect(links[0].hasAttribute('class')).toBe(false)
    expect(links[1].textContent).toBe('Wifi')
    expect(links[2].textContent).toBe('Gpio')
  })

  it('deduplicates nav links when status and settings share an ID', () => {
    window.__test.statusGroups = [{ id: 'wifi', label: 'Wifi Status' }]
    window.__test.groups = [{ id: 'wifi', label: 'Wifi Settings' }]
    window.renderNav()
    var links = document.querySelectorAll('#nav-list a')
    expect(links.length).toBe(1)
    expect(links[0].textContent).toBe('Wifi Status')
  })
})
```

- [ ] **Step 2: Update `renderForm` test**

Replace the `renderForm` describe block with:

```js
describe('renderForm', () => {
  beforeEach(() => {
    document.getElementById('config-form').innerHTML = ''
    window.__test.groups = [
      {
        id: 'wifi',
        label: 'Wifi',
        fields: [{ key: 'ssid', type: 'text', label: 'SSID', opts: { help: 'Network name' } }],
      },
      {
        id: 'system',
        label: 'System',
        fields: [{ key: 'uptime', type: 'text', label: 'Uptime' }],
      },
    ]
    window.__test.statusGroups = []
  })

  it('renders accordion details for each group', () => {
    window.renderForm()
    var details = document.querySelector('#config-form details')
    expect(details).not.toBeNull()
    expect(details.id).toBe('wifi')
    expect(details.querySelector('summary').textContent).toBe('Wifi')
  })

  it('renders fields inside accordion', () => {
    window.renderForm()
    var input = document.querySelector('#config-form input[name="wifi.ssid"]')
    expect(input).not.toBeNull()
  })

  it('merges status and settings group with same ID', () => {
    window.__test.statusGroups = [
      {
        id: 'system',
        label: 'System Status',
        fields: [{ key: 'uptime', type: 'text', label: 'Uptime', opts: { value: '42h' } }],
      },
    ]
    window.renderForm()
    var details = document.querySelectorAll('#config-form details')
    expect(details.length).toBe(2)
    var sysDetails = document.getElementById('system')
    expect(sysDetails.querySelector('summary').textContent).toBe('System Status')
    var sysFields = sysDetails.querySelectorAll('input')
    expect(sysFields.length).toBe(2)
    expect(sysFields[0].disabled).toBe(true)
    expect(sysFields[1].disabled).toBe(false)
  })

  it('status fields are disabled, settings fields are enabled', () => {
    window.__test.statusGroups = [
      {
        id: 'system',
        label: 'System',
        fields: [{ key: 'uptime', type: 'text', label: 'Uptime', opts: { value: '42h' } }],
      },
    ]
    window.renderForm()
    var statusField = document.querySelector('[name="system.uptime"]')
    expect(statusField).not.toBeNull()
    expect(statusField.disabled).toBe(true)
  })

  it('status summary does not have secondary class', () => {
    window.__test.statusGroups = [
      {
        id: 'network',
        label: 'Network',
        fields: [{ key: 'ip', type: 'text', label: 'IP' }],
      },
    ]
    window.__test.groups = []
    window.renderForm()
    var summary = document.querySelector('#network summary')
    expect(summary).not.toBeNull()
    expect(summary.className).not.toContain('secondary')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm run test:unit
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: update render tests for merged groups and deduplication"
```

---

### Task 8: Rebuild `app.min.js` and run full test suite

**Files:**
- Modify: `app.min.js` (regenerated)

- [ ] **Step 1: Build minified JS**

```bash
npm run build
```
Expected: terser runs without errors, `app.min.js` is regenerated.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: all unit tests pass, all e2e tests pass.

- [ ] **Step 3: Commit**

```bash
git add app.min.js
git commit -m "build: regenerate app.min.js"
```

---

## Self-Review

**Spec coverage:**
- ✓ Issue 1: Script reference → Task 3 (index.html) + Task 4 (package.json)
- ✓ Issue 2: Build integration → Task 5 (CMake-based asset gzip + JSON config, no Python required for downstream)
- ✓ Issue 3: Save button → postJSON already shows errors on failure
- ✓ Issue 4: Apply → verify server-side apply handler, client-side format is correct
- ✓ Issue 5: Status/settings group merge → Task 6 (render merge) + Task 7 (tests)
- ✓ Rename components→groups → Task 1 + Task 2

**Placeholder scan:** No TODOs, TBDs, or vague instructions. All code blocks are exact.

**Type consistency:**
- `groups` array everywhere (was `components`)
- `statusGroups` array everywhere (was `statusComponents`)
- `populateFromGroups` consistently (was `populateFromComponents`)
- `findField` searches `groups` array
- `renderSection` signature: `(id, label, fields, disabled, appendToId)` — calls in `renderForm` match this signature
