# Secure Example Follow-ups Decision Record

**Date:** 2026-11-18
**Parent:** `2026-11-13-secure-example-design.md`
**Status:** decided; L1 and L5 implemented. L2/L3, L6, L7, and L9 are
scheduled later. L4, L8, and L10 are rejected.

This record triages the Low/Informational findings from the independent
security review of `feature/0.10-secure-example`. It is a decision record,
not an implementation spec. The later items keep their own branches and,
where needed, their own specs.

## Triage

| # | Finding | Verdict | Destination |
|---|---|---|---|
| L1 | `save_to_nvs()` ignores NVS write/commit errors | **Fixed now** | Commit `e0ee724` on the secure-example branch |
| L5 | Parser tests miss tab whitespace, empty name/value, Origin whitespace | **Fixed now** | Same commit; tests only |
| L2 | No `Cache-Control: no-store` on HTML/redirects | **Later** | Library response-header policy spec |
| L3 | No anti-framing headers | **Later** | Same spec as L2 |
| L6 | No automated test that the gate is the first handler | **Later** | Test-infrastructure backlog |
| L7 | README lacks a complete build recipe | **Later** | Release docs gate |
| L9 | Origin/Host default-port comparison is strict | **Later (docs)** | Document proxy `Host` preservation |
| L4 | Bare `401` without `WWW-Authenticate` | **Rejected** | Backlog, with reason |
| L8 | Token comparison is not constant-time | **Rejected** | Backlog, with reason |
| L10 | `/api` without a trailing slash returns `302` | **Rejected** | Backlog, with reason |

## Fixed now

### L1 — NVS save errors

`save_to_nvs()` now returns the first `nvs_set_str()`/`nvs_commit()` error
instead of always returning `ESP_OK`. A failed save now reaches the UI as a
failure rather than a false success. This is example code; no host test
covers NVS.

### L5 — parser edge tests

`test_session_cookie.c` now pins:

- tab whitespace before a cookie name,
- an empty cookie name and an empty value,
- leading/trailing whitespace in `Origin` (rejected, fail closed).

These are regression tests for existing behavior; the helpers did not need
changes.

## Later

### L2 + L3 — HTTP response-header hardening

Add `Cache-Control: no-store` and an anti-framing policy (for example
`X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`) to library-served
pages and assets. This is **not** an example-only fix: the important page
(`/`) is served by prsl's asset handler, so a complete fix affects every
Parasol user and needs its own byte-budget and behavior spec. When scheduled:

- decide whether the policy is unconditional or configurable,
- decide whether headers apply to assets as well as `/`,
- measure the compressed-byte delta,
- test the headers through the normal HTTP path.

### L6 — automated gate-order test

The security guarantee depends on the guard being the first handler. There is
no public handler-list accessor, so a meaningful test needs a fake or
instrumented server. Track it as test infrastructure; do not add fragile
introspection to the example.

### L7 — build recipe

Add a complete PlatformIO/Arduino recipe for `examples/secure` during the
release-docs pass. Installation instructions depend on how Parasol is
consumed (source tree vs. registry), so this belongs with distribution work.

### L9 — proxy Host preservation

The WebSocket `Origin` check compares against the request `Host` exactly. A
TLS-terminating reverse proxy must preserve `Host`, including the public port
when non-default. Document this in the secure example and the release docs;
do not normalize default ports in the helper.

## Rejected

### L4 — bare 401

Adding `WWW-Authenticate: Basic` to a 401 can make browsers show a native
credential dialog for API/WebSocket requests. The spec mandates `401` for
unauthenticated API/WS; leaving it without a challenge is the better browser
behavior and does not weaken the gate.

### L8 — constant-time token comparison

The session token is 128 random bits. A timing signal on a 32-character hex
compare is not a practical attack against a LAN device, and the token is not
a user-chosen secret. Password timing remains documented as out of scope.

### L10 — `/api` without a trailing slash

`/api` is not a route. The 302-to-login is cosmetic; no state or settings are
reachable. Do not add special-case routing for it.

## Non-goals

- DoS/DDoS resistance, rate limiting, or lockout.
- Library-owned credentials, sessions, roles, or login UI.
- Multi-user accounts or per-field permissions.

These remain out of scope as recorded in the secure-example spec.
