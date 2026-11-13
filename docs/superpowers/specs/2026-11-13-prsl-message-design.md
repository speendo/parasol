# `prsl_message` Implementation Spec

**Parent:** `2026-11-13-0.10-scope-design.md`
**Branch:** `feature/0.10-message-api`
**Goal:** Let firmware broadcast a transient INFO / WARNING / ERROR message
to every connected browser without adding a settings field.

## Why

The library has a protocol error path (`type:"error"`) but no way for
firmware to tell the user something that is not a failure and not a setting.
Transforms are silent by design; a downstream developer may still want to say
“Wi-Fi changed; reconnect” or “Settings restored.” The user decides the
wording and the moment. The library only transports and renders it.

## API

```c
typedef enum {
    PRSL_MSG_INFO,
    PRSL_MSG_WARNING,
    PRSL_MSG_ERROR
} prsl_msg_level_t;

/** Broadcast a transient user-facing message to every connected browser.
 *
 *  INFO and WARNING are shown in the status bar; ERROR is highlighted.
 *  The message is not stored and does not affect dirty state. Protocol
 *  failures still use the library's own type:"error" path.
 *
 *  @param level   PRSL_MSG_INFO, PRSL_MSG_WARNING, or PRSL_MSG_ERROR.
 *  @param message NUL-terminated text. Keep it short; the library copies it
 *                 into the outgoing message and frees its own copy.
 *  @return ESP_OK on a broadcast attempt, ESP_ERR_INVALID_ARG for NULL,
 *          ESP_ERR_INVALID_STATE when the WebSocket is not started,
 *          ESP_ERR_NO_MEM when the outbound JSON cannot be built.
 */
esp_err_t prsl_message(prsl_msg_level_t level, const char *message);
```

There is no `prsl_error()`, and none is added. Firmware errors are just
`prsl_message(PRSL_MSG_ERROR, ...)`.

## Wire

```json
{"type":"message","level":"info","message":"Settings saved"}
{"type":"message","level":"warning","message":"Wi-Fi changed; reconnect"}
{"type":"message","level":"error","message":"Could not write config: disk full"}
```

- `type` is `"message"`.
- `level` is lowercase `"info"`, `"warning"`, or `"error"`.
- `message` is the developer's text, verbatim.
- Broadcast to every connected client with `g_ws->textAll()`.
- No store mutation, no `_meta`, no ack, no persistence.
- Existing `{"type":"error"}` messages from `prsl_ws_handle()` are unchanged
  and remain reserved for protocol/transport failures.

## Device implementation

Add `prsl_message()` in `src/prsl.cpp` near `prsl_push()`:

1. Reject `NULL` with `ESP_ERR_INVALID_ARG`.
2. Reject when `g_ws == NULL` with `ESP_ERR_INVALID_STATE`.
3. Build a cJSON object with `type`, `level`, `message`.
4. `cJSON_PrintUnformatted`, `cJSON_Delete`, `g_ws->textAll`, `free`.
5. Return `ESP_ERR_NO_MEM` if either allocation fails.

Level-to-string mapping is a small `switch`. Unknown enum values fall back to
`"info"` rather than emitting garbage.

No store mutex is needed; the function does not read or write the store.
It must be safe to call from `on_set`, `on_save`, `on_reset`, `on_reboot`,
`on_upload`, or a normal application task after `prsl_start()`.

## Client implementation

Add a `showMessage(level, msg)` next to `showError()`:

- `INFO`: prefix `\u2139` (ℹ), normal status-bar color.
- `WARNING`: prefix `\u26a0` (⚠), color `orange`.
- `ERROR`: prefix `\u2716` (✖), color `var(--pico-color-red)`.
- Unknown level: treat as `INFO`.
- Write the text into the existing `#status-bar` element; do not add a modal
  or a new DOM container.

Handle it in `onWSMessage()` before the settings/ack paths:

```js
if (msg.type === 'message') { showMessage(msg.level, msg.message); return; }
```

`showError()` keeps its current behavior for protocol errors and HTTP
failures. A later message or error overwrites the status bar.

## Byte budget

Measured against the current `app.js` with the `build.sh` terser settings:

| Variant | Raw | Gzip | Delta |
|---|---:|---:|---:|
| Current | 22,997 | 7,853 | — |
| Handler + symbols + colors | 23,164 | 7,934 | **+81 B gzip** |

Device flash cost is under 1 KB. The target is to stay at or below +100 gzip.

## Tests

- **Unit (client):** deliver `{"type":"message","level":"warning","message":"x"}`
  through `onWSMessage`; assert `#status-bar` contains `⚠` and `x`, and the
  color is the warning color. Repeat for INFO and ERROR.
- **Unit (client):** unknown level falls back to INFO.
- **Test server:** add a small endpoint (e.g. `POST /api/test/message`) that
  broadcasts a message, so the e2e test can trigger it without a device.
- **E2E:** trigger a warning; assert the status bar shows `⚠ …`; trigger an
  error; assert `✖ …`. Trigger a normal settings push afterward and verify
  the message does not become a persistent field or block the form.
- **Compile:** `tests/pio_smoke` already compiles `src/prsl.cpp`; no new
  wrapper is needed for the API itself.

## Non-goals

- Per-client targeting. Broadcast only; 95% of deployments have one client.
- Persistence or history.
- A second severity scale or an icon set.
- Replacing the existing `type:"error"` protocol path.
- Library-owned auth or message access control.

## Files likely touched

- `include/prsl.h` — enum and declaration.
- `src/prsl.cpp` — implementation.
- `app.js` — `showMessage` and the WS handler.
- `tests/unit/app.test.js` — client tests.
- `test_server/main.py` — test-only message endpoint.
- `tests/e2e/app.test.js` or a new `tests/e2e/message.test.js`.
- `API_REFERENCE.md`, `WS_PROTOCOL.md`, `CHANGELOG.md` in the docs pass.

## Risks

- `textAll()` may drop a message when a client queue is full; the existing
  queue policy closes that client instead of silently keeping it stale.
- Long messages cost RAM on the device and in the browser. Document “keep
  messages short”; do not add an arbitrary cap unless a real need appears.
- The Unicode symbols are presentation. If a font or screen reader handles
  them poorly, change the glyphs later without a wire or API change.
