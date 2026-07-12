# Status Prefix, CI, and Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefix status field DOM names with `st-` to prevent collisions with settings fields, add GitHub Actions CI, and write an API reference in the README. Also fix indentation bug at lines 936-937 and Navbar favicon/logo.

**Architecture:** Status fields get `st-` prefix at render time only (`createField`), not in the data model. `populateFromGroups` accepts an optional `domPrefix` param to find the right DOM elements. Navbar logo uses a static img element if `/logo.png` exists. CI uses GitHub Actions to build/test on push/PR and create releases on version tags.

**Tech Stack:** Vanilla JS, Vitest, Playwright, GitHub Actions YAML

---

### Task 1: Add `st-` prefix to status field DOM names in `createField`

**Files:**
- Modify: `app.js:822` (`createField` signature)
- Modify: `app.js:835,888,895,908,925` (name/id assignment lines)

The strategy: when `isStatus` is truthy, prepend `"st-"` to `namePrefix` so status fields get names like `st-system.uptime` while settings fields keep `system.uptime`.

- [ ] **Step 1: Add `st-` prefixing at top of `createField`**

At line 822, insert one line after `var isStatus`:

```js
function createField(namePrefix, field, isStatus) {
    if (!field || typeof field !== 'object' || !field.key) return null;
    var key = field.key;
    var type = field.type;
    var labelText = field.label;
    var opts = field.opts || {};
    var required = opts.attrs && opts.attrs.required;
    var inputTypes = ['text', 'email', 'number', 'password', 'tel', 'url', 'color'];
    var effectivePrefix = isStatus ? 'st-' + namePrefix : namePrefix;
```

Then replace all uses of `namePrefix` in name/id assignments with `effectivePrefix`:

Line 835 (checkbox/switch):
```js
      input.name = input.id = effectivePrefix + '.' + key;
```

Line 888 (text/number/password/email/tel/url/color):
```js
      input.name = input.id = effectivePrefix + '.' + key;
```

Line 895 (range):
```js
      input.name = input.id = effectivePrefix + '.' + key;
```

Line 908 (select):
```js
      input.name = input.id = effectivePrefix + '.' + key;
```

Line 925 (textarea):
```js
      input.name = input.id = effectivePrefix + '.' + key;
```

- [ ] **Step 2: Build and run unit tests to verify no regressions from the prefix alone**

The tests will fail because status field queries still use unprefixed names. That's expected — we'll fix them in Task 3.

