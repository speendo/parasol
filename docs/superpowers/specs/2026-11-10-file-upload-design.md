# parasol 0.8.0 — Generic File Upload Design

Date: 2026-11-11
Status: draft, pending approval
Target release: 0.8.0 (the 0.7.0 tag lands first)

## How to use this spec

This document is the source of truth for the 0.8.0 file-upload feature. It is
written to be turned into an implementation plan by a builder who cannot ask
the author questions. Items marked **PLAN REVIEW** must be verified against the
pinned dependency source or a real device before the plan commits to a
mechanism; do not guess.

Related documents:

- `docs/BACKLOG.md` — living list of open work, including deferred upload items.
- `docs/superpowers/specs/2026-09-02-architectural-decisions-design.md` —
  current API contract and deferred echo-correlation gap.
- `test-deps` / `tests/pio_smoke` — the pinned `esp32async/ESPAsyncWebServer`
  fork used by CI.

## Intent

Parasol today lets firmware expose a settings form and stream scalar values.
Some useful device configuration is not a scalar: a firmware image, an audio or
image asset, or a JSON file to parse. The browser can pick such a file, but the
ESP32 must not hold it in RAM, and the library must not decide where it goes.

This feature adds one generic primitive:

> **A file field in a settings section that streams the selected file to a
> downstream callback in chunks, with the downstream developer deciding what
> the bytes mean, where they go, and whether Save commits them.**

The library owns transport, lifecycle, limits, and the browser UI. The developer
owns storage, validation of content, commit/rollback, and dirty semantics.

Why before 1.0: it is the last missing feature, and it adds a public field type
and an HTTP surface that should be frozen together with the rest of the 1.0
contract.

## Goals

- Stream a file of firmware-scale size (1–2 MB and larger) without allocating a
  file-sized buffer on the ESP32.
- Let the developer reject a file from metadata before bytes are written.
- Let the developer validate content on the first chunk and abort.
- Support two downstream patterns with the same primitive:
  - **Immediate:** write chunks to final storage/OTA and commit at END.
  - **Deferred:** write to a temporary location, mark the form dirty, and commit
    on Save / discard on Reset.
- Show the current file label as the field's value, and show upload progress,
  cancellation, success, and errors inline.
- Keep the browser path small enough not to break the JS byte budget.

## Non-goals

- No storage implementation in the library (no LittleFS/SD/NVS file API).
- No OTA implementation in the library (no Arduino `Update` / ESP-IDF
  `esp_ota_*` dependency).
- No download endpoint (tracked in `docs/BACKLOG.md`).
- No authentication/authorization in this feature (tracked under the 1.0
  security item; uploads are unauthenticated by default, like the rest of the
  UI).
- No multi-file fields, resumable uploads, or background uploads after page
  close.
- No modal UI. The field is inline.
- No client-side filename regex beyond `accept`.
- No device-side chunk-size option; chunks are passed through as received.

## Anti-goals

- Buffering a whole file in RAM.
- Sending file bytes through the WebSocket.
- Making the browser a trusted validator.
- Adding a second source of truth for the field value: the file label lives in
  the existing value store and is only changed server-side.
- Turning upload into a general action-button framework.

## Constraints

- Server is an ESP32: limited RAM/flash/CPU; shift computation to the browser.
- Public API compiles as both C and C++.
- Short JS; every byte matters. Current `app.min.js` is 15,857 raw / 5,533 gzip.
- The dependency is the maintained `esp32async/ESPAsyncWebServer` fork (v3.12.0
  in CI). Its upload/body path is async and runs in the async TCP task.
- Existing fields and registration must not change shape.

## Approaches considered

### Transport: preflight + raw PUT (chosen)

- `POST /api/upload/<group>/<key>` with JSON metadata performs an advisory
  sanity check before any bytes move.
- `PUT /api/upload/<group>/<key>?name=<url-encoded>` streams the raw file body.
- The device re-checks limits and metadata at PUT start; a client cannot bypass
  the real guard.

Rejected alternatives:

- **Single multipart POST.** One request, but the fork's multipart parser adds
  boundary scanning, an internal buffer, and filename parsing; metadata rejection
  still starts the transfer. More device code and RAM for no benefit, since the
  UI is JS anyway.
- **WebSocket binary chunks.** Reuses `/api/events`, but fights the frame-size
  limits, multiplexes binary/text, and competes with status broadcasts.

### Registration: dedicated function (chosen)

- Add `prsl_add_file_field(...)` and `prsl_file_opts_t`.
- Add `PRSL_FILE` to the public `prsl_type_t` for the wire/store, but
  `prsl_add_field(PRSL_FILE, ...)` returns `ESP_ERR_INVALID_ARG`; the documented
  entry point is `prsl_add_file_field`.
- Existing `prsl_field_opts_t` is untouched: no size change, no new members, no
  invalid combinations for existing fields.

Rejected alternative: extend `prsl_field_opts_t` with `on_upload`, `max_size`,
`accept`, `idle_timeout_ms`. It keeps one registration function, but grows every
field's flash footprint, mixes value and stream concerns, and allows invalid
combinations (e.g. `on_set` on a file field).

### UI: inline (chosen)

A Pico file input + Upload button inside the field, with inline progress,
Cancel, and status. A global upload lock (disable Save, Reset, Reboot, and other
uploads) gives the exclusivity a modal would provide without focus/scroll/ESC
code or extra bytes. The lock is enforced twice: the client uses a local flag
plus the `_meta.uploading` meta flag (so other tabs lock too), and the device returns
`409` from save/reset/reboot while an upload is active. A confirmation modal
for destructive uploads is deferred (`docs/BACKLOG.md`).

### Commit style: developer's choice (chosen)

The library has no `immediate`/`deferred` flag. The developer expresses the
style through existing hooks:

- **Immediate:** `on_upload(CHUNK)` writes to final storage/OTA, `END` commits,
  the developer never sets dirty.
- **Deferred:** `on_upload(CHUNK)` writes to a temp file, `END` updates the field
  value with `prsl_set_str` and calls `prsl_set_dirty(true)`, `on_save` commits
  the temp file, `on_reset` discards it and restores the previous label.

## Public API

### Types

