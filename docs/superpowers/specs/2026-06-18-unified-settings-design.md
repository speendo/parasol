# Unified Settings API & WebSocket Design

## Guiding Constraints

The server is an ESP32 with constrained RAM, flash storage, and CPU. All design
decisions favor shifting computation to the client (browser) to minimize server
load. JS code should follow DRY principles — reuse functions rather than duplicating
logic between HTTP and WebSocket paths, form rendering, and serialization.

## Overview

A single `/api/settings` endpoint serves all component definitions as nested JSON.
Server-owned `_dirty` tracking drives the Save button. WebSocket at `/api/events`
is the primary transport — HTTP `/api/settings` GET is a fallback.

## Current Architecture

The system is built around a single WebSocket connection at `/api/events` with
HTTP used only for persistence:

- **WS connection** — primary transport. Server pushes full settings + status on
  connect, fields auto-apply on blur, and external changes are pushed live.
- **`/api/settings` GET** — HTTP fallback for full settings load (used when WS
  is unavailable, e.g. first load on slow connections).
- **`/api/settings/save` POST** — persist current applied values to NVS. The
  only HTTP endpoint clients call directly; WS blur handles apply.
- **`_dirty`** — server-owned boolean, true when applied ≠ stored (NVS). Drives
  the Save button visibility (see Buttons section).
- **10-case state machine** — tracks FV (form value), LS (last sent), AV
  (applied value), and inFlight per field. Handles echo resolution, external
  updates, collision detection, and conflict resolution.
- **Status variables** — read-only telemetry pushed over the same WS connection
  (`msg.type === "status"`), rendered as disabled fields before settings
  sections. See `status-variables-design.md` for the full design.
- **Notification bar** — `#server-changed` mark element for external update
  alerts and collision prompts (Cases 3 and 5 in the state machine).

---

## JSON Structure (`/api/settings`)

### Response shape

```json
{
  "_dirty": false,
  "wifi": {
    "ssid":     ["text", "SSID",     {"value": "MyNetwork", "tooltip": "WiFi network name \u2014 required, 1\u201332 characters"}],
    "password": ["password", "Password", {"value": "password", "attrs": {"maxlength": 64}, "tooltip": "WiFi password \u2014 required, up to 64 characters"}],
    "mode":     ["select", "Mode",   {"value": "station", "options": [["station","Station"],["ap","Access Point"]]}]
  },
  "gpio": {
    "pin":       ["number", "Pin Number",  {"value": 2, "attrs": {"min": 0, "max": 39}}],
    "direction": ["select", "Direction",  {"value": "output", "options": [["input","Input"],["output","Output"]]}],
    "initial":   ["select", "Initial State", {"value": "low", "options": [["low","Low"],["high","High"]]}]
  }
}
```

### Field format

Each key under a component group is a 3-element array:

```
[type, label, opts]
```

- `type` — one of: `text`, `number`, `password`, `email`, `tel`, `url`, `color`,
  `switch`, `radio`, `select`, `range`, `textarea`
- `label` — display name for the form field
- `opts` — dictionary with keys:
  - `value` — current applied value (replaces `default` from old format)
  - `options` — for `select` and `radio`: `[["key1", "Label 1"], ...]`
   - `attrs` — HTML attributes: `{min, max, maxlength, minlength, step, placeholder, required, pattern}`
  - `tooltip` — help text string

### Meta fields

- `_dirty` (bool) — owned by ESP32. `true` when applied settings ≠ stored (NVS) settings.
  Drives the Save button visibility (see Buttons section).

### Naming conventions

- Component group labels are derived from top-level keys using this algorithm:
  1. Split on underscores, hyphens, or camelCase boundaries
  2. Capitalize the first letter of each word
  3. Join with spaces
  Examples: `wifi` → `"Wifi"`, `gpio` → `"Gpio"`, `audio_interface` → `"Audio Interface"`,
  `AudioInterface` → `"Audio Interface"`.
- Field labels use the `label` value from the field array directly.
- Underscore-prefixed keys (`_dirty`) are meta fields, never components.

### Component discovery

No manifest. The JS iterates top-level keys in the response, skipping `_`-prefixed
keys. Each key becomes an accordion section. The section label is derived from
the key name via case conversion.

---

## Transport

Both HTTP POST and WebSocket `apply` messages send only the fields that
changed, never the full settings object. The payload is a partial JSON object
matching the structure of `/api/settings` but containing only the affected keys.

HTTP GET and WS initial push respond with the **full** settings.

### HTTP Endpoints