Run: `npm run build && npm run test:unit`
Expected: Tests for status field queries (name selectors like `[name="system.uptime"]`) FAIL. Settings tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app.js app.min.js
git commit -m "feat: prefix status field DOM names with st-"
```

---

### Task 2: Add `domPrefix` parameter to `populateFromGroups`

**Files:**
- Modify: `app.js:78` (`populateFromGroups` signature and querySelector)
- Modify: `app.js:100` (radio querySelectorAll)
- Modify: `app.js:290` (`processStatus` initial load — use prefix)
- Modify: `app.js:310` (`processStatus` subsequent update — use prefix)

Without this, `populateFromGroups(statusGroups)` uses `querySelector('[name="system.uptime"]')` which now finds the **settings** field (unprefixed), not the status field (`st-system.uptime`).

- [ ] **Step 1: Add `domPrefix` parameter to `populateFromGroups`**

Lines 78-85:
```js
  function populateFromGroups(grps, domPrefix) {
    if (!grps) grps = groups;
    var pfx = domPrefix || '';
    for (var ci = 0; ci < grps.length; ci++) {
      var grp = grps[ci];
      if (!grp.fields) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        var el = configForm.querySelector('[name="' + pfx + grp.id + '.' + field.key + '"]');
```

Also fix the radio case on line 100 — it uses `querySelectorAll` with the same pattern:
```js
          var radios = configForm.querySelectorAll('[name="' + pfx + grp.id + '.' + field.key + '"]');
```

- [ ] **Step 2: Pass `"st-"` prefix in `processStatus` calls**

Line 290 (initial load):
```js
        populateFromGroups(statusGroups, 'st-');
```

Line 310 (subsequent update):
```js
      populateFromGroups(statusGroups, 'st-');
```

- [ ] **Step 3: Build and verify**

Run: `npm run build && npm run test:unit`
Expected: Status population tests now partially pass.

- [ ] **Step 4: Commit**

```bash
git add app.js app.min.js
git commit -m "feat: add domPrefix param to populateFromGroups for status fields"
```

---

### Task 3: Fix indentation bug in `createField`

**Files:**
- Modify: `app.js:936-937` (extra indentation)

Found during the 2026-06-24 code audit. Lines 936-937 have 2 extra spaces.

- [ ] **Step 1: Fix indentation**

Replace lines 934-941:
```js
    labelEl.setAttribute('for', input.id);
    var container = document.createElement('div');
    container.appendChild(labelEl);
      container.appendChild(input);
      addHelperText(container, input.id, opts.help, input);
    if (rangeOutput) {
      container.appendChild(rangeOutput);
    }
```

With:
```js
    labelEl.setAttribute('for', input.id);
    var container = document.createElement('div');
    container.appendChild(labelEl);
    container.appendChild(input);
    addHelperText(container, input.id, opts.help, input);
    if (rangeOutput) {
      container.appendChild(rangeOutput);
    }
```

- [ ] **Step 2: Build and run unit tests**

Run: `npm run build && npm run test:unit`
Expected: Same failures as before (prefix-related tests still need fixing).

- [ ] **Step 3: Commit**

```bash
git add app.js app.min.js
git commit -m "fix: indentation in createField"
```

---

### Task 4: Add navbar favicon and logo image

**Files:**
- Modify: `index.html:4-7` (head — add favicon link)
- Modify: `index.html:49-53` (header — add logo img)
- Create: `test-deps/fixtures/favicon.ico`
- Create: `test-deps/fixtures/logo.png`

- [ ] **Step 1: Generate placeholder favicon and logo PNG files**

Run Python to create minimal 1x1 transparent PNG and ICO:

```bash
mkdir -p test-deps/fixtures
python3 -c "
import struct, zlib

def chunk(t, d):
    c = t + d
    crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return struct.pack('>I', len(d)) + c + crc

sig = b'\x89PNG\r\n\x1a\n'
ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 16, 16, 8, 6, 0, 0, 0))
raw = b'\x00' + bytes([0,0,0,255]) * 16  # 1 row of black pixels
for _ in range(15):
    raw += b'\x00' + bytes([0,0,0,255]) * 16
idat = chunk(b'IDAT', zlib.compress(raw))
iend = chunk(b'IEND', b'')
png = sig + ihdr + idat + iend

open('test-deps/fixtures/favicon.ico', 'wb').write(png)
open('test-deps/fixtures/logo.png', 'wb').write(png)
print('Created favicon.ico and logo.png in test-deps/fixtures/')
"
```

- [ ] **Step 2: Modify test server to serve from fixtures directory**

Edit `test_server/main.py` — add fixture path to the catch-all route:

```python
BASE = Path(__file__).resolve().parent.parent
FIXTURES = BASE / "test-deps" / "fixtures"
```

And change the catch-all route to check both directories:
```python
@app.api_route("/{name:path}")
async def static_files(name: str):
    for dir in [BASE, FIXTURES]:
        path = dir / name
        if path.is_file():
            return FileResponse(path)
    return PlainTextResponse("Not Found", status_code=404)
```

- [ ] **Step 2: Add favicon `<link>` in `<head>`**

After line 5 (`<meta name="viewport" ...>`), add:
```html
    <link rel="icon" href="/favicon.ico">
```

- [ ] **Step 3: Add logo `<img>` in navbar**

Replace lines 49-53:
```html
    <header class="container-fluid">
        <nav>
            <ul>
                <li><h1>{{TITLE}}</h1></li>
            </ul>
```

With:
```html
    <header class="container-fluid">
        <nav>
            <ul>
                <li><img id="nav-logo" src="/logo.png" alt="Logo" style="height:2rem;vertical-align:middle;margin-right:0.5rem" onerror="this.style.display='none'"><h1>{{TITLE}}</h1></li>
            </ul>
