# Changelog

## 0.9.0
- BREAKING (wire): `action:"apply"` now requires a numeric `i`. A message without one is a protocol error — nothing is applied, nothing is broadcast, and the sender gets `type:"error"` (no ack is possible, because there is nothing to correlate to).
- New `type:"ack"` sent to the sender of every apply, including no-ops and all-rejected batches, and written before the resulting settings broadcast. `d` carries the decided `"group.key"` → value **read back from the store after `on_set`**, so transforms, discards, and fields with no `on_set` all report what is actually stored; `e` names the rejected key with reason `"rejected"`.
- Rejections stay abort-on-first for both WS apply and Save; `d` reports the untouched tail fields with their current stored values, so "never attempted" is not mistaken for "applied as sent".
- New `action:"sync"` recovery request: the standard settings payload goes to the requester only, tagged with the same `i`. Ordinary broadcasts still carry no `i`, so a reply is recognized exactly rather than as "the next push".
- Client: acks settle batches by key, not by value; `lastSent` adopts the decided value; transforms and discards update the widget silently when the user has not typed since; a rejection reverts the field and keeps it retryable. Batches settle independently, so one outstanding batch no longer blocks another, and `_meta` is applied before the in-flight guard so the Save button cannot stall.
- Client: bounded recovery ladder — `ack_timeout_ms` (default 5000, set in `parasol_config.json` and emitted as `<meta name="parasol-ack-timeout">`), then at most one `action:"sync"`, then at most one resend per key, then adopt the store value and stop. An unanswered sync is terminal.
- Server: the WS message handler moves to host-testable `src/prsl_ws_handle.c` (`prsl_ws_handle()`); `src/prsl_ws.cpp` is now glue.
- Server: `setCloseClientOnQueueFull(true)` disconnects a client whose send queue fills instead of silently dropping messages; the page reconnects with backoff.
- Docs: `WS_PROTOCOL.md` (required `i`, `ack`, `sync`, new state machine, queue policy), `API_REFERENCE.md` (ack guarantee, `on_set` idempotency and display contract), README, backlog. Spec: `docs/superpowers/specs/2026-11-11-client-ack-correlation-design.md`.
- JS budget: `app.min.js` 22,737 raw / 7,808 gzip vs `main` 20,877 raw / 7,218 gzip = **+1,860 raw / +590 gzip**, inside the +1.0 KB gzip target. (`gzip -9` on stdin, so no filename/mtime header; a bare `gzip -9 -c app.min.js` prints 7,819.)

