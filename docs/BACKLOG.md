# Parasol Backlog

Living list of open work. Dated specs and plans under `docs/superpowers/` are
historical records; this file is the current source of truth for what is still
outstanding. Add items here instead of leaving them buried in prose.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[-]` dropped/superseded

Last updated: 2026-11-11

## Before 1.0

Release sequence:

1. **0.7.0** — already-implemented architectural decisions + asset generator
   fix.
2. **0.8.0** — generic file upload.
3. **0.9.0** — client echo-correlation fix (wire change; shipped).
4. **1.0.0** — after the contract/security/hardware/distribution items below.

### Release 0.7.0

- [x] Finish the asset-generator unification (`cmake/generate_assets.cmake` →
  `scripts/generate_assets.py`). Verify committed assets, ESP-IDF path, and CI
  drift checks.
- [x] Run the full suite (`npm test`), bump/confirm `library.json` 0.7.0,
  update README install URLs and CHANGELOG, tag `v0.7.0`.

### 0.8.0 — Generic file upload

Design: `docs/superpowers/specs/2026-11-10-file-upload-design.md`.

- [x] Streaming upload field inside a settings section (Pico file input +
  Upload button + progress + Cancel), inline; no modal.
- [x] Registration via dedicated `prsl_add_file_field(...)`; reject
  `prsl_add_field(PRSL_FILE, ...)` with a clear error.
- [x] `on_upload` lifecycle: `PRSL_UPLOAD_META` → `CHUNK` → `END` / `ABORT`.
- [x] Per-field `max_size`, `accept`, `idle_timeout_ms`.
- [x] Preflight `POST` + raw `PUT`; one upload at a time (`409`); required
  `Content-Length`; inline progress via XHR.
- [x] Field value is a developer-defined file label (not necessarily the
  upload name), read-only to the browser; file fields skipped in WS apply /
  save body. `on_upload` receives the original `u->name`.
- [x] `attrs` for presentation-only HTML extras (e.g. `title`, `aria-*`);
  `accept`/`max_size`/`idle_timeout_ms` stay typed.
- [x] Upload lock: disable Save, Reset, Reboot and other uploads while a
  transfer is active. `_meta.uploading` is **device-global**: every settings
  payload (including future endpoints/namespaces) carries the same value, and
  every save/reset/reboot handler checks the global state. 0.8.0 adds the
  `_meta` box as the only meta container (no legacy aliases).
- [x] Docs + complete examples: `examples/simple/main.c` (minimal JSON upload
  with one content guard), `examples/ota/main.c` (respond, then reboot),
  `examples/upload/main.c` (temp file → dirty → `on_save` commit / `on_reset`
  discard), plus the bounded JSON pattern. Compile-check the examples in CI.
- [x] Native, unit, e2e, and PIO-smoke tests; measure JS min+gzip delta
  (target ≤ +1.2 KB gzip, review at +1.5 KB). Measured +1,704 gzip — reviewed
  and accepted (see `CHANGELOG.md` 0.8.0).

Deferred from this feature (tracked separately below): auth, upload chunk size,
filename pattern, modal/confirmation, download.

### Deferred from 0.9.0 (client ack correlation)

Design: `docs/superpowers/specs/2026-11-11-client-ack-correlation-design.md` §12.

- [ ] **Continue past a rejection on the WS apply path.** The first rejection
  aborts the batch and leaves the tail fields unattempted. Reporting every
  failing key is a good fix, but it is independent of the wire change and does
  not block 0.9.0 (the ack's dense `d` already keeps the tail coherent).
- [ ] **"Server adjusted this" notice.** Client-derived from `d` vs `sent`; no
  wire change. Deliberately not in 0.9.0 — silent acceptance was chosen.
- [ ] **Fire-and-forget action field type**, so one-shot actions stop wearing a
  value field's clothes.
- [ ] **`_meta.v` device-wide version**, only if the in-flight guard proves to
  drop pushes in practice.
- [ ] **Per-field timeout**, only if someone asks. It would ride in every
  field's `opts` forever for a rare need.
- [ ] **Server-side last-processed-ticket memory.** Would make automatic resend
  provably safe; rejected for 0.9.0 to keep the device stateless.
- [ ] **Bound consecutive syncs when the store omits a recovering key.** A sync
  reply that resolves nothing re-arms `maybeSync()`, so a store that never
  reports a recovering key can keep the client syncing until the sync timeout.
  Cap the consecutive recovery rounds (found in the 0.9.0 budget review).

### 1.0 contract and release

- [x] **Client echo-correlation gap** — fixed in 0.9.0 (ack correlation; see
  `docs/superpowers/specs/2026-11-11-client-ack-correlation-design.md`).
- [ ] **Security posture.**
  - [ ] Protect the API with HTTP Basic/Digest + middleware, and partition
    fields by access level (e.g. `/user` vs `/admin`). The ESPAsyncWebServer
    fork supports `setAuthentication()` and `AsyncAuthenticationMiddleware`;
    "classic htaccess" maps to this.
  - [ ] Solve WebSocket authentication (browsers cannot set `Authorization` on
    a WS handshake): cookie/session or token handshake.
  - [ ] Document that uploads and settings are unauthenticated by default.
  - [ ] Treat filenames as untrusted (basename only, length cap, path-traversal
    warning); consider CSRF/DoS guidance.
- [ ] **Real-hardware verification.** OTA end-to-end, LittleFS/SD writes,
  disconnect → `ABORT`, idle timeout, `prsl_stop()` mid-upload, real save/reset.
  Consider hardware/QEMU coverage in CI.
- [ ] **`prsl_stop()` request quiescing.** `prsl_stop()` deinitializes the store
  and stops the server while save/reset/reboot/preflight handlers may still be
  running in the AsyncTCP task. This is a pre-existing race; 0.8.0 only
  serializes upload body callbacks with an upload mutex. Add an in-flight
  request counter (or equivalent stopping barrier) that waits for all handlers
  before deinit, or make the AsyncTCP-task-only contract explicit and enforce
  it. Cover with a host test and the 1.0 hardware check.
- [ ] **Distribution.** Publish to the PlatformIO Registry (`pio pkg pack`,
  account). Document the Arduino IDE limitation (dependency graph).
- [ ] **Stability promise.** Freeze public API and wire format; document semver,
  deprecation policy, and the 0.8 → 1.0 migration.
- [ ] **Release checklist/docs.** README, `API_REFERENCE.md`, `WS_PROTOCOL.md`,
  `docs/reference/field-format.md` (upload), CHANGELOG, examples, tags.
- [x] **Test-server fidelity.** `_show_reset` was sent as `_dirty`; the device
  sends `prsl_has_reset()`. Aligned in 0.8.0: the test server sends
  `_meta.show_reset: True` and the existing Reset e2e tests pass.
- [ ] **Multi-client/reconnect review.** Verify multiple tabs and reconnect
  during an upload / dirty state before declaring 1.0.

## After 1.0

- [ ] Export/import settings (download JSON, restore by upload). Old backlog
  item 10; intentionally after 1.0.
- [ ] File download (counterpart to upload).
- [ ] Structured file metadata (size/checksum) instead of a plain string label.
- [ ] Built-in file-size display (use the label or a status field for now).
- [ ] Upload chunk-size option (device-side coalescing / alignment).
- [ ] Filename pattern validation (custom glob/regex) beyond `accept`.
- [ ] Optional upload confirmation (modal or `confirm` field option) for
  destructive uploads.
- [ ] mDNS discovery.
- [ ] Additional device actions in `#nav-actions` (the responsive-nav design
  anticipates future rows).