```c
typedef enum {
    PRSL_UPLOAD_META,   /* metadata only, exactly once, before any CHUNK */
    PRSL_UPLOAD_CHUNK,  /* data bytes; zero or more */
    PRSL_UPLOAD_END,    /* body complete; commit here; exactly once */
    PRSL_UPLOAD_ABORT   /* client gone / idle timeout / prsl_stop; cleanup */
} prsl_upload_event_t;

typedef struct {
    prsl_upload_event_t event;
    const char *group_id;   /* registered group, e.g. "audio" */
    const char *key;        /* registered key, e.g. "clip" */
    const char *name;       /* basename of the uploaded file; never NULL */
    const char *mime;       /* declared Content-Type, or NULL */
    size_t size;            /* declared Content-Length */
    size_t offset;          /* byte offset of data (CHUNK only) */
    const uint8_t *data;    /* CHUNK only; valid only during this call */
    size_t len;             /* CHUNK length; 0 for other events */
    char *err;              /* callback writes an error message here */
    size_t err_len;         /* size of err, including NUL */
    int status;             /* HTTP status hint on rejection; 0 = default */
} prsl_upload_t;

typedef esp_err_t (*prsl_upload_cb_t)(prsl_upload_t *u);
```

Rules:

- `data` is only valid for the duration of the `CHUNK` call. The developer must
  write or copy it synchronously.
- `META` carries no data. It is not a chunk. The first data callback is a
  separate `CHUNK`.
- `name`, `size`, and `mime` are valid on every event. The developer may copy
  them at `META` and ignore them later.
- The callback receives a mutable `prsl_upload_t *` so it can write `err` and
  `status`. `data` itself is `const`.
- On `META`, `CHUNK`, or `END`, returning anything other than `ESP_OK` rejects
  the upload. The developer may write a human-readable reason to `err`; the
  library sends it to the browser. If `err` is empty, the library supplies a
  generic message.
- `status` lets the developer choose the HTTP status on rejection. `0` means
  the library default: `400` for `META`/`CHUNK`, `500` for `END`. A non-zero
  value is used verbatim (clamped to 400–599).
- On `ABORT`, the return value and `status` are ignored.
- **`ABORT` is guaranteed exactly once for every upload that reached `META`,
  unless `END` returned `ESP_OK`.** This includes a `META` or `CHUNK`
  rejection, an error from `END`, a transport drop, an idle timeout, and
  `prsl_stop()` during the upload. It never fires after a successful `END` and
  never fires twice.
- `ABORT` is the only cleanup signal. The developer must close/delete temp
  files, call `Update.abort()`/`esp_ota_abort()`, and free resources there.
  The OTA example can therefore put all cleanup in `ABORT`, even when `END`
  returns an error.

### File options and registration

```c
typedef struct {
    prsl_get_cb_t on_get;           /* current file label, or NULL */
    prsl_upload_cb_t on_upload;     /* required */
    const char *accept;             /* optional HTML accept list, e.g. ".bin" */
    size_t max_size;                /* device limit; 0 = no limit */
    uint32_t idle_timeout_ms;       /* device timeout; 0 = default (30000 ms) */
    const char *help;               /* optional help text */
    const char *attrs;              /* optional extra HTML attributes JSON */
} prsl_file_opts_t;

esp_err_t prsl_add_file_field(const char *group_id, const char *key,
                              const char *label,
                              const prsl_file_opts_t *opts);
```

- `on_upload` is required; a NULL callback returns `ESP_ERR_INVALID_ARG`.
- `on_get` is the load hook. It returns the current **file label** (a string) or
  NULL; see "File label vs. uploaded name" below. The library loads it at init
  and on reset, like any other field value.
- `max_size == 0` means no limit. Empty files (0 bytes) are always rejected.
  This is a device-enforced limit (RAM/flash protection), not just a browser
  hint.
- `idle_timeout_ms == 0` uses the library default of 30000 ms. The timeout is
  inactivity-based: time since the last received chunk, not total duration.
  Device-only; never sent to the browser.
- `accept` is the HTML file-input filter: a comma-separated list of extensions
  and/or MIME types (e.g. `.bin,application/octet-stream`, `audio/*`). It is a
  UX/policy filter backed by declared metadata, not a security boundary; users
  can bypass the picker and clients can lie. Content checks belong in
  `on_upload`.
- `attrs` is a JSON object of extra HTML attributes for the file input
  (e.g. `{"title":"Firmware image","aria-label":"Firmware"}`). It is
  presentation-only and flows through the existing `attrs`/`parsed_attrs`
  plumbing. Do **not** put `accept`, `max_size`, or `idle_timeout_ms` in it:
  those stay typed so the device and the browser share one source of truth,
  and a typo cannot silently disable a safety limit.
- `prsl_add_field(PRSL_FILE, ...)` returns `ESP_ERR_INVALID_ARG`. The header
  documents `prsl_add_file_field` as the only registration path.

**Why a dedicated function?** All scalar widgets (text, textarea, checkbox,
select, number, range, …) share one data contract: a single scalar value,
`on_get`/`on_set`, and the browser's apply/save pipeline. A file field changes
the callback shape (`on_upload` stream events), the transport (preflight + raw
PUT), the value ownership (server-owned read-only label), and the option set
(`accept`, `max_size`, `idle_timeout_ms`). `prsl_add_field_opts` is the existing
precedent for a type with a different registration shape. The dedicated
function leaves `prsl_field_opts_t` and every existing field unchanged. See
`API_REFERENCE.md` for the same rationale in user-facing form.

The field is a settings field, never a status field. File fields have no
`options` array; `prsl_add_file_field` is the only registration entry point.

### Value semantics

- The field's value is the current **file label** string, or null.
- The browser renders it read-only and never sends it in an apply or save body.
- The developer changes it from firmware:
  - after a successful upload: `prsl_set_str("grp.key", "firmware.bin");`
  - on save/reset as needed.
- `prsl_set_str` does not broadcast; call `prsl_push()` if the browser should
  update immediately.
- `prsl_get("grp.key")` returns the label. Typed numeric/bool getters return
  `ESP_ERR_NOT_FOUND` for file fields, as for any string value.

### File label vs. uploaded name

These are different strings with different owners:

| | File label (`on_get`, `value`, `prsl_get`) | Uploaded name (`u->name`) |
|---|---|---|
| Origin | developer, at load/upload/save | browser's selected file |
| Meaning | whatever the developer wants to show | client-supplied original name |
| Examples | `firmware.bin`, `v3.11`, `beep.mp3 (pending)`, `none` | `firmware_v3.11_2026_11_10.bin` |
| Trust | trusted device state | untrusted input |
| Auto-updated by library | never | n/a |

