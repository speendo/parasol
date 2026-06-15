# ESP32 Modular Configuration UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded config page with a dynamic UI where ESP32 components register their settings via JSON files.

**Architecture:** ESPAsyncWebServer serves a minimal HTML skeleton + Pico CSS + a single JS driver. A `manifest.json` lists all installed components. Each component has its own JSON file defining form fields. The client JS fetches the manifest, then each component JSON, and builds the nav + accordion dynamically.

**Tech Stack:** Vanilla JS (no frameworks), Pico CSS v2, ESP-IDF + ESPAsyncWebServer (serving layer deferred).

---

## File Structure

```
/config/workspace/pico-website/
├── index.html          # MODIFY: skeleton page, empty nav + form containers
├── app.js              # CREATE: readable JS with comments, all logic
├── pico.jade.min.css   # EXISTING: moved from css/ to root
├── manifest.json       # CREATE: component registry
├── components/
│   ├── wifi.json       # CREATE: example component
│   └── gpio.json       # CREATE: example component
├── css/
│   └── pico.jade.min.css  # EXISTING (unchanged)
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-06-15-esp32-config-ui-design.md  # EXISTING (spec reference)
```

---

### Task 1: Strip `index.html` to skeleton

**Files:**
- Modify: `/config/workspace/pico-website/index.html`
- Verify: `/config/workspace/pico-website/index.html`

- [ ] **Step 1: Replace index.html body with skeleton containers**

Replace `<body>` content: keep the `<header>` with `<nav>` (but empty nav placeholder for JS to fill), replace `<main>` with empty `<form>` container, keep footer and script tag.

