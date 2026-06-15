# Footer Action Buttons for ESP32 Config UI

## Overview

Add three action buttons to the footer of the ESP32 configuration page — Save & Store (to NVS), Apply Only (without storing), and Reset (revert to NVS defaults). A pending-changes tracking system enables/disables buttons based on whether the form differs from the current NVS baseline.

## API Contract

The ESP32 exposes two POST endpoints. Only pending keys are sent in the body.

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/save` | `{ "wifi.ssid": "...", "gpio.pin": 5 }` | `{"ok": true}` or `{"error": "..."}` |
| `POST` | `/api/apply` | same format | same |

## Qualified Field Naming

Form inputs use `component.key` as their `name` attribute. E.g., `name="wifi.ssid"`, `name="gpio.pin"`. This enables flat key-value serialization without extra DOM traversal or mapping tables.

- `createField()` takes a `prefix` parameter (the `comp.id`) and sets `name = prefix + '.' + key`
- `renderForm()` passes `comp.id` as the prefix when creating each section
- Component JSON files keep their compact `[key, type, label, opts]` format unchanged

## Pending Changes Detection

Pending = the form differs from the last fetched NVS baseline.

- `serialize()` — reads all form inputs, returns `{ "wifi.ssid": "...", "gpio.pin": 5, ... }`
- `baseline` — snapshot of `serialize()` taken after the last successful config fetch
- `getPending()` — returns only keys where `serialize()[k] !== baseline[k]`, or `{}` if clean. A slider moved from 20 to 25 then back to 20 = `{}` (no pending change). `hasPending` is derived by checking `Object.keys(getPending()).length > 0`.
- Change listeners on all inputs call `updateUI()` which re-evaluates pending state via `getPending()`.

## Shared Functions

All shared functions operate on the loaded component definitions array:

- `populateFromComponents(components)` — walks each component's field defs, finds the DOM input by `name="<id>.<key>"`, sets `.value` or `.checked` from the field's `default`
- `setBaseline()` — calls `serialize()`, stores result as `baseline`
- `serialize()` — gathers all form input values into a flat key-value object
- `getPending()` — returns only keys where current value differs from baseline, or `{}` if clean
- `refreshComponents()` — re-fetches all component JSON files, updates `components[N].fields` in place
- `postJSON(url, data)` — shared POST wrapper for both `/api/save` and `/api/apply`
- `syncThen(doPopulate)` — shared post-action refresh: re-fetches JSONs, optionally populates form, re-baselines
- `updateUI()` — toggles button `disabled` and footer `.pending` class based on `getPending()`

## Button Behaviors

All three buttons are in the `<footer>`. Enabled when `hasPending()`, disabled otherwise.

| Button | Label | Pico class | Action | On success |
|--------|-------|------------|--------|------------|
| Save & Apply | "Save & Apply" | `contrast` | `POST /api/save` with `getPending()` | Refresh components → `populateFromComponents()` → `setBaseline()` |
| Apply | "Apply" | `primary` | `POST /api/apply` with `getPending()` | Refresh components → `setBaseline()` (skip populate — form retains applied values) |
| Reset | "Reset" | `secondary` | — | Refresh components → `populateFromComponents()` → `setBaseline()` |

After all three: refresh the status bar with success/error feedback.

## Sticky Footer

When `hasPending()` is true, the footer gets a `.pending` class that makes it sticky to the bottom of the viewport:

```css
footer.pending {
  position: sticky;
  bottom: 0;
  z-index: 10;
  background: var(--pico-background-color);
  box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
}
```

When there are no pending changes, the footer stays in normal document flow.

## Footer Layout

The existing `<footer>` is restructured with a left-aligned status bar and right-aligned button group (`<div role="group">`) using flex layout. Buttons use Pico CSS color classes: "Save & Apply" = `contrast`, "Apply" = `primary`, "Reset" = `secondary`.

## Init Flow

1. Load manifest → load component JSONs → render nav + accordion form (existing)
2. `populateFromComponents(components)` — set form inputs from JSON defaults
3. `setBaseline()` — capture initial state
4. Bind input/change listeners for pending detection
5. `handleHash()` (existing)

## File Changes

- **`index.html`** — restructure footer with button container
- **`app.js`** — add qualified naming in `createField()`, shared functions, API layer, button bindings, pending detection, sticky footer CSS via inline `<style>`
- **`app.min.js`** — rebuild from source

## Error Handling

- Network failure on POST → status bar error, buttons remain enabled for retry
- `GET` failure (component JSON) → status bar error, form retains last known state
- ESP returns `{"error": "..."}` → display error in status bar
