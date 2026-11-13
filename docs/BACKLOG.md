# Parasol Backlog

Living list of open work. Dated specs and plans under `docs/superpowers/` are
historical records; this file is the current source of truth for what is still
outstanding. Add items here instead of leaving them buried in prose.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[-]` dropped/superseded

Last updated: 2026-11-13

## 1.0 scope

Design: `docs/superpowers/specs/2026-11-13-1.0-scope-design.md`.

Release sequence:

1. **0.7.0** — architectural decisions + asset generator fix.
2. **0.8.0** — generic file upload.
3. **0.9.0** — client echo-correlation fix (wire change). Merged to `main`,
   tagged `v0.9.0`, README install URLs updated.
4. **1.0.0** — after the correctness, message, secure-example, hardware,
   and release items below.

The 1.0 code work is split into branches. Each branch carries its own
sub-spec; the docs branch is the integration point.

| Branch | Sub-spec | Status |
|---|---|---|
| `feature/1.0-correctness` | `2026-11-13-1.0-correctness-design.md` | [ ] |
| `feature/1.0-message-api` | `2026-11-13-prsl-message-design.md` | [ ] |
| `feature/1.0-secure-example` | `2026-11-13-secure-example-design.md` | [ ] |
| `docs/2.0-endpoints-actions` | `2026-11-13-2.0-endpoints-actions-design.md` | [ ] design only |

### 1.0 code work

- [ ] **Save-handler `err` initialization.** On the unreachable-in-practice
  `buf == NULL` fallback, the 400 response currently sends an uninitialized
  buffer. Initialize a real message. Branch: `feature/1.0-correctness`.
- [ ] **Bound sync recovery when a reply omits a key.** If a sync reply lacks
  a key the client is recovering, drop that key instead of re-arming another
  sync. Measured +11 gzip bytes. Unit test. Branch: `feature/1.0-correctness`.
- [ ] **`prsl_stop()` contract + stopping guard.** Document that it is a
  shutdown call, not a reboot step:
  - call from the main task (`setup()`/`loop()`) at a quiet moment,
  - never from `on_save` / `on_reset` / `on_reboot` / `on_upload`,
  - a reboot uses `esp_restart()` and does not need `prsl_stop()`,
  - an orderly shutdown may set a flag in `on_reboot` and stop+restart from
    the main loop.
  Add a stopping flag so new requests are rejected once teardown begins.
  Branch: `feature/1.0-correctness`.
- [ ] **`prsl_message(level, message)`.** Broadcast a transient user message
  with INFO / WARNING / ERROR levels. Wire:
  `{"type":"message","level":"info|warning|error","message":"..."}`. The
  client adds `ℹ` / `⚠` / `✖` and colors warning/error. Protocol failures
  keep using `type:"error"`. Branch: `feature/1.0-message-api`.
- [ ] **`examples/secure` cookie lock.** Login/logout, shared password,
  in-RAM session token, `HttpOnly; SameSite=Strict` cookie, server-wide
  middleware covering HTTP and the WS handshake, `Origin` check, HTTPS
  caveat. Compile-check in CI. Branch: `feature/1.0-secure-example`.
- [ ] **Reconnect-while-dirty e2e test.** Verify a reconnect with unsaved
  edits re-sends only values that differ from the device and keeps the rest.
  Add to `feature/1.0-correctness` if it fits naturally.
- [ ] **Busy-state failure test.** Cover that `aria-busy` clears when Save
  fails, not only when it succeeds. Add opportunistically; the behavior is
  already correct in `handleSaveApply()`.

### 1.0 release gates

These are not code branches. They run after the code is feature-complete.

- [ ] **Real-hardware verification.** OTA end-to-end, LittleFS/SD writes,
  disconnect → `ABORT`, idle timeout, `prsl_stop()` mid-upload, real
  save/reset. Consider hardware/QEMU coverage in CI.
- [ ] **Release checklist/docs.** README, `API_REFERENCE.md`,
  `WS_PROTOCOL.md`, `docs/reference/field-format.md` (upload + per-field-type
  options matrix), CHANGELOG, examples, tags. README install URLs must point
  at the real `v1.0.0` tag.
- [ ] **Stability promise.** Freeze public API and wire format; document
  semver, deprecation policy, and the 0.9 → 1.0 migration.
- [ ] **Distribution.** Publish to the PlatformIO Registry (`pio pkg pack`,
  account). Verify packaging excludes `tests/`, `.pio/`, and the venv.
  Document the Arduino IDE limitation (dependency graph).
- [ ] **Presentation pass.** Nav divider, any remaining visual polish. Do
  this with the docs pass, not as code work.

## 2.0

Design: `docs/superpowers/specs/2026-11-13-2.0-endpoints-actions-design.md`.

- [ ] **Independent `/user` and `/admin` endpoints.** Per-endpoint store,
  dirty flag, callbacks, WebSocket, upload state, runtime API, and auth at the
  endpoint boundary. Use the “two separate rooms” model (model C), not a
  filtered view of one global store.
- [ ] **`prsl_add_action()`.** One-shot actions (factory reset, calibrate,
  format) as actions, not settings fields. Needs its own confirmation
  semantics.
- [ ] **Endpoint-level auth.** Cookie/session gate per endpoint; app owns
  credentials, Parasol owns the gate. Revisit after the endpoints refactor.

## Dropped / YAGNI (do not re-open without new evidence)

These were reviewed on 2026-11-13 and deliberately dropped for the current
product: one ESP32, one settings store, trusted LAN, usually one tab.

- [-] **Continue past a rejection on the WS apply path.** The shipped client
  sends one field per apply; Save is deliberately transactional. Abort-on-first
  is the contract.
- [-] **“Server adjusted this” notice.** Replaced by the general
  `prsl_message` channel. Silent transform acceptance stays.
- [-] **Fire-and-forget action field type.** Replaced by the 2.0
  `prsl_add_action` idea.
- [-] **`_meta.v` device-wide version.** Ack correlation + sync recovery already
  cover missed pushes. Revisit only with observed missed pushes.
- [-] **Per-field timeout.** Use the global `ack_timeout_ms`; keep `on_set`
  fast.
- [-] **Server-side last-processed-ticket memory.** Keep the device stateless;
  require idempotent `on_set`.
- [-] **Multi-client review / conflict resolution.** Last-write-wins is the
  model. Keep the reconnect-while-dirty test; do not build merging.
- [-] **Field-level admin-only fields.** Security theater unless the whole UI
  is gated; use the secure example instead.
- [-] **Library-owned auth hooks.** Authentication policy belongs to the
  application. Use the secure example and, later, endpoint-level auth.
- [-] **Upload chunk-size option.** Firmware can buffer in `on_upload`.
- [-] **Filename pattern validation beyond `accept`.** Content checks belong
  in `on_upload`; `accept` is a UX/policy hint.
- [-] **Structured file metadata.** Encode size/checksum in the file label if
  needed.
- [-] **Built-in file-size display.** Use the label or a status field.
- [-] **mDNS discovery.** Application-level feature.
- [-] **Status sub-topics.** Status payloads are small; not worth the protocol.
- [-] **Status history/graphs.** Application-level feature.
- [-] **Client-side accordion merge for settings + status.** Presentation.
- [-] **Client auto-prefixing of status component IDs.** Already implemented
  (`createField` uses the `st-` prefix).
- [-] **Render status fields without destroying settings DOM.** Mostly already
  true: status updates after the first payload only set values. The remaining
  first-payload re-render race is too narrow to justify more code.
- [-] **Native test for the `val_str == NULL` branch.** Stale: that branch no
  longer exists in the code.

## Application-level / examples (not library roadmap)

Useful, but not library features:

- [ ] Export/import settings. Buildable from the existing save/upload paths.
- [ ] File download. Counterpart to upload; application-specific.
- [ ] Optional upload confirmation. UI/UX for destructive uploads.
- [ ] Additional device actions in `#nav-actions`. Covered conceptually by
        2.0 `prsl_add_action`.