The common case is mapping a dated upload name to a canonical storage name
(`firmware_v3.11_2026_11_10.bin` → `firmware.bin`). The developer validates
`u->name`, writes the bytes wherever they want, and decides what label to show.
The library never renames and never auto-sets the label.

There is no built-in size/hash field. A developer who wants size in the UI can:

- include it in the label (`"firmware.bin (1.2 MB)"`), or
- register a normal read-only status field and update it with `prsl_set_int` +
  `prsl_broadcast_status()`.

`u->size` is the declared upload size and may differ from the stored/compressed
size. Structured file metadata is deferred (`docs/BACKLOG.md`).

### Global upload state

```c
/** @brief True while any file upload is active on the device.
 *  Device-global: covers every settings endpoint/namespace and every
 *  registered file field. Not per-store. */
bool prsl_is_uploading(void);
```

This is the source for the `_meta.uploading` meta flag and for device-side guards.
It is analogous to `prsl_is_dirty()`, but global rather than per-store. Firmware
with custom HTTP endpoints can use it to reject conflicting work.

## Wire format

A file field appears in the settings payload as a normal field with type
`"file"`:

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

- `value`: current file label or `null`.
- `accept`, `max_size`, `help`, and `attrs` are omitted when unset.
- `idle_timeout_ms` is device-only and is not sent to the browser.
- The field is included in the `data` object like any other setting, so the
  browser can render it. It is excluded from client-generated apply/save bodies.

Every settings payload also carries a top-level `_meta` object:

```json
{"type":"settings",
 "_meta":{"dirty":false,"show_reset":true,"show_reboot":true,"uploading":false},
 "data":{...}}
```

`_meta` holds the four meta flags and is the only meta container; there are no
top-level meta keys.

**`_meta.uploading` is device-global, not per settings endpoint or namespace.**
It is true from the moment any upload is accepted (first `META`) until that
upload's `END` or `ABORT` completes. Consequences:

- Every settings payload from every endpoint must include the same flag, even
  if that endpoint has no file fields. If settings are later partitioned (e.g.
  `/user` vs `/admin`, or multiple `prsl_store_t` instances), each payload
  builder reads the same process-global upload state; there is no per-store
  copy.
- Every push path must carry it. Today that is `prsl_push()` on the single
  `/api/events` socket; when more endpoints/sockets exist, all of them push the
  same global value on upload start and end.
- A tab that connects mid-upload receives `true` in its initial settings push,
  whichever endpoint it uses.
- The test server must emit it in every settings payload and treat it as
  global.

## HTTP protocol

Two endpoints per field, using the same path:

```
POST /api/upload/<group>/<key>
PUT  /api/upload/<group>/<key>?name=<url-encoded basename>&type=<url-encoded mime>
```

`type` is optional on the PUT; the browser always sends it. When present it is
used for the MIME half of the `accept` check. When absent, only the filename
extension is checked.

The client URL-encodes the `<group>` and `<key>` path segments (and the
`name`/`type` query values); the device decodes them. Group and key are
expected to be simple identifiers without `/`.

Implementation note: use one prefix route (`/api/upload/`) and parse
`<group>/<key>` from `request->url()`; or register exact routes per field at
`prsl_init`. **PLAN REVIEW:** confirm the pinned fork's `AsyncURIMatcher`
prefix handling and the lifetime of the URI string before choosing. Prefer the
single prefix route if it works; it avoids per-field route strings.

### Preflight (POST)

Request body:

```json
{"name":"beep.mp3","size":12345,"type":"audio/mpeg"}
```

The device checks, in order:

1. The path names a registered field whose type is `PRSL_FILE`; else `404`.
2. No upload is currently active; else `409`.
3. `name` is a non-empty basename, at most 127 bytes after URL decoding, with
   no control characters; else `400`.
4. `size > 0`; else `400`.
5. `max_size == 0` or `size <= max_size`; else `413`.
6. `accept` is unset or the name/MIME matches; else `415`.

Responses are plain text (no JSON):

- `200 OK` — body `OK`.
- `400/404/409/413/415` — body is a short human-readable reason.

The preflight is advisory. The PUT repeats the checks; a client that skips the
preflight can still upload only if the PUT checks pass.

### Upload (PUT)

- Required headers: `Content-Length` and `Content-Type: application/octet-stream`.
  Missing `Content-Length` (including chunked transfer) returns `411`.
- `name` and `type` query parameters are URL-encoded; the device decodes them
  with `request->getParam("name")` / `getParam("type")`. If `name` is absent on
  the PUT, the device may fall back to a generic name (`"upload"`), but the
  browser always sends it.
- The device repeats preflight checks 1–6 using `Content-Length`, `name`, and
  (when present) `type`. MIME entries in `accept` are only checkable when
  `type` is present; extension entries always work. A client that needs a
  MIME-only `accept` rule must send `type`.
- If another upload is active, `409`.
- The device calls `request->client()->setRxTimeout(...)` for
  `idle_timeout_ms`. **PLAN REVIEW:** verify the unit expected by the pinned
  `AsyncTCP` (`setRxTimeout` is currently documented as a timeout in the
  library; convert ms appropriately). If the unit or behavior is unsuitable,
  implement a no-data watchdog instead.
- The device registers `request->onDisconnect(...)` at the first body callback.
  If the body has not reached `END`, the handler calls `on_upload(ABORT)` and
  clears the upload state.
- The request handler (which the fork invokes after the body completes) sends
  the final response:
  - `200 OK` on success.
  - `400` for a callback rejection at `META`/`CHUNK` by default, or the
    callback's `status` if it set one.
  - `500` for a callback failure at `END` by default, or the callback's
    `status` if it set one.
  - `413` if the actual received bytes exceed `Content-Length` or `max_size`.
  - `400/411/413/415/500` with the library or callback error message.