## 0.8.0
- Generic file upload: `PRSL_FILE` field type + `prsl_add_file_field` / `prsl_file_opts_t` / `prsl_upload_t` / `prsl_upload_cb_t`. `prsl_add_field(PRSL_FILE, ...)` returns `ESP_ERR_INVALID_ARG`.
- Upload lifecycle `META → CHUNK* → END/ABORT` with an exactly-once `ABORT` guarantee (META/CHUNK rejection, END error, transport drop, idle timeout, and `prsl_stop()` each deliver `ABORT` exactly once; never after a successful `END`).
- HTTP surface: `POST /api/upload/<group>/<key>` (advisory preflight) + `PUT /api/upload/<group>/<key>?name=…&type=…` (raw body). Device-enforced guards: `max_size`, basename-only name (≤ 127 bytes, no `/`, `\`, control chars, `.`/`..`), `accept` filter, required `Content-Length` (`411`), one upload at a time (`409`).
- Settings payloads now carry a `_meta` box (`dirty`, `show_reset`, `show_reboot`, `uploading`) as the only meta container; `_meta.uploading` is device-global (true from first `META` until `END`/`ABORT`) and present in every settings payload.
- Upload lock: Save/Reset/Reboot and other uploads return `409` while an upload is active; the client disables those controls in every tab from `_meta.uploading`.
- `prsl_stop()` aborts an in-flight upload safely from another task (stopping flag + upload mutex); full save/reset/reboot quiescing is deferred to 1.0 (`docs/BACKLOG.md`).
- Examples: `examples/simple` (minimal JSON), `examples/ota` (respond then reboot), `examples/upload` (temp file → dirty → Save/Reset); compile-checked in CI.
- Docs: `API_REFERENCE.md`, `WS_PROTOCOL.md`, `docs/reference/field-format.md`, and the spec now cover the field type, wire `_meta`, and the HTTP contract.
- JS budget: `app.min.js` 20,877 raw / 7,218 gzip vs 0.7.0 baseline 15,857 / 5,522 = **+5,020 raw / +1,696 gzip**. This is 396 gzip above the original +1.3 KB target and 196 above the +1.5 KB review threshold; the remaining overage is the required upload lock, `_meta`, and local file-field UI.

## 0.7.0
- Responsive nav: always-present ☰ device menu; section links collapse into it on narrow screens (replaces the flex-wrap layout and the "System" dropdown); ☰ vertically centered with the nav and a hairline divider above the Reboot action.
- BREAKING: typed value pipeline — `on_set` now receives a `prsl_val_t *`; add `prsl_set_val`, `prsl_get_int`, `prsl_get_float`, `prsl_get_bool`. No JS/wire change.
- Reject `_`-prefixed group IDs at registration (`ESP_ERR_INVALID_ARG`).
- Add `prsl_stop()` lifecycle teardown (symmetric with `prsl_start`).
- Make `prsl.h` self-contained (payload builder moved to `src/prsl_store.h`).
- Switch dependency to the maintained `esp32async/ESPAsyncWebServer` fork; ship pre-baked assets + `scripts/generate_assets.py` regen with a CI drift guard.
- Fix ESP-IDF asset generation: CMake now delegates to `scripts/generate_assets.py` (the old CMake generator corrupted assets through CMake list handling; output is now byte-identical to the committed assets).
- Docs: `on_set` ownership contract, dirty sharp edge, typed getters, registration-order note.
- Verified merged quick-fix batch (issues 8/9/14/15, native harness) against this spec.
- Spec: docs/superpowers/specs/2026-09-02-architectural-decisions-design.md

## 0.6.4
- Fix prsl.h self-containment + const-correctness (compiles standalone in C/C++)
- Restore native C test harness (store + json unit tests)
- Fix /api/settings/save handler: chunked body accumulation, no data wrapper
- Show Reset only while dirty and `on_reset` is registered; reset clears _dirty
- aria-busy on Save during POST round-trip
- Replace C99 compound literals in docs + example
- Mobile nav horizontal scroll fix
- Documentation: prsl_get string-only, dead-Save warning, _-prefix reservation, PlatformIO setup, troubleshooting

## 0.6.3
- Fix reboot status-bar race with WS close handler

## 0.6.2
- Fix test-server _dirty recomputation and _show_reset broadcast

## 0.6.1
- Cache attrs JSON at registration (avoid re-parse on every push)
- Extract prsl_apply_body; dedup JSON body iteration
- prsl_add_field delegates to prsl_add_field_opts
- Mark stale design specs as superseded
- Document prsl_reset, prsl_has_reset, prsl_has_reboot
- Fix prsl_get TOCTOU (hold mutex, copy into static buffer)
- Hold store mutex during serialization
- Add MIT license

## 0.6.0
- Reboot button — nav dropdown + confirmation modal
- Shared `prsl_build_settings_payload()` helper eliminates triplicated settings payload construction
- `_show_reboot` flag in WS settings payloads (mirrors `_show_reset`)
- `POST /api/system/reboot` endpoint + `prsl_reboot_cb_t` callback type
- Removed `GET /api/settings` HTTP endpoint — reset flow relies on WS push
- Reset flow simplified: `processSettings()` clears `resetInProgress`

## 0.5.1
- Flatten library to repo root
- Release tarball creation in CI
- Remove cJSON git submodule (resolved by build systems)
- Fix ASSETS_SRC path for flat layout

## 0.5.0
- Developer-driven dirty flag (`prsl_set_dirty`)
- Typed setters: `prsl_set_str`, `prsl_set_int`, `prsl_set_float`, `prsl_set_bool`, `prsl_set_null`
- Reset button with `_show_reset` wire flag and `prsl_reset_cb_t` callback
- Recursive mutex for save transaction re-entry
- `always_show_save` config via `<meta>` tag
- `on_save` callback (replaces commit callback)
- `on_reset` callback
- WS apply uses `prsl_set_str`; `on_set` owns the write
- Notif-keep-local: re-send only conflicting fields, not entire form
- Save handler passes all field types to save callback

## 0.4.0
- Status variables with `prsl_field_opts_t.is_status`
- Form validation with `aria-invalid` and keep-open accordions
- Group name labels (labelFromKey fallback)
- Nav image + favicon support
- Checkbox indeterminate state
- Phase 4 wire format: groups with field arrays
- WebSocket notification bar for external changes
- Conflict resolution with Keep Local / Accept Server
- FreeRTOS mutex for thread-safe AV store access

## 0.3.0
- Module return pattern refactor
- Save handler rewrite with heap pairs and batching
- Caller-provided buffer for save payloads
- Naming drift fixes (purge stale `prsl_v1_*` names)
- E2E timing fixes

## 0.2.0
- Struct-based `prsl_field_opts_t` for per-field callbacks
- `prsl_get_cb_t` and `prsl_set_cb_t` callback types
- `prsl_init()` takes `on_save` callback
- CI pipeline and documentation

## 0.1.0
- Initial release
- ESP32 web-based configuration UI
- Pico CSS rendering of settings forms
- WebSocket protocol for real-time sync
- Checkbox revival and form validation
- Group registration and field types