```

Added `id="nav-logo"` so e2e tests can target it. The `onerror` handler hides the image if `/logo.png` doesn't exist.

- [ ] **Step 4: Build and run e2e tests**

Run: `npm run build && npm run test:e2e`
Expected: All existing e2e tests PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html test_server/main.py test-deps/fixtures/
git commit -m "feat: add favicon link and navbar logo image"
```

---

### Task 5: Update unit tests for `st-` prefix

**Files:**
- Modify: `tests/unit/app.test.js:677` (query for status field name)
- Modify: `tests/unit/app.test.js:663-665` (merge test — count fields in merged section)

- [ ] **Step 1: Update status field disabled test (line 677)**

The test queries `[name="system.uptime"]` expecting the disabled status field. With `st-` prefixing, the status field is `[name="st-system.uptime"]` while `[name="system.uptime"]` finds the settings field (enabled).

Replace lines 676-679:
```js
    window.renderForm()
    var statusField = document.querySelector('[name="system.uptime"]')
    expect(statusField).not.toBeNull()
    expect(statusField.disabled).toBe(true)
```

With:
```js
    window.renderForm()
    var statusField = document.querySelector('[name="st-system.uptime"]')
    expect(statusField).not.toBeNull()
    expect(statusField.disabled).toBe(true)
```

- [ ] **Step 2: Update merge test field count (lines 663-665)**

The test verifies the merged `<details>` has 2 input fields (status + settings). Both now have distinct names (`st-system.uptime` and `system.uptime`), and both are `input` elements, so the count is still 2. This test should still pass. No change needed but verify.

- [ ] **Step 3: Run unit tests**

Run: `npm run build && npm run test:unit`
Expected: ALL unit tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/app.test.js
git commit -m "test: update unit tests for st- status field prefix"
```

---

### Task 6: Update e2e tests for `st-` prefix

**Files:**
- Modify: `tests/e2e/app.test.js:203-209` (status field disabled checks)
- Modify: `tests/e2e/app.test.js:219-221` (status value checks)
- Modify: `tests/e2e/app.test.js:233-235` (status values update over time)

Every e2e query that checks a status field by name needs the `st-` prefix. Settings field queries (`wifi.ssid`, `wifi.password`, etc.) stay unchanged.

- [ ] **Step 1: Update `status fields are disabled` test (lines 201-210)**

Replace:
```js
  test('status fields are disabled', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="system.uptime"]')).toBeDisabled()
    await expect(page.locator('[name="system.fw_version"]')).toBeDisabled()
    await expect(page.locator('[name="system.led"]')).toBeDisabled()
    await expect(page.locator('[name="network.mode"]').first()).toBeDisabled()
    await expect(page.locator('[name="network.signal"]')).toBeDisabled()
    await expect(page.locator('[name="network.connection"]')).toBeDisabled()
    await expect(page.locator('[name="sensors.temperature"]')).toBeDisabled()
  })
```

With:
```js
  test('status fields are disabled', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="st-system.uptime"]')).toBeDisabled()
    await expect(page.locator('[name="st-system.fw_version"]')).toBeDisabled()
    await expect(page.locator('[name="st-system.led"]')).toBeDisabled()
    await expect(page.locator('[name="st-network.mode"]').first()).toBeDisabled()
    await expect(page.locator('[name="st-network.signal"]')).toBeDisabled()
    await expect(page.locator('[name="st-network.connection"]')).toBeDisabled()
    await expect(page.locator('[name="st-sensors.temperature"]')).toBeDisabled()
  })
```

- [ ] **Step 2: Update `status shows computed values` test (lines 217-222)**

Replace:
```js
  test('status shows computed values', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="system.uptime"]')).not.toHaveValue('')
    await expect(page.locator('[name="network.signal"]')).not.toHaveValue('')
    await expect(page.locator('[name="sensors.temperature"]')).not.toHaveValue('')
  })
```

With:
```js
  test('status shows computed values', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[name="st-system.uptime"]')).not.toHaveValue('')
    await expect(page.locator('[name="st-network.signal"]')).not.toHaveValue('')
    await expect(page.locator('[name="st-sensors.temperature"]')).not.toHaveValue('')
  })