- Body handler state machine:
  1. On the first body callback (`index == 0`), populate the upload state from
     the field, name, size, and MIME; call `META`. If it rejects, record the
     error and discard the remaining body.
  2. If `META` accepted, deliver the same callback's bytes as `CHUNK`
     (`offset = index`).
  3. For each later callback, deliver `CHUNK`.
  4. When `index + len == total`, call `END`.
  5. If a callback rejects at `META` or `CHUNK`, stop writing, remember the
     error, and discard the rest of the body. The final response reports it.
     `ABORT` is called exactly once before the response.
  6. If `END` returns non-OK, remember the error and the status; call `ABORT`
     exactly once; the final response reports it.
  7. If the connection drops or the idle timeout fires, call `ABORT` and clear
     the state. The browser sees a network error or a timeout.
- The library keeps exactly one in-progress upload in a static state. This is
  intentional: the ESP32 should not run two flash/OTA writers at once, and it
  makes the abort/timeout state small and host-testable.
- On upload start (first `META`) set `_meta.uploading = true` and `prsl_push()`;
  on `END`/`ABORT` completion set `_meta.uploading = false` and `prsl_push()`.
- `prsl_stop()` during an upload calls `ABORT`, clears the state, then stops the
  server. The developer must make `ABORT` safe to call once.

### Device guards while uploading

The browser lock is not a security boundary; the device must enforce the same
lock for other tabs, stale pages, and raw HTTP clients. These guards are
**device-global**: they apply on every settings endpoint/namespace, not just the
one that started the upload.

- While an upload is active, `POST /api/settings/save` returns `409` with
  `Upload in progress`.
- While an upload is active, `POST /api/settings/reset` returns `409`.
- While an upload is active, `POST /api/system/reboot` returns `409`.
- While an upload is active, public `prsl_reset()` returns
  `ESP_ERR_INVALID_STATE`.
- A second preflight or PUT returns `409`, regardless of which endpoint or
  field it targets.
- Reading values, `prsl_push()`, and `prsl_broadcast_status()` remain allowed.
- `prsl_stop()` is allowed and aborts the upload first.

These guards are part of the 0.8.0 contract, not just the example.

### Error text

The callback can write to `u->err` (e.g. `snprintf(u->err, u->err_len,
"Not a firmware image")`). The library uses it verbatim in the HTTP response.
This is how the developer explains a rejected mp3, a bad magic number, or a
flash-write failure to the browser.

## Client / UI behavior

### Rendering

A file field renders as a normal field in its group:

- label and optional help text (existing field patterns)
- a current-label line from `opts.value` (e.g. "Current: beep.mp3", or
  "No file")
- a Pico file input:
  `<input type="file" id="grp.key" name="grp.key" accept="...">`
- an Upload button, grouped with the input:
  `<div role="group"><input ...><button type="button">Upload</button></div>`
- a `<progress>` element, hidden until an upload starts
- a Cancel button, hidden until an upload starts
- an inline status/error line

Pico already styles `input[type=file]`, its `::file-selector-button`, `progress`,
and `role=group`; no new CSS variables are required. **PLAN REVIEW:** confirm
Pico's `role=group` does not produce an undesirable width/height on the file
input; if it does, use a plain `<div>` with a small explicit style instead.

### Local checks before upload

On file selection, the browser checks:

- file is non-empty;
- `file.size <= max_size` (when set);
- the filename/MIME matches `accept` (simple extension and `type/` prefix
  matching, case-insensitive).

On failure, show the reason inline and keep Upload disabled. These checks are
advisory; the device preflight is authoritative.

### Upload flow

The lock is the union of two sources:

```js
locked = localUploading || serverUploading;   // serverUploading = msg._meta.uploading
```

`localUploading` is set immediately on Upload click for responsiveness;
`serverUploading` comes from the `_meta.uploading` meta flag and covers other tabs
and reconnects. `updateUI()` must derive Save/Reset/Reboot/upload enablement
from `locked`, not from `_meta.dirty` alone — otherwise a dirty push arriving
mid-upload would re-enable Save.

1. User picks a file; Upload becomes enabled.
2. Click Upload:
   - set `localUploading = true`;
   - run `updateUI()` to disable Save, Reset, Reboot, all upload buttons, and
     the current input;
   - show `<progress max="100" value="0">` and Cancel;
   - `POST` the preflight JSON.
3. On preflight failure: show the response text, clear `localUploading`, run
   `updateUI()`.
4. On preflight success: `PUT` the raw `File` with
   `?name=encodeURIComponent(file.name)&type=encodeURIComponent(file.type)`,
   `Content-Type: application/octet-stream`, using `XMLHttpRequest` for
   `upload.onprogress`. Update `<progress>` as bytes are sent.
5. On `load`:
   - `2xx`: show "Uploaded" (and "Save to apply" if the device later pushes
     `_meta.dirty`); clear `localUploading`; run `updateUI()`.
   - non-2xx: show the response text; clear `localUploading`; run `updateUI()`.
6. On `error`/`abort`: show "Upload failed" / "Upload cancelled"; clear
   `localUploading`; run `updateUI()`.
7. Cancel calls `xhr.abort()` and relies on the device's disconnect → `ABORT`.
8. While `locked`, `beforeunload` warns. The device also returns `409` from
   save/reset/reboot, so a second tab cannot corrupt a deferred temp file.

### Value and conflict handling

- The browser never reads or writes a file field's value as an editable form
  value.
- `serialize()`, `getPending()`, `buildPatch()`, `readFormValue()`, and the
  Save body exclude `type === 'file'` fields.
- When the server pushes a settings update that changes a file field's
  `value`, the browser updates the "Current:" line silently. It must not show
  the external-change notification or a conflict prompt for a file field,
  because the user cannot have a competing local edit.
- After a successful deferred upload, the developer sets the label and dirty;
  the browser sees the new label and the Save button. Reset restores the
  previous label via the developer's `on_reset` (and `prsl_push`).
- For immediate uploads, the developer may leave the value unchanged; the
  upload status still reports success.

### Multiple clients

- One upload globally. A second upload (from any browser) gets `409`.
- Every tab learns `_meta.uploading` from the settings push and locks Save, Reset,
  Reboot, and upload controls. A tab that connects mid-upload gets `true` in
  its initial settings payload.
- The device guards are authoritative; the client lock is only UX.
- The UI still shows the local upload's progress in the tab that started it.
  Other tabs show a status line such as "Another upload is in progress." (The
  exact copy is a builder call.)

## Server internals

### Store / registration

