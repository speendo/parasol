# Status Variables

## Motivation

ESP32 devices expose read-only telemetry (uptime, firmware version, LED state,
network mode, signal strength, sensor readings) that users need to see but should never edit.
These "status variables" co-exist with editable settings in the UI but are
sourced from a separate data path and rendered as disabled inputs.

## Constraints

- **Same WS connection, different message type.** A single WebSocket connection
  at `/api/events` carries both `"settings"` and `"status"` messages,
  multiplexed via the existing `msg.type` discriminator.
- **No GET endpoint.** Status is delivered only via WS (initial load + push
  updates). No HTTP fallback.
- **Minimal JS.** Reuse `createField`, `renderForm`, `populateFromComponents`,
  `bindChangeListeners`, `readFormValue` for status fields. Every mutation path
  (`serialize`, `getPending`, `onUserInput`, `sendToServer`) is unchanged —
  status components are stored in a separate array they never iterate.
- **Same wire format** as settings: `[type, label, opts]`. No new field types.
- **partial updates** — server may send only changed fields in subsequent
  status pushes. Client patches the in-memory component tree and updates the
  DOM.

## Rename WS Endpoint

The single WS connection needs a neutral name:

| Old | New |
|---|---|
| `/api/settings/ws` | `/api/events` |

The current endpoint name implies settings-only. `/api/events` is neutral and
extensible. The `msg.type` field (`"settings"`, `"status"`, `"error"`) serves
as the discriminator.

## JSON Format

### Status data (`msg.type === "status"`)

```json
{
  "type": "status",
  "data": {
    "system": {
      "uptime":     ["text",   "Uptime",    {"value": "1d 2h 30m 15s"}],
      "fw_version": ["select", "Firmware",  {"options": [["2.0.0","2.0.0"],["2.1.0","2.1.0"],["2.2.0-beta","2.2.0-beta"]], "value": "2.1.0"}],
      "led":        ["switch", "LED",       {"value": true, "help": "System LED indicator"}]
    },
    "network": {
      "mode":       ["radio",  "Mode",      {"options": [["auto","Auto"],["manual","Manual"],["safe","Safe"]], "value": "auto", "help": "Network operation mode"}],
      "signal":     ["range",  "Signal",    {"attrs": {"min": 0, "max": 100, "step": 1}, "value": "75", "help": "Signal strength %"}],
      "connection": ["select", "Connection",{"options": [["connected","Connected"],["disconnected","Disconnected"],["error","Error"]], "value": "connected"}]
    },
    "sensors": {
      "temperature": ["number", "Temperature", {"value": "23.5", "help": "Celsius"}]
    }
  }
}
```

Same as settings format. Top-level keys become accordion sections. Subsequent
pushes may contain only changed fields (partial).

### Handshake sequence

1. Client connects to `/api/events`
2. Server sends `{"type": "status", "data": {...}}`
3. Server sends `{"type": "settings", "_dirty": false, "data": {...}}`

### Partial update example

```json
{"type": "status", "data": {"network": {"signal": ["range", "Signal", {"value": "80"}]}}}
```

Client walks the `data` tree, finds the matching component + field, updates
`field.opts.value`, and re-renders just that field's DOM element.

## Visual Treatment

- Status accordion sections appear **before** settings sections.
- `<summary>` elements in status sections get `class="secondary"` (Pico CSS
  muted text color). No custom CSS needed.
- All status form fields are rendered with `disabled` attribute.
- `createField` accepts an `isStatus` third argument that sets `disabled` on
  the field element.

## JS Architecture

### New globals

```js
var statusComponents = [];
```

Parallel to `components`, holding the status field definitions.

### `processStatus(data)`

Mirrors `processSettings` but simpler (no dirty tracking):
1. Build `statusComponents` array from the data object
2. Call `renderForm()` (which now iterates both arrays)
3. Call `bindChangeListeners()` (no-op for disabled fields)
4. Call `populateFromComponents()` to set initial values

### `onWSMessage` routing

Insert at the top of `onWSMessage`, before the settings routing:

```js
if (msg.type === 'status') { processStatus(msg.data); return; }
if (msg.type === 'error') { showError(msg.message); return; }
if (msg.type !== 'settings' && msg._dirty === undefined) return;
```

### `renderForm()` order