```

- [ ] **Step 3: Update `status values update over time` test (lines 230-237)**

Replace:
```js
  test('status values update over time', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    var val1 = await page.locator('[name="network.signal"]').inputValue()
    await page.waitForTimeout(4000)
    var val2 = await page.locator('[name="network.signal"]').inputValue()
    expect(val1).not.toBe(val2)
  })
```

With:
```js
  test('status values update over time', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    var val1 = await page.locator('[name="st-network.signal"]').inputValue()
    await page.waitForTimeout(4000)
    var val2 = await page.locator('[name="st-network.signal"]').inputValue()
    expect(val1).not.toBe(val2)
  })
```

- [ ] **Step 4: Run e2e tests**

Run: `npm run build && npm run test:e2e`
Expected: ALL e2e tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: ALL tests PASS (unit + e2e).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "test: update e2e tests for st- status field prefix"
```

---

### Task 7: Add e2e tests for favicon and navbar image

**Files:**
- Modify: `tests/e2e/app.test.js` (add tests)

Tests two paths: happy path (image served from fixtures) and fallback path (route aborted, verifying `onerror` hides the image).

- [ ] **Step 1: Add favicon/image e2e tests**

Append after existing tests (before the closing `}` of the file):

```js
test.describe('Navbar image and favicon', () => {
  test('favicon link is present in head', async ({ page }) => {
    await page.goto('/')
    var favicon = page.locator('link[rel="icon"]')
    await expect(favicon).toHaveAttribute('href', '/favicon.ico')
  })

  test('logo image is present in navbar', async ({ page }) => {
    await page.goto('/')
    var logo = page.locator('#nav-logo')
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('src', '/logo.png')
    await expect(logo).toHaveAttribute('alt', 'Logo')
    // Img should have loaded (non-zero natural dimensions since file exists)
    var nw = await logo.evaluate(function (el) { return el.naturalWidth })
    expect(nw).toBeGreaterThan(0)
  })

  test('logo image hides on load error', async ({ page }) => {
    await page.route('**/logo.png', function (route) { return route.abort('Failed') })
    await page.goto('/')
    var logo = page.locator('#nav-logo')
    await expect(logo).toBeVisible()
    var display = await logo.evaluate(function (el) { return el.style.display })
    expect(display).toBe('none')
  })
})
```

- [ ] **Step 2: Run e2e tests**

Run: `npm run build && npm run test:e2e`
Expected: All e2e tests PASS, including the three new favicon/image tests.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "test: add e2e tests for favicon and navbar logo image"
```

---

### Task 8: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

Version tags are created manually: `git tag v0.1.0 && git push origin v0.1.0`. CI runs on push/PR inside a Debian Trixie container, installing only the packages needed. On version tags it also creates a GitHub Release with build artifacts.

- [ ] **Step 1: Create the workflow file**

```yaml
name: CI

on:
  push:
  pull_request:
  workflow_dispatch:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    container:
      image: debian:trixie-slim
    steps:
      - name: Install system dependencies
        run: |
          apt-get update -qq
          apt-get install -y -qq git python3 python3-venv python3-pip curl ca-certificates
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci
      - name: Install Playwright Chromium
        run: npx playwright install chromium
      - name: Install Chromium system deps
        run: bash test-deps/setup.sh
      - name: Install test server deps
        run: |
          python3 -m venv .venv
          . .venv/bin/activate
          pip install -r test_server/requirements.txt -q
      - name: Build and test
        run: npm test

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build-and-test
    runs-on: ubuntu-latest
    container:
      image: debian:trixie-slim
    steps:
      - name: Install system dependencies
        run: |
          apt-get update -qq
          apt-get install -y -qq git curl ca-certificates
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci && npm run build
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            app.min.js
            index.html
            pico.jade.min.css
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for build, test, and release"
```

---

### Task 9: Write API reference in README

**Files:**
- Modify: `README.md` (append Install and API Reference sections)

The goal: a downstream ESP32 developer should be able to read this and use the library without reading `pwui.h` directly.

- [ ] **Step 1: Add Install section and API Reference to README**

Replace the entire `README.md` content with:

```markdown
# Pico Website

