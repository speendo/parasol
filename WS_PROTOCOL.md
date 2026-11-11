# WebSocket Protocol Reference

The single WebSocket endpoint at `/api/events` carries both settings and status
data, multiplexed by a `type` field (server to client) or `action` field
(client to server).

## Connection

- **URL:** `ws://<device-ip>/api/events`
- **Lifecycle:** Browser opens at page load. Server pushes status then settings.
  On disconnect, browser shows retry button. On reconnect, server re-sends
  status then settings.
- **Queue policy:** a client whose send queue fills is disconnected rather than
  silently losing messages (`setCloseClientOnQueueFull(true)`). The page
  reconnects with backoff, so a stalled reader recovers instead of drifting
  stale.

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

Ordinary pushes carry **no `i`**: they are broadcast to every client and carry
no per-client bookkeeping. Only the reply to an `action:"sync"` request
(see below) carries the requester's `i`.

```json
{
  "type": "settings",
  "_meta": {"dirty": true, "show_reset": true, "show_reboot": true, "uploading": false},
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

**`_meta`:** Object carrying the current meta state: `dirty`, `show_reset`,
`show_reboot`, and `uploading`. This is the only meta container; there are no
top-level meta keys.

**`uploading` (inside `_meta`):** Boolean owned by the server, device-global.
`true` from an upload's first `META` until its `END`/`ABORT`, and present in
**every** settings payload even for endpoints with no file fields. A tab that
connects mid-upload receives `true` in its initial settings push.

**`dirty`:** Boolean owned by the server. `true` when at least one applied
value differs from the stored (NVS) value. Drives the Save button: enabled
only when dirty is true AND all form fields pass validation.

**`show_reset`:** Boolean owned by the server. `true` when an `on_reset`
callback was registered at `prsl_init()`. Drives the Reset button visibility
in the footer. Independent of `dirty` — the button is always visible when
a reset callback exists.

**`show_reboot`:** Boolean owned by the server. `true` when an `on_reboot`
callback was registered at `prsl_init()`. Adds a "Reboot" action to the header
device menu (the ☰ button) with a confirmation dialog. When no actions exist
and the nav is not collapsed, the ☰ is hidden.

**`label`:** Optional key within each group object. If present, used as the
accordion section title. If absent, the group ID is title-cased (e.g.,
`"gpio"` to `"Gpio"`, `"audio_interface"` to `"Audio Interface"`).

### `type: "ack"`

Sent to the sender of an `apply`, never broadcast. Every apply gets **exactly
one** ack — including no-ops, unknown keys, file fields, and all-rejected
applies. It is written **before** the settings broadcast the apply produces.

```json
{
  "type": "ack",
  "i": 7,
  "d": {"wifi.ssid": "NewName", "wifi.mode": "station"},
  "e": {"wifi.mode": "rejected"}
}
```

- **`i`:** the id of the batch being answered, echoed from the apply.
- **`d`:** decided values, flat `"group.key"` → value. Each value is **read
  back from the store after applying**, not copied from what `on_set` intended.
  A transform therefore reports the stored value, a discard reports the old
  value, and a field whose `on_set` wrote nothing reports what is actually
  stored. Keys that exist in the store get an entry; keys that do not exist are
  omitted. Omission means "no value to report", and the client leaves the
  applied value unchanged.
- **`e`:** per-key failures, flat key → short reason. 0.9.0 always emits
  `"rejected"`. At most one key per batch, because both the WS apply path and
  Save abort on the first rejection: fields before the bad one were written,
  fields after it were never attempted, and `d` reports their unchanged stored
  values.
- **A rejected key appears in both `d` and `e`.** `d` carries the value the
  store still holds for it (the example's `"wifi.mode": "station"` is the old
  value, unchanged by the failed write); `e` carries the failure. The client
  branches on `e` first, so the rejection wins over the stored value.

A correlated rejection is reported as a failure only in `e` — no second
`type:"error"` message follows. A batch that reaches an ack but cannot be
applied at all (`data` is not an object) gets the ack **and** a `type:"error"`;
unparsable input has no readable `i` and gets `type:"error"` alone.

### `type: "error"`

Sent on processing errors and protocol errors (for example an `apply` with no
numeric `i`).

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
  "i": 7,
  "data": {
    "wifi": {
      "ssid": ["text", "SSID", {"value": "NewNetworkName"}]
    }
  }
}
```