| Method | Endpoint | Purpose | Body |
|---|---|---|---|
| GET | `/api/settings` | Load full settings | — |
| POST | `/api/settings/save` | Persist diff to NVS | `{"wifi": {"ssid": ["text", "SSID", {"value": "MyNetwork"}]}}` |

- Success: HTTP 200 with empty body.
- Error: HTTP 4xx/5xx with plain text error message body.

### WebSocket (`/api/events`)

A single WebSocket carries both `"settings"` and `"status"` messages,
multiplexed via the `msg.type` field.

#### Client → Server

| Message | Trigger |
|---|---|
| `{"action": "apply", "data": {"wifi": {"ssid": ["text", "SSID", {"value": "MyNetwork"}]}}}` | User blurs a modified field |

Only changed fields sent (same partial format as POST). The `apply` action activates the settings live without
persisting to NVS. Persistence is always done via POST `/api/settings/save`.

#### Server → Client

| Message | When |
|---|---|
| `{"type": "status", "data": {<full status object>}}` | Initial connect, then every 3s (broadcast) |
| `{"type": "settings", "_dirty": <bool>, "data": {<full settings object>}}` | Initial connect, reconnect, after external config change, after apply |
| `{"type": "error", "message": "..."}` | Processing error |

- Server push is handled by the state machine (see Data Model section below):
  - **Case 3** (external update, user idle): notification with "Load" / "Keep" choice.
  - **Case 4** (coincidental sync): silent sync.
  - **Case 5** (collision): conflict prompt listing all changed fields, single global
    decision: "Keep all local" or "Accept all server".
- The notification element is a `<mark id="server-changed" role="alert" hidden>`
  placed below `<header>`, reusing the same sticky bar CSS as `footer.pending`
  (shared class `.sticky-bar` for `position: sticky`, `z-index`, `box-shadow`,
  with `.sticky-bar.top` / `.sticky-bar.bottom` for `top`/`bottom` offsets).

#### Connection lifecycle

1. Page loads → set `aria-busy="true"` on form container (Pico CSS loading indicator).
2. JS opens WS connection to `/api/events`.
3. Server sends status data (`{"type": "status", ...}`), then full settings
   (`{"type": "settings", ...}`) → remove `aria-busy`, render form.
4. If WS connection fails → show error state with retry button.
5. On reconnect → set `aria-busy`, server re-sends status then settings → remove `aria-busy`.

---

## Data Model

### Three values, two owners

| Value | Owner | Where | Persistence |
|---|---|---|---|---|
| Stored (NVS) | ESP32 only | Never sent to client | Survives reboot |
| Applied (AV) | ESP32 | Sent via WS push (or HTTP GET fallback) | Active in RAM |
| Form value (FV) | Browser | Local form state | Transient |

Plus two client-local tracking fields per form field:

- **LS** (Last Sent) — the last value sent to the server via WS
- **inFlight** (boolean) — `LS !== AV`, meaning a WS message hasn't been echoed back yet

`_modified` is a derived concept, not a stored variable: it means FV differs from AV
when inFlight is false (the user has local changes ready to send).

### State machine

**Case table:**

| FV=LS? | LS=AV? | FV=AV? | inFlight | Interpretation | Action |
|---|---|---|---|---|---|
| yes | yes | yes | false | **Idle:** everything in sync | No action |
| no | yes | no | false | **Local Input:** client changed form value | Push FV to server; set LS = FV; inFlight = true |
| yes | no | no | false | **External Update:** server pushed new value while idle | Notify user, list changed field(s), offer "Load" or "Keep"; on Load: FV = AV, LS = AV |
| no | no | yes | false | **Coincidental Sync:** server echoed the same value client was about to send | Silently sync: LS = AV |
| no | no | no | false | **Collision:** client has local changes AND server pushed conflicting value | Show prompt listing all conflicting fields, single choice: "Keep all local" (push FV, LS = FV, inFlight = true) or "Accept all server" (FV = AV, LS = AV) |
| yes | yes | yes | true | **Echo Received:** server confirmed change, no new local input | inFlight = false |
| no | yes | no | true | **Echo + Queued Input:** server confirmed change, user already changed value again | inFlight = false; immediately push FV; LS = FV; inFlight = true |
| yes | no | no | true | **Waiting for Echo (stale packet):** received old or external packet | Ignore packet |
| no | no | yes | true | **Waiting for Echo (revert):** user reverted to old value while waiting | Ignore packet; on echo → Case 1 |
| no | no | no | true | **Waiting for Echo (conflict):** conflicting external packet while in-flight | Ignore packet; on echo → Case 5 |

### Pseudocode implementation