Write this to `/config/workspace/pico-website/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ESP32 Config</title>
    <link rel="stylesheet" href="pico.jade.min.css">
</head>
<body>
    <header class="container-fluid">
        <nav>
            <ul>
                <li><h1>ESP32 Config</h1></li>
            </ul>
            <ul id="nav-list">
                <!-- JS populates nav links here -->
            </ul>
        </nav>
    </header>

    <main class="container">
        <form id="config-form">
            <!-- JS populates details sections here -->
        </form>
    </main>

    <footer>
        <p id="status-bar"></p>
    </footer>

    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the skeleton**

Open `index.html` in a browser. Expected: A page with "ESP32 Config" title, an empty nav (no links), an empty form area, and a footer. No console errors (app.js will error since manifest.json doesn't exist yet — that's expected at this stage).

---

### Task 2: Create `manifest.json` and example component JSONs

**Files:**
- Create: `/config/workspace/pico-website/manifest.json`
- Create: `/config/workspace/pico-website/components/wifi.json`
- Create: `/config/workspace/pico-website/components/gpio.json`

- [ ] **Step 1: Create manifest.json**

Write to `/config/workspace/pico-website/manifest.json`:

```json
[
  {"id": "wifi", "label": "WiFi Configuration", "file": "components/wifi.json"},
  {"id": "gpio", "label": "GPIO Settings", "file": "components/gpio.json"}
]
```

- [ ] **Step 2: Create wifi.json**

Write to `/config/workspace/pico-website/components/wifi.json`:

```json
[
  ["ssid", "text", "SSID", {"attrs": {"maxlength": 32, "placeholder": "MyNetwork"}, "default": "", "tooltip": "WiFi network name"}],
  ["password", "password", "Password", {"attrs": {"maxlength": 64, "placeholder": "Enter password"}, "default": "", "tooltip": "WiFi password"}],
  ["mode", "select", "Mode", {"options": [["station", "Station"], ["ap", "Access Point"]], "default": "station", "tooltip": "WiFi operating mode"}],
  ["hidden", "switch", "Hidden SSID", {"default": false, "tooltip": "Hide network from scans"}],
  ["channel", "range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "default": 6, "tooltip": "WiFi channel number"}]
]
```

- [ ] **Step 3: Create gpio.json**

Write to `/config/workspace/pico-website/components/gpio.json`:

```json
[
  ["pin", "number", "Pin Number", {"attrs": {"min": 0, "max": 39, "placeholder": "0"}, "default": 2, "tooltip": "GPIO pin number"}],
  ["direction", "select", "Direction", {"options": [["input", "Input"], ["output", "Output"]], "default": "output", "tooltip": "Pin direction"}],
  ["pull", "radio", "Pull Resistor", {"options": [["none", "None"], ["up", "Pull Up"], ["down", "Pull Down"]], "default": "none", "tooltip": "Internal pull resistor"}],
  ["initial", "select", "Initial State", {"options": [["low", "Low"], ["high", "High"]], "default": "low", "tooltip": "Initial output state"}]
]
```

- [ ] **Step 4: Verify JSONs are valid**

Run this to verify JSON syntax:

```bash
python3 -c "
import json, sys
for f in ['manifest.json', 'components/wifi.json', 'components/gpio.json']:
    with open(f) as fh:
        json.load(fh)
    print(f'{f}: OK')
"
```

Expected output:
```
manifest.json: OK
components/wifi.json: OK
components/gpio.json: OK
```

---

### Task 3: Implement `app.js` — manifest fetch + nav builder

**Files:**
- Create: `/config/workspace/pico-website/app.js`

- [ ] **Step 1: Write the IIFE wrapper with DOM refs and init**

Start `/config/workspace/pico-website/app.js`:

```js
/**
 * ESP32 Modular Configuration UI
 *
 * Loads manifest.json → fetches per-component JSON files → builds
 * nav links and accordion form dynamically. Minify for deployment.
 */
(function () {
  'use strict';

  // DOM references
  const navList = document.getElementById('nav-list');
  const configForm = document.getElementById('config-form');
  const statusBar = document.getElementById('status-bar');

  let components = [];

  function showError(msg) {
    statusBar.textContent = msg;
    statusBar.style.color = 'var(--pico-color-red)';
  }

  function clearError() {
    statusBar.textContent = '';
    statusBar.style.color = '';
  }

  // Bootstrap on DOM ready
  document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Add `init()` and `loadManifest()`**

Append to `app.js`:

```js
  async function init() {
    const ok = await loadManifest();
    if (!ok) return;
    renderNav();
    await loadComponents();
    renderForm();
    handleHash();
  }

  async function loadManifest() {
    try {
      const res = await fetch('/manifest.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      components = await res.json();
      clearError();
      return true;
    } catch (err) {
      showError('Failed to load manifest: ' + err.message);
      return false;
    }
  }
```

- [ ] **Step 3: Add `renderNav()`**

Append to `app.js`:

```js
  function renderNav() {
    for (const comp of components) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + comp.id;
      a.textContent = comp.label;
      li.appendChild(a);
      navList.appendChild(li);
    }
  }
```

- [ ] **Step 4: Add `loadComponents()`**

Append to `app.js`:

```js
  async function loadComponents() {
    const results = await Promise.allSettled(
      components.map(async (comp) => {
        const res = await fetch('/' + comp.file);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        comp.fields = await res.json();
      })
    );
    // Filter out failed components, show single warning
    const failed = results.filter((r) => r.status === 'rejected');
    const skipped = [];
    components = components.filter((comp, i) => {
      if (results[i].status === 'fulfilled') return true;
      skipped.push(comp.label);
      return false;
    });
    if (skipped.length > 0) {
      showError('Skipped: ' + skipped.join(', '));
    }
  }
```

- [ ] **Step 5: Verify the nav works**

Serve the directory and open in a browser:

```bash
python3 -m http.server 8080 --directory /config/workspace/pico-website
```

Then open `http://localhost:8080`. Expected:
- Nav shows "WiFi Configuration" and "GPIO Settings" links
- Clicking nav links changes URL hash but nothing opens yet (no accordion)
- No console errors

---

### Task 4: Implement `app.js` — `createField()` for all types

**Files:**
- Modify: `/config/workspace/pico-website/app.js`

- [ ] **Step 1: Add the `createField()` function**

Append to `app.js` before the closing `})()`:

```js
  function createField(field) {
    // field = [key, type, label, opts?]
    if (!Array.isArray(field) || field.length < 3) return null;

    const key = field[0];
    const type = field[1];
    const labelText = field[2];
    const opts = field[3] || {};

    // HTML input types that map directly to <input type="...">
    // Note: 'range' is excluded; it needs a live value display (handled separately below)
    const inputTypes = ['text', 'email', 'number', 'password', 'tel', 'url', 'color'];

    // Label element (shared by most types)
    if (type === 'checkbox') {
      // Checkbox: label wraps the input
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = key;
      if (opts.default) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'switch') {
      // Switch: checkbox with role="switch"
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.name = key;
      if (opts.default) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    // Create label text element
    const labelEl = document.createElement('label');
    labelEl.textContent = labelText;
    if (opts.tooltip) labelEl.setAttribute('data-tooltip', opts.tooltip);
    if (type === 'radio') {
      labelEl.textContent = ''; // Radio uses fieldset legend
    }

    let input;

    if (inputTypes.indexOf(type) !== -1) {
      input = document.createElement('input');
      input.type = type;
      input.name = key;
      if (opts.default !== undefined) input.value = opts.default;
      applyAttrs(input, opts.attrs);
    } else if (type === 'range') {
      // Range: input with live value display
      input = document.createElement('input');
      input.type = 'range';
      input.name = key;
      if (opts.default !== undefined) input.value = opts.default;
      applyAttrs(input, opts.attrs);

      const valueDisplay = document.createElement('output');
      valueDisplay.textContent = input.value;
      valueDisplay.style.marginLeft = '0.5em';
      input.addEventListener('input', function () {
        valueDisplay.textContent = input.value;
      });
      // Label wrapping happens after the type branches;
      // input and valueDisplay will both be appended below
      labelEl._rangeOutput = valueDisplay;
    } else if (type === 'select') {
      input = document.createElement('select');
      input.name = key;
      if (opts.options) {
        for (const opt of opts.options) {
          const option = document.createElement('option');
          option.value = opt[0];
          option.textContent = opt[1];
          if (opts.default !== undefined && String(opt[0]) === String(opts.default)) {
            option.selected = true;
          }
          input.appendChild(option);
        }
      }
      applyAttrs(input, opts.attrs);
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.name = key;
      if (opts.default !== undefined) input.value = opts.default;
      applyAttrs(input, opts.attrs);
    } else if (type === 'radio') {
      // Radio: fieldset with legend
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = labelText;
      if (opts.tooltip) legend.setAttribute('data-tooltip', opts.tooltip);
      fieldset.appendChild(legend);

      if (opts.options) {
        for (const opt of opts.options) {
          const radioLabel = document.createElement('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = key;
          radio.value = opt[0];
          if (opts.default !== undefined && String(opt[0]) === String(opts.default)) {
            radio.checked = true;
          }
          radioLabel.appendChild(radio);
          radioLabel.appendChild(document.createTextNode(' ' + opt[1]));
          fieldset.appendChild(radioLabel);
        }
      }
      return fieldset;
    } else {
      return null; // Unknown type
    }

    // Wrap in label for most types
    labelEl.appendChild(input);
    if (labelEl._rangeOutput) {
      labelEl.appendChild(labelEl._rangeOutput);
    }
    return labelEl;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
  }
```

- [ ] **Step 2: Add `renderForm()` and `handleHash()` after `loadComponents()`**

Find `renderForm()` stub and replace, add `handleHash()`:

```js
  function renderForm() {
    for (const comp of components) {
      const details = document.createElement('details');
      details.id = comp.id;

      const summary = document.createElement('summary');
      summary.textContent = comp.label;
      details.appendChild(summary);

      if (comp.fields) {
        for (const field of comp.fields) {
          const fieldEl = createField(field);
          if (fieldEl) details.appendChild(fieldEl);
        }
      }

      configForm.appendChild(details);
    }
  }

  function handleHash() {
    function openHash() {
      if (location.hash) {
        const el = document.getElementById(location.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    }
    window.addEventListener('hashchange', openHash);
    openHash();
  }
```

- [ ] **Step 3: Full verification**

Serve the page and open in browser. Expected:
- Nav shows all components
- Accordion sections render with correct form controls
- Text inputs, password, select, radio, switch, range all render correctly
- Range shows live value display
- Tooltips appear on hover
- Edge cases (empty fields array, missing opts, unknown type) don't crash
- Clicking nav links opens the corresponding accordion section

---

### Task 5: Minification setup

**Files:**
- Create (deployment artifact): `app.min.js`

- [ ] **Step 1: Create package.json for minification tooling**

Write to `/config/workspace/pico-website/package.json`:

```json
{
  "name": "pico-website",
  "private": true,
  "scripts": {
    "build": "terser app.js -o app.min.js -c -m"
  },
  "devDependencies": {
    "terser": "^5.0.0"
  }
}
```

- [ ] **Step 2: Build minified output**

Run:

```bash
npm install && npm run build
```

Expected: `app.min.js` created, roughly 1/3 the size of `app.js`.

- [ ] **Step 3: Verify minified version works**

Open `index.html` in a browser after temporarily changing the script tag to load `app.min.js`. Same behavior as the unminified version.

---

## Self-Review Checklist

- [x] **Spec coverage:** Every major spec section (filesystem layout, manifest JSON, component JSON schema, JS loading flow, field rendering, hash nav, error handling, tooltips, accordion behavior) has corresponding tasks.
- [x] **Placeholder scan:** No TODOs, TBDs, or vague instructions. Every code block is complete. Every command is exact.
- [x] **Type consistency:** `manifest.json` format matches what `loadManifest()` parses. Component JSON schema matches `createField()`'s positional array format. Method names consistent across tasks.
- [x] **No form submission:** Explicitly deferred per spec — no tasks implement it. Consistent with spec.