- [ ] mDNS discovery.

## Minor / test hygiene

Low priority. Do these opportunistically, not as release blockers.

- [ ] `.gitignore` has unanchored duplicate patterns (harmless). Leave.
- [ ] `tests/native/check_headers.sh` lacks a trailing newline and is not
  executable (invoked via `bash`). Leave or fix in a chore commit.
- [ ] `alwaysShow` unit test restores its meta tag without `try/finally`;
  `tests/setup.js` clobbers `document.head` (test-only). Leave.
- [ ] Busy-state test covers success but not failure-clearing. Add if touching
  that area; behavior is already correct.
- [ ] Nav divider between logo row and links. Presentation pass.

## Resolved / superseded (do not re-open)

- [x] **0.9.0 release.** Merged to `main` and tagged `v0.9.0`; README install
  URLs updated.
- [x] **Client echo-correlation gap** — fixed in 0.9.0 (ack correlation; see
  `docs/superpowers/specs/2026-11-11-client-ack-correlation-design.md`).
- [x] **Test-server fidelity.** The test server sends `_meta.show_reset`; the
  Reset e2e tests pass.
- [x] **Reset button visibility** — fixed in v0.6.4 (`989b6e7`): hidden unless
  `on_reset` is registered. The “Deferred” section in
  `2026-09-02-architectural-decisions-design.md` is stale and kept only for
  history.
- [x] Responsive nav Approach A (flex-wrap) — superseded by
  `2026-09-09-responsive-nav-menu-design.md`.
- [-] `_label` group override — superseded by the group `label` field.
- [-] `/api/system/restart` — implemented as `/api/system/reboot`.
- [-] `/api/firmware/upload` — generalized into the 0.8.0 file-upload field.
- [-] `GET /api/settings`, `POST /api/settings/apply` — removed in 0.6.0;
  re-verify the test server.
- [-] Library-owned auth hooks (per-field) — rejected; see the 1.0 secure
  example and the 2.0 endpoint-auth plan.