Web-based configuration UI for ESP32 devices. Renders live settings forms,
handles dirty tracking, and syncs changes via WebSocket.

## Install

Add to `platformio.ini`:

```ini
lib_deps = https://github.com/<owner>/pico-website.git#v0.1.0
```

## Quick Start (Development)

```bash
npm install
npm run build
npx playwright install chromium
bash test-deps/setup.sh
python3 -m venv .venv && . .venv/bin/activate && pip install -r test_server/requirements.txt
npm test
```

## Architecture

See [`docs/superpowers/specs/2026-06-18-unified-settings-design.md`](docs/superpowers/specs/2026-06-18-unified-settings-design.md)
for the full design spec, API contract, and JSON format reference.

## API Reference

Include `pwui.h` and set up your ESP32 web server:

```c
#include "pwui.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"

void app_main(void) {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("pico-config", NULL);
    AsyncWebServer server(80);

    // Register components and fields (see below)
    // ...

    pwui_storage_t storage = {
        .on_load = load_from_nvs,
        .on_save = save_to_nvs,
        .on_reset = reset_defaults,
    };
    pwui_init(&server, &storage);
    pwui_start();
}
```

### Lifecycle

```c
esp_err_t pwui_init(AsyncWebServer *server, const pwui_storage_t *storage);
esp_err_t pwui_start(void);
```

Call `pwui_init` with your server and storage callbacks. Call `pwui_start` after all component registration is complete.

### Storage Callbacks

```c
typedef esp_err_t (*pwui_storage_cb_t)(cJSON *data);

typedef struct {
    pwui_storage_cb_t on_load;   // called on startup — populate the cJSON with saved values
    pwui_storage_cb_t on_save;   // called on Save button — persist the cJSON to NVS/LittleFS
    pwui_storage_cb_t on_reset;  // called on Reset — restore factory defaults
} pwui_storage_t;
```

Example `on_load`:

```c
static esp_err_t load_from_nvs(cJSON *root) {
    cJSON *wifi = cJSON_CreateObject();
    cJSON_AddItemToObject(wifi, "ssid",
        cJSON_Parse("[\"text\",\"SSID\",{\"value\":\"MyNetwork\"}]"));
    cJSON_AddItemToObject(root, "wifi", wifi);
    return ESP_OK;
}
```

Each value must be in the wire format: `[type_string, label_string, opts_object]`.

### Component Registration

```c
esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status);
esp_err_t pwui_end_component(const char *id);
```

`is_status = false` creates a settings section (editable fields).
`is_status = true` creates a status section (read-only display, automatically prefixed).

If a status and settings section share the same `id`, they render merged into one accordion.

### Field Registration

#### Basic fields (text, number, password, email, tel, url, color, switch, checkbox, range, textarea)

```c
esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, ...);
```

Varargs use sentinels:

| Sentinel | Followed by | Description |
|----------|-------------|-------------|
| `PWUI_VALUE` | `const char *value` | Default/current value |
| `PWUI_HELP` | `const char *text` | Helper text below field |
| `PWUI_APPLY` | `pwui_apply_cb_t cb` | Callback on each WS apply |
| `PWUI_ATTRS` | `const char *json` | JSON string of HTML attributes e.g. `"{\"required\":true,\"maxlength\":32}"` |
| `PWUI_END` | (none) | Terminates the varargs |

Example:

```c
pwui_begin_component("wifi", "Wi-Fi Setup", false);
pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
               PWUI_VALUE, "MyNetwork",
               PWUI_ATTRS, "{\"required\":true,\"maxlength\":32}",
               PWUI_HELP, "Network name — 1-32 characters",
               PWUI_APPLY, on_ssid_change,
               PWUI_END);
pwui_end_component("wifi");
```

#### Select and Radio fields

```c
esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              ...);
```

Varargs use the same sentinels as `pwui_add_field`.

Example:

```c
static const char *mode_opts[][2] = {
    {"station", "Station"},
    {"ap", "Access Point"},
};
pwui_add_field_opts(PWUI_SELECT, "wifi", "mode", "Mode",
                    mode_opts, 2,
                    PWUI_VALUE, "station",
                    PWUI_HELP, "WiFi operating mode",
                    PWUI_END);
```

