# Form Validation for ESP32 Config UI

## Overview

Add client-side form validation to the ESP32 configuration page. Validation rules are already declared via HTML attributes (`required`, `min`, `max`, `pattern`, `minlength`, `maxlength`) in the `attrs` field of component JSON schemas. This spec adds the feedback and gating layer to surface those rules to the user.

## Validation Declarations

Validation rules stay in the existing `attrs` object within each field's JSON definition. No new schema fields are added. Example from `components/wifi.json`:

```json
["ssid", "text", "SSID", {"attrs": {"maxlength": 32, "placeholder": "MyNetwork", "required": true}, "default": "", "tooltip": "WiFi network name"}]
```

Supported HTML5 constraints: `required`, `min`, `max`, `minlength`, `maxlength`, `pattern`, `step`, `type` (email, url, number, etc.).

## Visual Feedback

Pico CSS applies `:invalid` styling (red borders, etc.) natively via the browser's built-in Constraint Validation API. No additional CSS needed.

## Lightweight JS Directive

The app is served by an ESP32 with minimal resources. JS size (after minification) is a priority concern. When multiple approaches exist, choose the one with fewer characters and bytes. Prefer DRY code that avoids repetition, but don't sacrifice readability to premature micro-optimization — the minifier handles compression.

## Validation Messages on Blur

When a user leaves an invalid field (blur event), fire `el.reportValidity()` to show the native HTML5 validation popup tooltip. Added as a blur listener in `createField()`. To keep code size low, this should reuse existing patterns and avoid adding new helper functions unless they save net bytes.

## Button Gating

Buttons only enable when both conditions are true:
- There are pending changes (`getPending()` returns non-empty)
- The form is valid (`configForm.checkValidity()` returns true)

This extends the existing `updateUI()` function with a single additional check that doubles as a code-size optimization — no need for` &&` with early return when the condition can be combined.

## File Changes

- **`app.js`** — add blur listener for `reportValidity()` in `createField()`, add `configForm.checkValidity()` check to `updateUI()`
- **`app.min.js`** — rebuild from source

## Init Flow (unchanged)

1. Load manifest → load component JSONs → render nav + accordion form
2. `populateFromComponents(components)` — set form inputs from JSON defaults
3. `setBaseline()` — capture initial state
4. Bind input/change listeners for pending detection
5. `handleHash()` (existing)

## Error Handling

- Browser native validation messages are shown per-field via `reportValidity()` on blur
- Invalid forms prevent button enablement — user must correct all errors before Save/Apply
- Server-side validation is not addressed here (assumed to exist on ESP32 side)