`renderForm` renders `statusComponents` first, then `components`,
building the same accordion details/summary structure. Each status section's
`<summary>` gets `class="secondary"`.

### `createField` changes

Status fields get `el.disabled = true` applied. Simplest way: pass a third
argument to `createField`. Since `renderForm` knows which array it's iterating,
it can pass `true` for status fields.

### Mutation exclusion

`serialize`, `getPending`, `buildPatch`, `onUserInput`, `sendToServer` None of
these iterate `statusComponents`, so they are unchanged.

## Test Server Changes

### New schema

```python
STATUS = {
    "system": {
        "uptime":     ["text", "Uptime",     {"value": None}],
        "fw_version": ["select", "Firmware", {"options": [["2.0.0","2.0.0"],["2.1.0","2.1.0"],["2.2.0-beta","2.2.0-beta"]], "value": "2.1.0"}],
        "led":        ["switch", "LED",      {"value": True, "help": "System LED indicator"}],
    },
    "network": {
        "mode":       ["radio", "Mode",      {"options": [["auto","Auto"],["manual","Manual"],["safe","Safe"]], "value": "auto", "help": "Network operation mode"}],
        "signal":     ["range", "Signal",    {"attrs": {"min": 0, "max": 100, "step": 1}, "value": None, "help": "Signal strength %"}],
        "connection": ["select", "Connection",{"options": [["connected","Connected"],["disconnected","Disconnected"],["error","Error"]], "value": "connected"}],
    },
    "sensors": {
        "temperature": ["number", "Temperature", {"value": None, "help": "Celsius"}],
    },
}
```

### `build_status()`

Mirrors `build_settings()` — iterates `STATUS`, resolves values from
`status_store` dict for static fields. Computed fields (uptime, signal,
temperature) generate live values at call time:

- **uptime:** compute from `start_time` module-level timestamp (includes seconds).
- **signal:** simulate fluctuation: `str(50 + int(elapsed * 5) % 50)`.
- **temperature:** simulate drift: `str(round(23.5 + (int(elapsed) % 10) * 0.1, 1))`.
- Other fields in `STATUS` with a `None` value marker are treated as
  computed at call time rather than looked up from `status_store`.

A background asyncio task (`status_broadcaster`) calls `build_status()` every
3 seconds and pushes the result to all connected WebSocket clients.

### `status_store`

In-memory dict for status values, parallel to `applied_store`/`nvs_store`.

### WS handler changes

- Endpoint changed from `/api/settings/ws` to `/api/events`
- On connect: send status first, then settings
- On settings `apply`: only rebuild/send settings, not status
- Add `POST /api/settings/external-status-change` endpoint (mirrors
  `external-change`) for e2e testing

### Static file serving

Update root route / static file serving to match `/api/events` (no change —
FastAPI routes are explicit).

## Edge Cases

- **Reconnect:** Server re-sends both status and settings. `processStatus`
  rebuilds `statusComponents` wholesale.
- **Empty status:** If no status data yet, accordion shows only settings.
  First status message renders status sections.
- **Partial update:** The diff handler walks the partial data tree, finds
  matching fields in `statusComponents`, updates `field.opts.value`, and
  updates the affected DOM elements via `populateFromComponents(statusComponents)`.
- **Disabled switches/radios:** Browsers don't fire change events on disabled
  inputs. `bindChangeListeners` binds handlers but they never fire. This is
  correct behavior — no guard needed.
- **Settings with no status server:** If the server only sends settings
  messages (legacy), status sections simply never appear. No crash.

## Architecture Notes

**Broadcast interval:** The test server broadcasts status every 3 seconds via
an asyncio background task. This interval balances visible real-time updates
against WebSocket overhead. On a real ESP32, status updates would be
event-driven (firmware events trigger pushes) rather than timer-based.

**Server-side computation:** `uptime`, `signal`, and `temperature` are
computed at call time in `build_status()`. No client-side timers or
computation are needed — the server owns all dynamic values.

**Partial updates:** Subsequent status messages may contain only changed
fields. The client's `processStatus` function merges these into the in-memory
`statusComponents` tree and updates only the affected DOM elements via
`populateFromComponents(statusComponents)`.

## Future Considerations

- Sub-topics for status (e.g., subscribe to `status.system.heap` only) —
  could use a `topic` field in the message if payload size becomes a concern.
- History/graph for numeric status values — client-side accumulation of
  values for trend display.
