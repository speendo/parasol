# ESP32 Modular Configuration UI

## Overview

A web-based configuration interface hosted on an ESP32 (ESP-IDF + ESPAsyncWebServer). Components (e.g., WiFi, GPIO, sensors) each define their settings in a standalone JSON file. A lightweight client-side JS driver fetches these definitions and builds the UI dynamically — nav links and an accordion form. Settings are POSTed back to the ESP32 as JSON.

## Filesystem Layout

```
/
├── index.html              # Skeleton: Pico CSS, empty <nav>, empty <form>, includes app.js
├── app.js                  # Readable source JS driver (minified → app.min.js for deployment)
├── pico.jade.min.css       # Pico CSS
├── manifest.json           # Registry of all components
└── components/
    ├── wifi.json
    └── gpio.json
```

## Manifest JSON

`/manifest.json` is fetched first. It defines the component list — nav links and accordion sections appear in this order. Entries missing their JSON file are silently skipped.

```json
[
  {"id": "wifi", "label": "WiFi Configuration", "file": "components/wifi.json"},
  {"id": "gpio",  "label": "GPIO Settings",      "file": "components/gpio.json"}
]
```

- `id`: `<details>` element ID, anchor hash, and POST grouping key
- `label`: nav link text and `<summary>` text
- `file`: path to component's setting definitions

## Component JSON Schema

Each file defines form fields as an array of entries using a compact positional format:

```
[ key, type, label, { options?, default?, attrs?, tooltip? } ]
```

| Pos | Field | Required | Description |
|-----|-------|----------|-------------|
| 0   | key   | yes | Form input `name` attribute; POST key |
| 1   | type  | yes | HTML input type or widget name |
| 2   | label | yes | Human-readable label |
| 3   | obj   | no  | Optional fields (full names, no abbreviations) |

### Supported types

HTML input types (render as `<input type="...">`): `text`, `email`, `number`, `password`, `tel`, `url`, `color`, `range`.

Widget types: `select`, `textarea`, `checkbox`, `radio`, `switch`.

### Optional object fields

| Key | Type | Applies to | Description |
|-----|------|------------|-------------|
| `options` | `[[value, label], ...]` | select, radio | Options as value-label pairs |
| `default` | any | all | Default/initial value |
| `attrs` | object | all | Flat HTML attributes (placeholder, maxlength, pattern, min, max, step, required, disabled, readonly, rows, cols, autocomplete, aria-label, etc.) |
| `tooltip` | string | all | Tooltip text; applied as `data-tooltip` on the label |

### Examples

```json
["hostname", "text", "Hostname", {"attrs": {"maxlength": 64, "placeholder": "my-device"}, "default": "", "tooltip": "Device hostname"}]

["mode", "select", "Mode", {"options": [["station", "Station"], ["ap", "Access Point"]], "default": "station"}]

["enabled", "switch", "Enabled", {"default": true}]

["threshold", "range", "Threshold", {"attrs": {"min": 0, "max": 100, "step": 1}, "default": 50}]

["accent", "color", "Accent Color", {"default": "#3366cc"}]

["notes", "textarea", "Notes", {"attrs": {"rows": 4, "placeholder": "Enter notes..."}}]

["phone", "tel", "Phone", {"attrs": {"autocomplete": "tel", "placeholder": "+1 555...", "required": true}}]

["level", "radio", "Level", {"options": [["low", "Low"], ["med", "Medium"], ["high", "High"]], "default": "med"}]
```

## Client-Side JS Architecture

### Loading flow

1. Fetch `/manifest.json`
2. Build `<nav>` — one link per component, `href="#component-id"`
3. For each manifest entry, fetch the component JSON file
4. Build `<details id="component-id">` with `<summary>` + form fields
5. On load/hash change: auto-open the `<details>` matching `location.hash`

If a component JSON fails to load, that component is silently skipped (no nav link, no accordion section).

### Accordion behavior

Multiple sections can be open simultaneously. `<details>` elements have no `name` attribute (or unique IDs) so the native single-open constraint does not apply.

### Field rendering

A single `createField` function handles all types:

- `type` is an HTML input type → `<input type="{type}">`, apply `attrs`
- `type === "select"` → `<select>` with `<option>` per `[value, label]` pair
- `type === "textarea"` → `<textarea>`, apply `attrs`
- `type === "checkbox"` → `<input type="checkbox">`
- `type === "radio"` → `<input type="radio">` per option
- `type === "switch"` → `<input type="checkbox" role="switch">`

Each field is wrapped in a `<label>` (or `<fieldset>` for radio). The generated DOM structure follows Pico CSS conventions.

### Tooltips

Tooltips use Pico CSS's built-in `data-tooltip` attribute, applied to the label element. Direction defaults to top.

### Code size

`app.js` is written as readable, well-commented source. It is minified to `app.min.js` for deployment on the ESP32 (target: ~3-4 KB minified, ~1-2 KB gzipped).

## Error Handling

- Manifest fetch fails → display inline error: "No components found"
- Individual component JSON fails → silently skip that component
- POST /save fails → brief inline error banner (no alert dialog)

## Form Submission (deferred)

Placeholder — detailed design for `POST /save` to be completed in a later iteration.
