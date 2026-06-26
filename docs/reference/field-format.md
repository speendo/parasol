# Field Array Format

Every form field on the wire is a 3-element JSON array:

```
[type, label, opts]
```

Used for both **settings** and **status** messages over HTTP and WebSocket.

## Field Array Elements

| Position | Name | Type | Description |
|----------|------|------|-------------|
| `[0]` | type | string | Form element type (see below) |
| `[1]` | label | string | Display label for the field |
| `[2]` | opts | object | Options dictionary (see below) |

## Supported Types

| Type | HTML Element | Editable | Used In |
|------|-------------|----------|---------|
| `text` | `<input type="text">` | yes | settings, status |
| `number` | `<input type="number">` | yes | settings, status |
| `password` | `<input type="password">` | yes | settings only |
| `email` | `<input type="email">` | yes | settings only |
| `tel` | `<input type="tel">` | yes | settings only |
| `url` | `<input type="url">` | yes | settings only |
| `color` | `<input type="color">` | yes | settings only |
| `textarea` | `<textarea>` | yes | settings only |
| `select` | `<select>` | yes | settings, status |
| `switch` | `<input type="checkbox" role="switch">` | yes | settings, status |
| `checkbox` | `<input type="checkbox">` | yes | settings, status |
| `radio` | `<input type="radio">` group | yes | settings, status |
| `range` | `<input type="range">` | yes | settings, status |

**Status fields** are always rendered `disabled`. Their values update via
WebSocket push — user interaction is blocked.

## opts Dictionary

| Key | Type | Applies To | Description |
|-----|------|-----------|-------------|
| `value` | any | all | Current value (type-coerced by the client) |
| `options` | `[["key","Label"],...]` | select, radio | Allowed options as `[value, label]` pairs |
| `attrs` | object | all | HTML attributes e.g. `{min, max, step, maxlength, placeholder}` |
| `help` | string | all | Helper text shown below the field |

### value Coercion

| Type | JS Value |
|------|----------|
| `switch` | boolean (`el.checked`) |
| `checkbox` | boolean or null (`el.indeterminate ? null : el.checked`) |
| `radio` | string (selected option's value) |
| `number`, `range` | number (`parseFloat`) |
| all others | string (`el.value`) |

## Settings Payload

Settings messages include the `_dirty` meta field:

```json
{
  "_dirty": false,
  "wifi": {
    "ssid":     ["text", "SSID",     {"value": "MyNetwork", "tooltip": "WiFi network name"}],
    "password": ["password", "Password", {"value": "", "attrs": {"maxlength": 64}}],
    "mode":     ["select", "Mode",   {"value": "station", "options": [["station","Station"],["ap","Access Point"]]}],
    "hidden":   ["switch", "Hidden SSID", {"value": false, "tooltip": "Hide network from scans"}],
    "channel":  ["range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "value": 6, "tooltip": "WiFi channel number"}]
  },
  "gpio": {
    "pin":       ["number", "Pin Number",  {"attrs": {"min": 0, "max": 39}, "value": 2, "tooltip": "GPIO pin number"}],
    "direction": ["select", "Direction",   {"options": [["input","Input"],["output","Output"]], "value": "output"}],
    "pull":      ["radio", "Pull Resistor",{"options": [["none","None"],["up","Pull Up"],["down","Pull Down"]], "value": "none"}],
    "enabled":   ["switch", "GPIO Enabled",{"value": true, "tooltip": "Enable this GPIO pin"}],
    "inverted":  ["switch", "Inverted",    {"value": false, "tooltip": "Invert GPIO signal level"}],
    "initial":   ["select", "Initial State",{"options": [["low","Low"],["high","High"]], "value": "low"}]
  }
}
```

`_dirty` is `true` when applied settings differ from stored (NVS) settings.

## Status Payload

Status messages have **no** `_dirty` field. All fields render as disabled.

```json
{
  "type": "status",
  "data": {
    "system": {
      "uptime":     ["text", "Uptime",    {"value": "1d 2h 30m 15s"}],
      "fw_version": ["select", "Firmware",{"options": [["2.0.0","2.0.0"],["2.1.0","2.1.0"],["2.2.0-beta","2.2.0-beta"]], "value": "2.1.0"}],
      "led":        ["switch", "LED",     {"value": true, "tooltip": "System LED indicator"}]
    },
    "network": {
      "mode":       ["radio", "Mode",     {"options": [["auto","Auto"],["manual","Manual"],["safe","Safe"]], "value": "auto", "tooltip": "Network operation mode"}],
      "signal":     ["range", "Signal",   {"attrs": {"min": 0, "max": 100, "step": 1}, "value": "75", "tooltip": "Signal strength %"}],
      "connection": ["select", "Connection",{"options": [["connected","Connected"],["disconnected","Disconnected"],["error","Error"]], "value": "connected"}]
    },
    "sensors": {
      "temperature": ["number", "Temperature", {"value": "23.5", "tooltip": "Celsius"}]
    }
  }
}
```

## Partial Updates

Both settings and status support partial payloads — only changed fields are sent:

```json
{"wifi": {"ssid": ["text", "SSID", {"value": "NewNetwork"}]}}
```

The client walks the data tree, finds matching component + field by key,
updates `field.opts.value`, and re-renders the DOM.