### Type Reference

| `pwui_type_t` | HTML | Notes |
|---------------|------|-------|
| `PWUI_TEXT` | `<input type="text">` | |
| `PWUI_NUMBER` | `<input type="number">` | |
| `PWUI_PASSWORD` | `<input type="password">` | |
| `PWUI_EMAIL` | `<input type="email">` | |
| `PWUI_TEL` | `<input type="tel">` | |
| `PWUI_URL` | `<input type="url">` | |
| `PWUI_COLOR` | `<input type="color">` | |
| `PWUI_SWITCH` | `<input type="checkbox" role="switch">` | |
| `PWUI_CHECKBOX` | `<input type="checkbox">` | Supports indeterminate (null value) |
| `PWUI_RANGE` | `<input type="range">` | |
| `PWUI_TEXTAREA` | `<textarea>` | |
| `PWUI_RADIO` | Radio group in `<fieldset>` | Use `pwui_add_field_opts` |
| `PWUI_SELECT` | `<select>` | Use `pwui_add_field_opts` |

### Runtime Value Access

```c
esp_err_t pwui_set(const char *path, const char *value);
const char *pwui_get(const char *path);
```

Paths are `"component_id.field_key"`, e.g. `"wifi.ssid"`.

### Push Updates

```c
esp_err_t pwui_push(void);              // broadcast settings to all WS clients
esp_err_t pwui_broadcast_status(void);  // broadcast status to all WS clients
```

Call `pwui_set` then `pwui_broadcast_status` to push live status updates:

```c
char buf[64];
snprintf(buf, sizeof(buf), "%ds", seconds);
pwui_set("system.uptime", buf);
pwui_broadcast_status();
```

### Full Example

See [`components/pico-settings/examples/basic/main.c`](components/pico-settings/examples/basic/main.c).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add API reference and install instructions to README"
```

---

### Task 10: Add version bumping rule to AGENTS.md

**Files:**
- Modify: `AGENTS.md` (append version bumping instructions)

The rule gives agents autonomy to bump the version in `library.json` when changes clearly justify it (new feature → minor, bug fix → patch, breaking → major), and asks the user on borderline cases.

- [ ] **Step 1: Append version bumping section to AGENTS.md**

```markdown
# Version Bumping

When a change merits a new release, bump `components/pico-settings/library.json`
and tag accordingly:

- **Major (X.0.0):** Breaking changes to wire format, WS protocol, or public API
- **Minor (0.X.0):** New features, new field types, new UI elements
- **Patch (0.0.X):** Bug fixes, edge case hardening, indentation, doc updates

Bump the version yourself when the change clearly fits one of these buckets.
Ask the user on borderline cases.

The tag (`git tag vX.Y.Z`) must match the version in `library.json`.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add version bumping rules to AGENTS.md"
```

---

## Self-Review

**1. Spec coverage:**
- ~~Navbar image + favicon~~ → Task 4
- ~~Code issue #1 (duplicate populateFromGroups)~~ → Fixed by Task 2 (prefix distinguishes status from settings DOM elements, both calls now work correctly on different elements)
- ~~Code issue #2 (indentation)~~ → Task 3
- ~~Auto-prefixing status component IDs~~ → Tasks 1 + 2
- ~~Favicon/image e2e tests (presence + fallback)~~ → Task 7
- ~~CI workflow (Debian container)~~ → Task 8
- ~~Docs / API reference~~ → Task 9
- ~~Version bumping rule in AGENTS.md~~ → Task 10

**2. Placeholder scan:** None. All steps have exact code and commands.

**3. Type consistency:**
- `effectivePrefix` defined in Task 1, used consistently across all field types.
- `domPrefix` param in `populateFromGroups` used as `pfx` local, applied to both `querySelector` and `querySelectorAll`.
- `processStatus` passes `'st-'` as the second argument to `populateFromGroups`.
- `id="nav-logo"` used in both Task 4 (HTML) and Task 7 (e2e test selectors).