- Add `PRSL_FILE` to `prsl_type_t`.
- Add to `prsl_field_t`: `prsl_upload_cb_t on_upload; const char *accept;
  size_t max_size; uint32_t idle_timeout_ms;` (unused for non-file fields).
  `attrs`/`parsed_attrs` already exist on `prsl_field_t`; `prsl_add_file_field`
  copies `opts->attrs` into them.
- `prsl_add_file_field` validates and calls `prsl_store_add_field`.
- `prsl_add_field(PRSL_FILE, ...)` returns `ESP_ERR_INVALID_ARG`.
- `prsl_json.c` maps `PRSL_FILE` to `"file"` and emits `accept`/`max_size` when
  set.
- `prsl_store_load_values` / `prsl_store_reset_values` call `on_get` normally.

### Apply / save protection

`prsl_apply_body` must skip file fields explicitly:

```c
if (f && f->type == PRSL_FILE) { field = field->next; continue; }
```

This prevents a crafted WS apply or save body from setting the file label. The
same function backs `prsl_apply_save_body`, so one check covers both.

### Upload state

Use one static state object (host-testable core):

```c
typedef struct {
    bool active;        /* upload in progress / guards engaged */
    bool meta_sent;     /* META delivered */
    bool finished;      /* reached END successfully */
    bool aborted;       /* ABORT already delivered; exactly-once guard */
    prsl_field_t *field;
    char name[128];
    char mime[64];
    size_t size;
    size_t offset;
    char err[128];
    int status;         /* callback status hint, or 0 */
    esp_err_t result;
} prsl_upload_state_t;
```

- No heap allocation per request.
- `active` is the **process-global** one-at-a-time lock. It is not stored in
  `prsl_store_t` and is not reset by per-store operations. It drives the
  `_meta.uploading` flag and every guard, regardless of endpoint/namespace.
- `name` is the decoded basename, truncated/rejected per the length rule.
- The core functions `prsl_upload_begin/chunk/end/abort` take the state and
  callback; the HTTP glue is thin. This lets native tests exercise the state
  machine without `AsyncWebServerRequest`.
- `ABORT` is delivered exactly once: the `aborted` flag is set before the
  callback; subsequent disconnect/timeout/stop paths see it and do nothing.
- `prsl_is_uploading()` returns `g_upload.active && !g_upload.finished`.
- Every settings payload builder adds `_meta.uploading` from
  `prsl_is_uploading()` — never from the store. If multiple stores/endpoints are
  introduced, they all read the same global state.
- `prsl.cpp` guards the save/reset/reboot handlers and public `prsl_reset()`
  on `prsl_is_uploading()` as described in "Device guards while uploading".
- Upload start/end calls the push path(s) so `_meta.uploading` reaches every tab on
  every endpoint. Today that is `prsl_push()`; future endpoints must use the
  same global value.

### Abort / timeout

- The fork provides `AsyncWebServerRequest::onDisconnect(std::function<void()>)`
  and `AsyncClient::setRxTimeout(uint32_t)`. Disconnect fires on normal close
  too, so the handler must check `state.finished`.
- On disconnect before `END`: call `ABORT`, set `active = false`, clear the
  state. Do not touch the request after that.
- On idle timeout: the client closes, which triggers disconnect; the same path
  calls `ABORT`. **PLAN REVIEW:** verify the timeout unit and that a stalled
  request's body handler is not called after close.
- On `prsl_stop`: if active, call `ABORT`, clear, then stop.

### Response timing

- The fork invokes the request handler after the body completes. The request
  handler sends the final response. Do not send a response from `META`/`CHUNK`
  and then also send from the request handler.
- For early rejection, record the error in the state and let the final handler
  send it. The remaining body is discarded. The preflight is the mechanism that
  avoids large wasted transfers.
- For OTA, the developer must return from `END` before rebooting. A reboot
  inside `END` would drop the HTTP response. Document: return `ESP_OK`, let the
  library respond, then schedule `esp_restart()` (e.g. a short timer). The
  browser treats a dropped connection after 100% as "device restarting".

## Security

- Uploads and settings are unauthenticated by default, matching the current UI.
  This is a documented sharp edge, especially for firmware upload.
- The library does not add auth hooks. The 1.0 security item covers endpoint
  partition (`/user` vs `/admin`), HTTP Basic/Digest + middleware, and WS auth.
- Treat the filename as untrusted: use the basename only, cap length, reject
  control characters, and document path-traversal risk if the developer uses
  the name to build a filesystem path.
- The preflight and PUT both enforce `max_size`; actual received bytes are
  counted and must not exceed `Content-Length` or `max_size`.
- The browser never renders the file label or uploaded name with `innerHTML`;
  use `textContent`.
- Cross-origin PUT with a non-simple content type triggers a CORS preflight the
  device does not answer, which blocks casual cross-site uploads in browsers.
  This is not a security boundary; LAN clients can still use raw HTTP.

## Examples and docs

### Minimal working example (`examples/simple/main.c`) — start here

One field, one group, one callback. The only content check is "the first byte
must be `{`"; everything else is a temp-file rename plus the declarative
`max_size`/`accept` guards. This is the "easy case".