**`i` is required and numeric.** It is a positive integer chosen by the client,
meaningful only for the connection that sent it: it is not a version and not
device-global. The server never stores it and never uses it as a precondition
for applying a value; it only echoes it in the `ack`. **A missing or
non-numeric `i` is a protocol error:** the batch is not applied, nothing is
broadcast, and the sender gets `type:"error"`. No ack is possible, because
there is nothing to correlate to.

**Why partial?** Sending only changed fields minimizes wire overhead (ESP32 is
CPU- and bandwidth-constrained). The server merges the partial update into its
store.

**Multi-field apply:** A raw client may batch multiple fields under one `i`; the
ack reports every key in the message. The bundled browser sends one apply per
field, each with its own `i`:

```json
{
  "action": "apply",
  "i": 8,
  "data": {
    "wifi": {
      "ssid": ["text", "SSID", {"value": "NewName"}],
      "pass": ["password", "Password", {"value": "newpass123"}]
    }
  }
}
```

### `action: "sync"`

Requests a full settings payload, for recovery only — it is **not** a polling
mechanism.

```json
{
  "action": "sync",
  "i": 9
}
```

The reply is the standard `type:"settings"` payload sent **to the requester
only**, carrying the same `i`:

```json
{"type": "settings", "i": 9, "_meta": {"dirty": true, "show_reset": true, "show_reboot": true, "uploading": false}, "data": {}}
```

Ordinary broadcasts carry no `i`, so a reply is recognized exactly rather than
as "the next push after I asked" — the user can start a new batch before the
reply arrives. The sync id is drawn from the same per-connection counter as
batch ids, so the two spaces never collide. A `sync` without a numeric `i` gets
`type:"error"` and no reply. It mutates nothing and triggers no broadcast.

## State Machine Summary

The browser tracks per-field state to handle concurrent edits, external
updates, and the outcome of its own applies:

| State | Meaning | Browser Behavior |
|---|---|---|
| **Idle** | FV = LS = AV, no batch pending for the field | No action |
| **Local Input** | User changed the field, batch not yet answered | Send FV with a fresh `i`; set inFlight = true |
| **External Update** | Server pushed a value the user hasn't changed | Show notification: "Load" or "Keep" |
| **Coincidental Sync** | Server pushed the same value the user was about to send | Silent sync, no notification |
| **Collision** | User changed the field AND the server pushed a different value | Prompt: "Keep all local" or "Accept all server" |
| **Ack Received** | `type:"ack"` for the batch arrived | Clear inFlight; adopt `d` (which may differ from what was sent) |
| **Rejected** | Ack `e` names the key | Revert to AV, show the rejection, keep the field retryable |
| **Recovering** | Batch timed out; the store's contents are unknown | Ask once with `action:"sync"`, then resend at most once if the store does not hold the sent value |

**Legend:** FV = Form Value (what the user sees), LS = Last Sent (the last value
sent for the field, updated to the decided value on ack), AV = Applied Value
(what the server reports), inFlight = no answer yet for this field.

For the full design — the timeout, the sync request, and the bounded resend —
see the
[client ack-correlation design](docs/superpowers/specs/2026-11-11-client-ack-correlation-design.md).

### Recovery and `ack_timeout_ms`

A batch with no ack within `ack_timeout_ms` (default **5000 ms**, set via
`parasol_config.json` and rendered into the page as
`<meta name="parasol-ack-timeout">`) enters **Recovering**: the client asks once
with `action:"sync"` and resends at most once per key if the store does not hold
the sent value. If the sync goes unanswered the field is left unsent — the
ladder is finite by design and has no further retries.

A too-small timeout degrades visibly: the late ack is ignored, and the user's
own change arrives in the broadcast with nothing in flight, so it reads as an
external update (Load/Keep).

## HTTP Endpoints (Fallback)

When WebSocket is unavailable (slow connection, initial load race), the browser
falls back to HTTP:

| Method | Path | Purpose | Body |
|---|---|---|---|
| `POST` | `/api/settings/save` | Persist settings to NVS | Partial settings JSON |
| `POST` | `/api/settings/reset` | Reload saved values | — |
| `POST` | `/api/system/reboot` | Restart device | — |
| `POST` | `/api/upload/<group>/<key>` | Preflight a file upload (advisory) | `{"name","size","type"}` JSON |
| `PUT` | `/api/upload/<group>/<key>?name=…&type=…` | Stream a raw file body | binary, `Content-Type: application/octet-stream` |


