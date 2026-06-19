# Settings JSON Format (`/api/settings`)

## Response Shape

Top-level keys are component groups. Underscore-prefixed keys (`_dirty`) are meta
fields, never components. Each component key maps to an object whose values are
field arrays.

```json
{
  "_dirty": false,
  "wifi": {
    "ssid":     ["text", "SSID",     {"value": "MyNetwork", "tooltip": "WiFi network name"}],
    "password": ["password", "Password", {"value": "", "attrs": {"maxlength": 64}}],
    "mode":     ["select", "Mode",   {"value": "station", "options": [["station","Station"],["ap","Access Point"]]}]
  }
}
```

## Field Array

```
[type, label, opts]
```

- **type** — one of: `text`, `number`, `password`, `email`, `tel`, `url`, `color`,
  `checkbox`, `switch`, `radio`, `select`, `range`, `textarea`
- **label** — display name for the form field
- **opts** — dictionary:
  - `value` — current applied value
  - `options` — for `select`/`radio`: `[["key1", "Label 1"], ...]`
  - `attrs` — HTML attributes: `{min, max, maxlength, step, placeholder}`
  - `tooltip` — help text string

## Meta Fields

- `_dirty` (bool) — server-owned. `true` when applied settings ≠ stored (NVS) settings.

## Component Discovery

JS iterates top-level keys, skipping `_`-prefixed keys. Each key becomes a
section. The label is derived from the key name: split on underscores, hyphens,
or camelCase boundaries, capitalize first letter, join with spaces.

## Partial Updates (POST / WS)

Only changed fields are sent, preserving the same nested structure:

```json
{"wifi": {"ssid": ["text", "SSID", {"value": "NewNetwork"}]}}
```