```c
/*
 * Minimal file upload: replace /config.json with a JSON object uploaded from
 * the browser. The old file survives until the new one is complete.
 *
 * Flow:
 *   preflight (accept/max_size) -> raw PUT ->
 *   META (open temp) -> CHUNK* (check first byte, write) ->
 *   END (rename temp to final) or ABORT (delete temp).
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "LittleFS.h"
#include <stdio.h>

/* Final file, temp file, and a device-enforced hard limit. */
#define CONFIG_PATH "/config.json"
#define CONFIG_TMP  "/config.tmp"
#define CONFIG_MAX  (8 * 1024)

/* The library allows one upload at a time, so one global handle is enough.
 * Every byte written here came through on_config() below. */
static File g_file;

/* on_get is the load hook: it returns the label the browser shows after boot
 * and after Reset. Check storage so a reboot shows the right state. */
static const char *config_label(void) {
    return LittleFS.exists(CONFIG_PATH) ? "config.json" : "none";
}

/* The upload callback runs in the ESPAsyncWebServer task. Write data
 * synchronously: u->data is only valid during this call. */
static esp_err_t on_config(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        /* No bytes yet; u->name/u->size/u->mime are available. Reject here to
         * avoid writing anything. The library already enforced max_size and
         * the accept filter; this is the developer's hook for extra rules. */
        g_file = LittleFS.open(CONFIG_TMP, "w");
        if (!g_file) {
            snprintf(u->err, u->err_len, "Cannot open temp file");
            return ESP_FAIL;                    /* browser shows this text */
        }
        break;

    case PRSL_UPLOAD_CHUNK:
        /* One sanity check: the first byte of the first chunk must be '{'.
         * Reject before writing, so an mp3 renamed to .json never lands. */
        if (u->offset == 0 && (u->len == 0 || u->data[0] != '{')) {
            snprintf(u->err, u->err_len, "Not a JSON object");
            return ESP_ERR_INVALID_ARG;
        }
        /* Write this chunk. A short write is a device error. */
        if (g_file.write(u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Write failed");
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        /* All bytes arrived. Swap the temp file into place. Do not set dirty:
         * this example applies immediately; there is nothing for Save to do. */
        g_file.close();
        LittleFS.remove(CONFIG_PATH);           /* see the backup note below */
        if (!LittleFS.rename(CONFIG_TMP, CONFIG_PATH)) {
            snprintf(u->err, u->err_len, "Rename failed");
            return ESP_FAIL;                    /* ABORT deletes the temp */
        }
        prsl_set_str("config.file", "config.json");
        prsl_push();                            /* update every open browser */
        break;

    case PRSL_UPLOAD_ABORT:
        /* Cancel, disconnect, idle timeout, or a rejection above. Clean up
         * exactly once; never leave a partial file behind. */
        if (g_file) g_file.close();
        LittleFS.remove(CONFIG_TMP);
        break;
    }
    return ESP_OK;
}

/* Registration: limits are device-enforced; accept is a picker/hint.
 * help is rendered under the field. attrs could add extra HTML (e.g. title). */
static const prsl_file_opts_t config_opts = {
    .on_get = config_label,
    .on_upload = on_config,
    .accept = ".json,application/json",
    .max_size = CONFIG_MAX,
    .help = "JSON config, up to 8 KiB",
};

void app_main(void) {
    LittleFS.begin(true);                       /* format on first use */

    /* Minimal AP; replace with your normal WiFi setup. */
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-config", NULL);
    AsyncWebServer server(80);

    /* Register groups before fields; finish all registration before init. */
    prsl_add_group("config", "Config");
    prsl_add_file_field("config", "file", "Config file", &config_opts);
    prsl_init(&server, NULL, NULL, NULL);       /* no save/reset/reboot here */
    prsl_start();                               /* serve the UI + endpoints */
}
```

What keeps it safe:

- **`max_size`** is enforced by the device, not just the browser.
- **`accept`** filters the picker and the declared name/MIME; it is a hint, not
  the guard.
- **First byte must be `{`** is the one content check; adjust it to your format
  if needed (e.g. allow leading whitespace).
- **Temp file + rename** means the old config survives until the new one is
  complete; `ABORT` deletes the temp file.
- The example removes the old final before renaming. For a stricter replacement,
  keep a `.bak` and restore it if the rename fails; that is a production
  refinement, not needed to get started.

### Complete OTA example (`examples/ota/main.c`)

This is a full example, not a fragment. It registers the field, starts the
server, and handles the whole lifecycle. Arduino users call the same body from
`setup()`; the `app_main` style matches `examples/basic/main.c`.

```c
/*
 * OTA firmware upload: validate the image, stream it into the OTA partition
 * with Arduino Update, then reboot. The HTTP response must be sent before
 * esp_restart(), so the reboot runs in a task with a short delay.
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include <Update.h>
#include <esp_system.h>
#include <stdio.h>
#include <string.h>

/* Extension check is a cheap sanity guard; Update.end() validates the image. */
static bool ends_with(const char *s, const char *suffix) {
    size_t n = strlen(s), m = strlen(suffix);
    return n >= m && strcmp(s + n - m, suffix) == 0;
}

/* Set only after Update.begin() succeeds, so ABORT is safe on early rejects. */
static bool g_ota_started;

static void reboot_task(void *arg) {
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(1000));   /* let the HTTP response flush */
    esp_restart();
}

static const char *fw_label(void) {
    return "firmware.bin";
}

static esp_err_t on_fw(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        /* Metadata only: reject before any bytes are written. */
        if (!ends_with(u->name, ".bin")) {
            snprintf(u->err, u->err_len, "Expected a .bin image");
            return ESP_ERR_INVALID_ARG;           /* 400 */
        }
        /* Update.begin() checks the image against the OTA partition. */
        if (!Update.begin(u->size)) {
            snprintf(u->err, u->err_len, "Image does not fit");
            return ESP_FAIL;                      /* 400 */
        }
        g_ota_started = true;
        break;

    case PRSL_UPLOAD_CHUNK:
        /* Stream each network chunk into the OTA partition. */
        if (Update.write((uint8_t *)u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Flash write failed");
            u->status = 500;                      /* device error, not bad file */
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        /* Finalize and schedule the reboot after the HTTP response is sent. */
        if (!Update.end(true)) {
            snprintf(u->err, u->err_len, "Invalid image");
            return ESP_FAIL;                      /* 500 */
        }
        g_ota_started = false;
        xTaskCreate(reboot_task, "reboot", 2048, NULL, 5, NULL);
        break;

    case PRSL_UPLOAD_ABORT:
        /* Cancel, disconnect, timeout, or a rejection above. */
        if (g_ota_started) {
            Update.abort();
            g_ota_started = false;
        }
        break;
    }
    return ESP_OK;
}

static const prsl_file_opts_t fw_opts = {
    .on_get = fw_label,
    .on_upload = on_fw,
    .accept = ".bin,application/octet-stream",
    .max_size = 0,              /* Update.begin() checks the OTA partition */
    .idle_timeout_ms = 30000,
    .help = "Firmware .bin image",
};

void app_main(void) {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-ota", NULL);
    AsyncWebServer server(80);

    prsl_add_group("system", "System");
    prsl_add_file_field("system", "firmware", "Firmware", &fw_opts);
    prsl_init(&server, NULL, NULL, NULL);
    prsl_start();
}
```

ESP-IDF (`esp_ota_begin/write/end/abort`) gets the same shape in the docs.
Do not call `esp_restart()` inside `END`; the HTTP response must be sent first.

### Complete deferred example (`examples/upload/main.c`)

This is the "try before Save" pattern: chunks go to a temp file, the field is
marked dirty at `END`, Save commits, Reset discards. It is a full example.