- [ ] Status sub-topics (subscribe to `status.system.heap` only).
- [ ] Status history/graph for numeric values (client-side accumulation).
- [ ] Client-side accordion merge for settings + status.
- [ ] Client auto-prefixing of status component IDs.
- [ ] Render status fields without destroying settings DOM (future
  optimization noted in
  `docs/superpowers/specs/2026-06-24-code-issues.md`).

## Docs / reference

- [ ] Per-field-type options matrix in `docs/reference/field-format.md`
  (scalar widgets vs. file; callbacks, wire keys, editability, device-enforced
  options). Wanted, but not part of 0.8.0.

## Minor / test hygiene

- [ ] `.gitignore` has unanchored duplicate patterns (harmless).
- [ ] `tests/native/check_headers.sh` lacks a trailing newline and is not
  executable (invoked via `bash`).
- [ ] Native test for the `val_str == NULL → cJSON_CreateNull()` branch.
- [ ] Save-handler `err` is uninitialized on the unreachable `buf == NULL`
  fallback.
- [ ] `alwaysShow` unit test restores its meta tag without `try/finally`;
  `tests/setup.js` clobbers `document.head` (test-only).
- [ ] Busy-state test covers success but not failure-clearing.
- [ ] Nav divider between logo row and links (was deferred under the
  superseded flex-wrap approach; re-check against the current menu design).

## Resolved / superseded (do not re-open)

- [x] **Reset button visibility** — fixed in v0.6.4 (`989b6e7`): hidden unless
  `on_reset` is registered; the "Deferred" section in
  `2026-09-02-architectural-decisions-design.md` is stale and kept only for
  history.
- [x] Responsive nav Approach A (flex-wrap) — superseded by
  `2026-09-09-responsive-nav-menu-design.md`.
- [-] `_label` group override — superseded by the group `label` field.
- [-] `/api/system/restart` — implemented as `/api/system/reboot`.
- [-] `/api/firmware/upload` — generalized into the 0.8.0 file-upload field.
- [-] `GET /api/settings`, `POST /api/settings/apply` — removed in 0.6.0;
  re-verify the test server.
- [-] Library-owned auth hooks (per-field) — rejected; use endpoint partition +
  Basic/Digest middleware as part of the 1.0 security item.
