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
| `file` | file input + Upload button | no (read-only label) | settings only |

**Status fields** are always rendered `disabled`. Their values update via
WebSocket push — user interaction is blocked.

**File fields** are settings-only. The browser renders them read-only and never
sends their value in an apply or save body; the value is a developer-defined
file label updated only server-side. The full per-field-type options matrix is
deferred to `docs/BACKLOG.md`.

## opts Dictionary

| Key | Type | Applies To | Description |
|-----|------|-----------|-------------|
| `value` | any | all | Current value (type-coerced by the client). For `file`: the read-only label. |
| `options` | `[["key","Label"],...]` | select, radio | Allowed options as `[value, label]` pairs |
| `accept` | string | file | HTML file-input filter (extensions and/or MIME types). A UI/policy hint, not security. Omitted when unset. |
| `max_size` | number | file | Device-enforced byte limit. `0` = no limit. Omitted when unset. |
| `attrs` | object | all | HTML attributes e.g. `{min, max, step, maxlength, placeholder}` |
| `help` | string | all | Helper text shown below the field |

`idle_timeout_ms` is a device-only option: it is never sent on the wire and has
no `opts` key here. `accept` and `max_size` are emitted only when set; they are
typed and must not be smuggled through `attrs`.

### value Coercion

| Type | JS Value |
|------|----------|
| `switch` | boolean (`el.checked`) |
| `checkbox` | boolean or null (`el.indeterminate ? null : el.checked`) |
| `radio` | string (selected option's value) |
| `number`, `range` | number (`parseFloat`) |
| all others | string (`el.value`) |

## Settings Payload

Settings messages carry a top-level `_meta` object with `dirty`, `show_reset`,
`show_reboot`, and `uploading`. This is the only meta container; there are no
top-level meta keys.

```json
{
  "_meta": {"dirty": false, "show_reset": true, "show_reboot": true, "uploading": false},
  "wifi": {
    "ssid":     ["text", "SSID",     {"value": "MyNetwork", "help": "WiFi network name"}],
    "password": ["password", "Password", {"value": "", "attrs": {"maxlength": 64}}],
    "mode":     ["select", "Mode",   {"value": "station", "options": [["station","Station"],["ap","Access Point"]]}],
    "hidden":   ["switch", "Hidden SSID", {"value": false, "help": "Hide network from scans"}],
    "channel":  ["range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "value": 6, "help": "WiFi channel number"}]
  },
  "gpio": {
    "pin":       ["number", "Pin Number",  {"attrs": {"min": 0, "max": 39}, "value": 2, "help": "GPIO pin number"}],
    "direction": ["select", "Direction",   {"options": [["input","Input"],["output","Output"]], "value": "output"}],
    "pull":      ["radio", "Pull Resistor",{"options": [["none","None"],["up","Pull Up"],["down","Pull Down"]], "value": "none"}],
    "enabled":   ["switch", "GPIO Enabled",{"value": true, "help": "Enable this GPIO pin"}],
    "inverted":  ["switch", "Inverted",    {"value": false, "help": "Invert GPIO signal level"}],
    "initial":   ["select", "Initial State",{"options": [["low","Low"],["high","High"]], "value": "low"}]
  }
}
```

`_meta.dirty` is `true` when applied settings differ from stored (NVS)
settings.

### File field example

```json
{
  "audio": {
    "label": "Audio",
    "clip": ["file", "Clip", {
      "value": "beep.mp3",
      "accept": ".mp3,audio/*",
      "max_size": 1048576,
      "help": "MP3, up to 1 MiB"
    }]
  }
}
```

## Status Payload

Status messages have **no** `_meta` object. All fields render as disabled.

```json
{
  "type": "status",
  "data": {
    "system": {
      "uptime":     ["text", "Uptime",    {"value": "1d 2h 30m 15s"}],
      "fw_version": ["select", "Firmware",{"options": [["2.0.0","2.0.0"],["2.1.0","2.1.0"],["2.2.0-beta","2.2.0-beta"]], "value": "2.1.0"}],
      "led":        ["switch", "LED",     {"value": true, "help": "System LED indicator"}]
    },
    "network": {
      "mode":       ["radio", "Mode",     {"options": [["auto","Auto"],["manual","Manual"],["safe","Safe"]], "value": "auto", "help": "Network operation mode"}],
      "signal":     ["range", "Signal",   {"attrs": {"min": 0, "max": 100, "step": 1}, "value": "75", "help": "Signal strength %"}],
      "connection": ["select", "Connection",{"options": [["connected","Connected"],["disconnected","Disconnected"],["error","Error"]], "value": "connected"}]
    },
    "sensors": {
      "temperature": ["number", "Temperature", {"value": "23.5", "help": "Celsius"}]
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