```c
/*
 * Deferred upload: chunks go to a temp file; END marks the form dirty so Save
 * appears. Save promotes temp -> final; Reset discards the temp and restores
 * the previous label. The existing final file is untouched until Save.
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "LittleFS.h"
#include <stdio.h>
#include <string.h>

#define CLIP_MAX   (512 * 1024)
#define CLIP_TMP   "/clip.tmp"
#define CLIP_FINAL "/clip.mp3"
#define CLIP_LABEL "clip.mp3"

static File g_file;
static bool g_pending;      /* a temp upload is waiting for Save */

/* Load hook: label shown after boot and after Reset. */
static const char *clip_label(void) {
    return LittleFS.exists(CLIP_FINAL) ? CLIP_LABEL : "none";
}

static esp_err_t on_clip(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        /* Open temp; the existing final file is not touched yet. */
        g_file = LittleFS.open(CLIP_TMP, "w");
        if (!g_file) {
            snprintf(u->err, u->err_len, "Cannot open temp file");
            return ESP_FAIL;
        }
        g_pending = true;
        break;

    case PRSL_UPLOAD_CHUNK:
        /* Write each network chunk to the temp file. */
        if (g_file.write(u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Write failed");
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        /* Upload complete, but not committed. Show a pending label and mark
         * dirty so the Save button appears. */
        g_file.close();
        prsl_set_str("audio.clip", "clip.mp3 (pending)");
        prsl_set_dirty(true);
        prsl_push();
        break;

    case PRSL_UPLOAD_ABORT:
        /* Cancel, disconnect, timeout, or a rejection: discard the temp. */
        if (g_file) g_file.close();
        LittleFS.remove(CLIP_TMP);
        g_pending = false;
        break;
    }
    return ESP_OK;
}

/* Save: promote the temp file to the final name, then update the label. */
static esp_err_t save(void) {
    if (!g_pending) return ESP_OK;
    LittleFS.remove(CLIP_FINAL);
    if (!LittleFS.rename(CLIP_TMP, CLIP_FINAL)) return ESP_FAIL;
    g_pending = false;
    prsl_set_str("audio.clip", CLIP_LABEL);
    return ESP_OK;
}

/* Reset: discard the temp and restore the label of the current final file. */
static esp_err_t reset(void) {
    if (g_pending) {
        LittleFS.remove(CLIP_TMP);
        g_pending = false;
    }
    prsl_set_str("audio.clip", clip_label());
    return ESP_OK;
}

static const prsl_file_opts_t clip_opts = {
    .on_get = clip_label,
    .on_upload = on_clip,
    .accept = ".mp3,audio/*",
    .max_size = CLIP_MAX,
    .idle_timeout_ms = 30000,
    .help = "MP3, up to 512 KiB. Save applies it.",
};

void app_main(void) {
    LittleFS.begin(true);
    LittleFS.remove(CLIP_TMP);          /* drop a stale pending upload */
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-upload", NULL);
    AsyncWebServer server(80);

    prsl_add_group("audio", "Audio");
    prsl_add_file_field("audio", "clip", "Clip", &clip_opts);
    prsl_init(&server, save, reset, NULL);   /* Save commits, Reset discards */
    prsl_start();
}
```

For immediate mode, rename the temp file at `END` instead of setting dirty;
omit `on_save`/`on_reset`. The rest of the life cycle is unchanged.

### JSON config variant

The two complete examples above cover immediate and deferred storage. A config
file is the same pattern with an in-RAM buffer:

- `META`: check `max_size` against a RAM budget; allocate a buffer only if the
  developer accepts that budget.
- `CHUNK`: append to the buffer.
- `END`: parse and apply; optionally set a canonical label
  (`prsl_set_str("config.file", "config.json")`); free.
- `ABORT`: free.

### Documentation tasks

- Add the complete examples above as `examples/simple/main.c`,
  `examples/ota/main.c`, and `examples/upload/main.c`, and compile-check them in
  CI (extend the PIO smoke or add a small example project). The listings must
  stay in sync with the shipped files.
- `API_REFERENCE.md`: document `prsl_add_file_field`, the event lifecycle, the
  label-vs-uploaded-name distinction, `accept` as a UI filter (not security),
  `attrs` as presentation-only, and **why file fields use a dedicated
  registration function instead of `prsl_add_field`** (the scalar-widget data
  contract vs. the stream contract; the rejected alternatives).
- `include/prsl.h`: put the same short rationale on `prsl_add_file_field` and
  the `ESP_ERR_INVALID_ARG` note on `prsl_add_field`.
- `docs/reference/field-format.md`: add the `file` type and its options. The
  full per-field-type options matrix is deferred to `docs/BACKLOG.md`.
- `WS_PROTOCOL.md`: add `_meta.uploading` to the settings message and note that it
  is device-global.
- `README.md`: add upload to the feature list and troubleshooting (limits,
  `accept` is advisory, unauthenticated by default).
- `CHANGELOG.md`: 0.8.0 entry.

## Testing

### Native (host, C/C++)

- Registration: `prsl_add_file_field` validation; `prsl_add_field(PRSL_FILE)`
  returns `ESP_ERR_INVALID_ARG`; duplicate field; unknown group.
- Preflight checks: unknown field/type, busy, empty name, control chars, long
  name, size 0, size over `max_size`, `accept` extension/MIME match/mismatch.
- State machine: META → CHUNK* → END; META rejection; CHUNK rejection; ABORT
  after partial data; no CHUNK after a rejection; END only once.
- **ABORT exactly once** on META rejection, CHUNK rejection, END error,
  disconnect, idle timeout, and `prsl_stop`; never after a successful END and
  never twice.
- Error text and `status` propagation: default 400 for META/CHUNK, 500 for END;
  a non-zero callback `status` wins.
- Actual received bytes over `Content-Length`/`max_size` → 413 and ABORT.
- `_meta.uploading` is true from the first META until END/ABORT, false otherwise;
  it appears in the settings payload and is pushed on start/end.
- `prsl_is_uploading()` agrees with `_meta.uploading` and is true across stores /
  endpoints (test with a second payload builder or a host double).
- One-at-a-time: second begin rejected while active, including across
  endpoints.
