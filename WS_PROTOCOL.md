# WebSocket Protocol Reference

The single WebSocket endpoint at `/api/events` carries both settings and status
data, multiplexed by a `type` field (server to client) or `action` field
(client to server).

## Connection

- **URL:** `ws://<device-ip>/api/events`
- **Lifecycle:** Browser opens at page load. Server pushes status then settings.
  On disconnect, browser shows retry button. On reconnect, server re-sends
  status then settings.

## Server to Client Messages

### `type: "status"`

Sent on initial connect and periodically thereafter (typically every 3 seconds
via `prsl_broadcast_status`). Contains read-only telemetry data.

```json
{
  "type": "status",
  "data": {
    "system": {
      "uptime":     ["text", "Uptime",     {"value": "42s"}],
      "fw_version": ["text", "Firmware",   {"value": "v1.2.3"}]
    },
    "network": {
      "mode":       ["select", "Mode",     {"value": "station",
                                            "options": [["station","Station"],["ap","AP"]]}],
      "signal":     ["text", "Signal",     {"value": "-47 dBm"}],
      "connection": ["text", "Connected",  {"value": "yes"}]
    },
    "sensors": {
      "temperature": ["text", "Temperature", {"value": "23.5 C"}]
    }
  }
}
```

**Field format:** Each field under a group is a 3-element JSON array:

```
[type_string, label_string, opts_object]
```

where `opts` contains at minimum `"value"`, and optionally `"options"` (for
select/radio), `"attrs"` (HTML validation attributes), and `"help"` (help
text). For the full field format reference, see the architecture spec.

**Rendering:** Status fields render as disabled `<input>` elements with DOM
names prefixed by `st-` (e.g., `name="st-system.uptime"`). The prefix prevents
name collisions when a status and settings group share the same `id`.

### `type: "settings"`

Sent on initial connect, reconnect, and after any settings change (push or
apply). Contains the full settings state.

```json
{
  "type": "settings",
  "_dirty": true,
  "_show_reset": true,
  "_show_reboot": true,
  "data": {
    "wifi": {
      "label": "Wi-Fi Setup",
      "ssid":     ["text",     "SSID",     {"value": "MyNetwork",
                                            "attrs": {"required":true,"maxlength":32},
                                            "help": "Network name - 1-32 characters"}],
      "pass":     ["password", "Password", {"value": "",
                                            "attrs": {"maxlength":64},
                                            "help": "WiFi password - up to 64 characters"}],
      "mode":     ["select",   "Mode",     {"value": "station",
                                            "options": [["station","Station"],["ap","Access Point"]]}]
    },
    "gpio": {
      "pin":       ["number", "Pin Number",  {"value": "2",
                                              "attrs": {"min":0,"max":39}}],
      "direction": ["select", "Direction",   {"value": "output",
                                              "options": [["input","Input"],["output","Output"]]}],
      "initial":   ["select", "Initial State", {"value": "low",
                                                "options": [["low","Low"],["high","High"]]}]
    }
  }
}
```

**`_dirty`:** Boolean owned by the server. `true` when at least one applied
value differs from the stored (NVS) value. Drives the Save button: enabled
only when `_dirty` is true AND all form fields pass validation.

**`_show_reset`:** Boolean owned by the server. `true` when an `on_reset`
callback was registered at `prsl_init()`. Drives the Reset button visibility
in the footer. Independent of `_dirty` — the button is always visible when
a reset callback exists.

**`_show_reboot`:** Boolean owned by the server. `true` when an `on_reboot`
callback was registered at `prsl_init()`. Drives a "System" dropdown in the
nav bar containing a "Reboot" option with a confirmation dialog.

**`label`:** Optional key within each group object. If present, used as the
accordion section title. If absent, the group ID is title-cased (e.g.,
`"gpio"` to `"Gpio"`, `"audio_interface"` to `"Audio Interface"`).

### `type: "error"`

Sent on processing errors.

```json
{
  "type": "error",
  "message": "Failed to apply setting: wifi.ssid exceeds max length"
}
```

The browser displays the message in a notification bar. The form remains
usable — error messages don't block further interaction.

## Client to Server Messages

### `action: "apply"`

Sent automatically when the user blurs a modified field (text/password/email)
or changes a value (select/range/number/checkbox/switch). Contains only the
changed fields, never the full settings object.

```json
{
  "action": "apply",
  "data": {
    "wifi": {
      "ssid": ["text", "SSID", {"value": "NewNetworkName"}]
    }
  }
}
```

**Why partial?** Sending only changed fields minimizes wire overhead (ESP32 is
CPU- and bandwidth-constrained). The server merges the partial update into its
store.

**Multi-field apply:** If the user changes multiple fields between WS sends,
the browser batches them:

```json
{
  "action": "apply",
  "data": {
    "wifi": {
      "ssid": ["text", "SSID", {"value": "NewName"}],
      "pass": ["password", "Password", {"value": "newpass123"}]
    }
  }
}
```

## State Machine Summary

The browser tracks per-field state to handle concurrent edits, external
updates, and echo resolution:

| State | Meaning | Browser Behavior |
|---|---|---|
| **Idle** | FV = LS = AV, inFlight = false | No action |
| **Local Input** | User changed field, not yet confirmed | Send FV to server; set inFlight = true |
| **External Update** | Server pushed new value, user hasn't changed it | Show notification: "Load" or "Keep" |
| **Coincidental Sync** | Server echoed the same value user was about to send | Silent sync, no notification |
| **Collision** | User changed field AND server pushed different value | Prompt: "Keep all local" or "Accept all server" |
| **Echo Received** | Server confirmed user's change | Clear inFlight = false |

**Legend:** FV = Form Value (what user sees), LS = Last Sent (last value sent
to server), AV = Applied Value (what server reports), inFlight = waiting for
server echo.

For the full state machine with all 10 cases, see the
[architecture spec](docs/superpowers/specs/2026-06-18-unified-settings-design.md).

## HTTP Endpoints (Fallback)

When WebSocket is unavailable (slow connection, initial load race), the browser
falls back to HTTP:

| Method | Path | Purpose | Body |
|---|---|---|---|
| `POST` | `/api/settings/save` | Persist settings to NVS | Partial settings JSON |
| `POST` | `/api/settings/reset` | Reload saved values | — |
| `POST` | `/api/system/reboot` | Restart device | — |


