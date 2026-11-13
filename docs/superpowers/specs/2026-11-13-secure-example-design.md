# Secure Example (Cookie Lock) Implementation Spec

**Parent:** `2026-11-13-0.10-scope-design.md`
**Branch:** `feature/0.10-secure-example`
**Goal:** Ship a complete, compile-checked example that locks the whole
Parasol UI — page, API, uploads, and WebSocket — behind one password.

This is an **example**, not a library auth module. The library stays
unauthenticated by default and gains no credential, session, or policy API.

## Why

Basic/Digest protects HTTP but not the browser-initiated WebSocket
handshake. A cookie session is the simplest mechanism that covers both doors,
because the browser sends cookies automatically on the handshake.

The example must be complete enough to copy. A half-example that leaves the
WebSocket open is worse than no example.

## Threat model

In scope:

- a stranger on the same LAN opening the settings page,
- a stranger calling the API or uploading firmware directly,
- a malicious website trying to drive the device through the user’s browser
  (CSRF),
- a browser connecting to the WebSocket without a session.

Out of scope:

- a network attacker who can sniff plain HTTP (use HTTPS or a trusted LAN),
- multi-user accounts, roles, or per-field permissions,
- password recovery, rate limiting, or lockout,
- secure password storage on the device,
- protection from physical access or a compromised firmware image.

## Architecture

Example files:

- `examples/secure/main.cpp` — Arduino-ESP32 example (C++ because the
  middleware API is C++).
- `examples/secure/README.md` — copy/configure/security notes.
- `tests/pio_smoke/src/secure.cpp` — wrapper that includes the example under
  a unique `app_main` name.
- `tests/pio_smoke/src/main.cpp` — add the wrapper to the compile/link list.

The example uses the existing `AsyncWebServer` instance passed to
`prsl_init()`. It adds server-wide middleware **before** `prsl_start()` so
the page, assets, API, and WS handshake all pass through the gate.

## Session model

- One shared admin password, defined in the example with a loud
  `CHANGE-ME` comment. A real product should provision it from build config,
  NVS, or a secret store.
- On successful login, generate a 128-bit random token with `esp_random()`
  and hex-encode it into a 32-character string.
- Store the token in a static RAM buffer. Reboot logs everyone out.
- One active token. A new login replaces the old token; other sessions are
  effectively logged out.
- Logout zeroes the token and clears the cookie.

This is deliberately simpler than a session table. It is enough for one
device and one administrator.

## Routes

### `GET /login`

Return a self-contained HTML page with one password field and a submit
button. Inline CSS; no external assets, so the unauthenticated page does not
need to fetch gated files.

### `POST /login`

- Parse the URL-encoded body (`password=...`).
- Compare against the configured password.
- On success:
  - generate a new token,
  - set `Set-Cookie: prsl_session=<token>; HttpOnly; SameSite=Strict; Path=/`
    (add `; Secure` when the server uses HTTPS),
  - respond `303` with `Location: /`.
- On failure: `401` and re-render the form with a short error.
- Do not reveal whether the password or the user name was wrong; there is
  only a password.

### `POST /logout`

- Zero the token.
- Set the cookie to an expired value:
  `prsl_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/`.
- Respond `303` with `Location: /login`.

## Middleware gate

Add one server-wide middleware before `prsl_start()`:

```cpp
server.addMiddleware([](AsyncWebServerRequest *req, ArMiddlewareNext next) {
    if (req->url() == "/login") return next();
    if (valid_session(req)) return next();
    if (req->isWebSocketUpgrade() || req->url().startsWith("/api/")) {
        req->send(401);
        return;
    }
    req->redirect("/login");
});
```

Behavior:

| Request | No session | Valid session |
|---|---|---|
| `GET /` | `303` to `/login` | UI |
| `GET /app.min.js`, CSS, logo | `303` to `/login` | asset |
| `POST /api/settings/save` | `401` | normal |
| `POST /api/settings/reset` | `401` | normal |
| `POST /api/system/reboot` | `401` | normal |
| `POST/PUT /api/upload/...` | `401` | normal |
| `GET /api/events` (WS upgrade) | `401`, handshake fails | normal |

The redirect for static assets is harmless because the login page is
self-contained. Browsers will follow it and show the login page.

## Cookie validation

Parse the `Cookie` header; do not use a substring search that
`prsl_session=abc` could satisfy with `prsl_session=abcdef`.

- Find the `prsl_session=` token.
- Stop at `;` or end of header.
- Require an exact match with the stored token.
- Reject empty or missing tokens.
- Reject when no token has been issued.

## WebSocket hardening

- The middleware already rejects an unauthenticated handshake with `401`.
- Additionally, if the request is a WebSocket upgrade and has an `Origin`
  header, require it to match the request `Host` (scheme/host comparison).
  Browsers send `Origin`; a mismatch is a cross-site attempt.
- A missing `Origin` is allowed for non-browser clients, but the session
  cookie is still required.
- Document that the cookie must not be readable by JavaScript (`HttpOnly`).

## HTTPS caveat

The example runs plain HTTP for simplicity. On plain HTTP:

- the session cookie is sniffable,
- the password is sniffable,
- `Secure` cannot be used.

The README must say: use a trusted LAN, a TLS-terminating reverse proxy, or
switch the example to `beginSecure()` with a certificate before exposing the
device to an untrusted network. Do not claim the example is safe on the open
internet.

## Tests and verification

- **Compile:** `tests/pio_smoke` includes the example and links it. CI must
  stay green.
- **Manual checklist** in `examples/secure/README.md`:
  - unauthenticated `/` redirects to `/login`,
  - unauthenticated `/api/settings/save` returns `401`,
  - unauthenticated `/api/events` handshake fails,
  - wrong password returns `401` and no cookie,
  - correct password sets the cookie and redirects,
  - page, assets, API, upload, and WS all work after login,
  - logout revokes the token and blocks the API and WS again,
  - a second login invalidates the first session.
- If the cookie parser is factored into a small helper, add a host test for
  malformed headers and prefix collisions. Otherwise, keep it in the example
  and rely on the manual checklist.

## Non-goals

- A reusable `prsl_auth` module.
- Password hashing/storage in the library.
- Multiple users, roles, or per-field permissions.
- Session persistence across reboot.
- Remember-me, password reset, rate limiting, or lockout.
- CSRF tokens beyond `SameSite=Strict` plus the WebSocket `Origin` check.

## Risks

- The example password is in source. The README must make replacement
  mandatory, not optional.
- One token means a second login logs out the first browser. That is
  acceptable for one administrator; document it.
- `strcmp` is not constant-time. A network timing attack against a shared
  LAN password is out of scope for the example; note it.
- Plain HTTP makes the lock sniffable. The trusted-LAN caveat is mandatory.