- `prsl_stop` during active upload calls ABORT and clears.
- Guard helper: `prsl_reset()` returns `ESP_ERR_INVALID_STATE` while active.
  The save/reset/reboot HTTP guards are covered by e2e unless the core exposes
  a host-testable check.
- Apply/save skip: a body containing a file field does not change its value;
  `on_set` is not called; the store keeps the label.
- `on_get` load and reset.
- JSON output contains `"file"`, `value`, `accept`, `max_size`, `help`, and
  `attrs` when set; no `idle_timeout_ms`.

### JS unit (jsdom + mocked XHR)

- Renders file fields with Pico markup, current label, help, `accept`, `attrs`,
  Upload disabled until a file is selected.
- Local checks: empty, too large, wrong extension/MIME.
- Preflight success/failure; error text displayed.
- Progress updates; Cancel calls `xhr.abort()`.
- Upload lock disables Save/Reset/Reboot and other uploads; restores on
  completion/failure/cancel.
- `_meta.uploading: true` from the server locks Save/Reset/Reboot/upload controls in
  every tab, including a tab that connects mid-upload.
- A dirty push arriving while `_meta.uploading` is true does not re-enable Save.
- `_meta.uploading: false` restores Save (if dirty) and the device actions.
- File fields excluded from `serialize()`, `getPending()`, `buildPatch()`, and
  the Save body.
- Server-pushed label updates update the display silently (no external-change
  bar, no conflict prompt).
- Dirty push after a deferred upload shows Save.
- `beforeunload` while uploading or while `_meta.uploading` is true.

### E2E (Playwright + Python test server)

Add preflight/PUT handlers to `test_server/main.py` and a test-only way to
inspect accepted bytes (e.g. write to `test-results/uploads/` or a test-only
GET). Cover:

- happy path: pick a file, upload, progress, success; byte content matches;
- oversize/wrong type rejected at preflight (no PUT observed);
- cancel mid-upload: server sees disconnect/ABORT; no committed file;
- deferred flow: upload → Save appears → Save commits → Reset discards;
- immediate flow: upload → no Save;
- second upload while one is active gets 409;
- reconnect/WS down during upload: upload still completes; the label appears on
  reconnect;
- upload lock disables the device actions;
- a second tab receives `_meta.uploading: true` and locks its controls;
- direct `POST /api/settings/save`, `/api/settings/reset`, and
  `/api/system/reboot` during an upload return `409`;
- `_meta.uploading` returns to false after END, ABORT, cancel, and timeout.

### PIO smoke

Compile and link the new API + one example against the pinned fork. The smoke
test should include a file field registration and a callback that references
the event fields.

### Budget

Measure `app.min.js` min+gzip delta. Target **≤ +1.2 KB gzip**; review and
simplify if it exceeds **+1.5 KB**.

## Versioning and migration

- 0.7.0: release the already-implemented architectural decisions + asset
  generator fix. Tag `v0.7.0` before starting upload.
- 0.8.0: this feature. Minor bump: new API, new field type, new HTTP surface.
  No breaking change to existing fields.
- 1.0.0: after the backlog's before-1.0 items are resolved (contract freeze,
  security, hardware verification, distribution).

## Deferred (tracked in `docs/BACKLOG.md`)

- Authentication/authorization (endpoint partition + Basic/Digest + WS auth).
- Upload chunk-size option.
- Filename pattern beyond `accept`.
- Modal/confirmation for destructive uploads.
- File download.
- Export/import settings.
- Resumable/multi-file uploads.
- OTA convenience helpers in the library.
- Per-field-type options matrix in `docs/reference/field-format.md`.
- Structured file metadata (size/checksum) instead of a plain string label.
- Built-in file-size display (use the label or a status field for now).

## Risks / open items

- **PLAN REVIEW:** `AsyncClient::setRxTimeout` unit and behavior; confirm a
  stalled upload reaches `onDisconnect` and does not deliver more body chunks.
- **PLAN REVIEW:** `AsyncURIMatcher` prefix route vs. per-field exact routes;
  URI string lifetime.
- **PLAN REVIEW:** registering `request->onDisconnect` from the first body
  callback covers disconnects after the first chunk. A disconnect between
  headers and first chunk has nothing to clean up, but confirm no state leaks.
- **PLAN REVIEW:** early rejection: the fork keeps reading/discarding the body
  after the callback rejects. Confirm the final handler still runs and can send
  the error response. If not, the preflight must be the only rejection path, or
  the library must close the connection after a response.
- **PLAN REVIEW:** Pico `role=group` + `input[type=file]` layout; verify in
  Chromium/Firefox/Safari.
- **PLAN REVIEW:** `Content-Length` is required; confirm the fork does not
  silently support chunked PUT in a way that breaks the size check. If chunked
  is accepted, count bytes and enforce `max_size`; otherwise return 411.
- **Decision:** `accept` checks extensions always and MIME types when the PUT
  carries `type`; extensions are the practical path. The browser always sends
  `type`.
- **Decision:** default `idle_timeout_ms` is 30000. Validate on slow WiFi during
  hardware testing; it should be long enough not to kill a slow transfer and
  short enough to free a stuck OTA slot.
- **PLAN REVIEW:** `prsl_push()` from the upload path (first META, END, ABORT)
  runs in the async TCP task and takes the store mutex. Confirm no deadlock with
  the save handler (which holds the mutex while calling `on_save`) and that the
  push does not block long enough to stall the upload.
- **PLAN REVIEW:** the save/reset/reboot guards read the upload-active flag from
  the async task; public `prsl_reset()` may be called from another task. Confirm
  the flag is safely published (e.g. protected by the store mutex or an atomic),
  not a plain `bool` with a data race.
- **PLAN REVIEW:** the Python test server must emit `_meta.uploading` and enforce the
  same `409` guards; otherwise e2e does not exercise the real contract.
- **When endpoints are partitioned:** every settings payload builder must
  include the same process-global `_meta.uploading` value, and every save/reset/reboot
  handler must check `prsl_is_uploading()`. Add a test that a second
  endpoint/namespace still reports the global flag; do not copy the flag into
  per-endpoint state.
- **Multi-endpoint message ordering:** with one socket, `_meta.uploading` messages
  are ordered. If multiple settings sockets are introduced, decide how the
  client merges the global flag so a stale `false` from one socket cannot unlock
  another during an upload (e.g. a device-global epoch or an authoritative
  endpoint). Not needed for 0.8.0's single endpoint.