```
// Per-field state
let FV = AV      // Form Value (from UI)
let LS = AV      // Last Sent
let AV = server  // Applied Value (from server)
let inFlight = false

// ── Event: User changes form field ──
function onUserInput(newValue):
    FV = newValue
    updateUI(FV)

    if inFlight == false and FV != LS then
        sendToServer(FV)
        LS = FV
        inFlight = true

// ── Event: WebSocket message received ──
function onServerMessage(newAV):
    AV = newAV

    // Step 1: Echo resolution (Cases 6 & 7)
    if inFlight == true and LS == AV then
        inFlight = false
        if FV != LS then            // Case 7: queued input
            sendToServer(FV)
            LS = FV
            inFlight = true
            return

    // Step 2: Routing
    if inFlight == true then
        // Cases 8, 9, 10 — ignore packets while waiting for echo
        ignorePacket()
    else
        // Cases 1, 3, 4, 5 — not in-flight, server pushed new value
        if FV != AV then
            if FV == LS then
                // Case 3: External update, user has no unsent changes
                showNotification(
                    "Server settings changed",
                    changedFields,           // list of field labels
                    onLoad: () => {
                        FV = AV
                        LS = AV
                        updateUI(FV)
                    },
                    onKeep: () => {
                        // dismiss notification, keep FV unchanged
                    }
                )
            else
                // User has unsent changes (Cases 4 & 5)
                if FV == AV then
                    LS = AV                 // Case 4: Coincidental Sync
                else
                    // Case 5: Collision — prompt user once with all conflicts
                    showConflictPrompt(
                        conflictingFields,   // list of field labels + values
                        onKeepLocal: () => {
                            sendToServer(FV)
                            LS = FV
                            inFlight = true
                        },
                        onAcceptServer: () => {
                            FV = AV
                            LS = AV
                            updateUI(FV)
                        }
                    )
        else
            LS = AV                         // Case 1: Synced
```

### Buttons

| Button | Enabled when |
|---|---|
| Save | `_dirty` is true AND `configForm.checkValidity()` passes |

Apply is automatic on blur via WebSocket. There is no separate Apply or Reset
button in the footer.

---

## Form Validation

Validation rules are declared as HTML attributes (`required`, `min`, `max`,
`minlength`, `maxlength`, `pattern`, `step`) in the `attrs` field of component
schemas. PicoCSS validation state styling is driven by the `aria-invalid`
attribute: `"false"` shows green (valid) styling, `"true"` shows red (invalid)
styling. The JS manages this attribute on every form field.

**Initial state:** After `renderForm()` builds the DOM, all named form fields
(`input`, `select`, `textarea`) receive `aria-invalid="false"` so they start
with neutral styling. No fields appear invalid before user interaction.

**Per-field validation:** On blur/change/click (determined by field type), the
handler calls `el.checkValidity()` and sets `aria-invalid` to `"true"` or
`"false"` based on the result. Invalid fields block the auto-apply WebSocket
send and keep the field out of the Save-enabled state. The handler also forces
the parent `<details>` accordion open so the user can see the invalid field
even if they had closed the section. The `reportValidity()` method is NOT used
(to avoid native browser validation pop-ups).

**First-interaction gating:** On page load, required fields that have never been
interacted with do NOT block the save button. A `formInteracted` flag starts
`false` and is set to `true` on the first blur/change/click. `updateUI()` only
runs `configForm.checkValidity()` when `formInteracted` is `true`; otherwise it
treats the form as valid. This prevents a freshly loaded form from hiding the
save button before the user has touched any field.

**Button gating:** The Save button enables only when both conditions hold:
1. `_dirty` is true (server has pending NVS writes)
2. `formInteracted ? configForm.checkValidity() : true` (all fields pass native
   validation after user interaction)

Both checks happen in `updateUI()`.

**Event types by field:**
- `text`, `password`, `email`, `tel`, `url`, `textarea` — `blur` triggers validation + auto-apply
- `select`, `range`, `number` — `change` triggers auto-apply
- `radio`, `switch` — `click`/`change` triggers auto-apply
- All fields — `input` calls `updateUI()` for live pending count feedback

---

## Error Handling

- POST errors: HTTP 4xx/5xx with plain text body, displayed in status bar.
- WS errors: `{"type": "error", "message": "..."}`, displayed in status bar.
- WS connection failure: error state with retry button. Page shows "Cannot
  connect to device" with a Retry button.

---

## Future Considerations

- `/api/system/restart`, `/api/firmware/upload` — additional API paths
- Multiple clients connected to the same device
- Group name `_label` override for auto-derived component labels
