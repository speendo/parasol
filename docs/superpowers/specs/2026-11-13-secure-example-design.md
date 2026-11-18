# Secure Example (Cookie Lock) Implementation Spec

**Parent:** `2026-11-13-0.10-scope-design.md`
**Branch:** `feature/0.10-secure-example`
**Goal:** Ship a complete, compile-checked example that locks the whole
Parasol UI — page, assets, API, uploads, and WebSocket — behind one password,
and revokes live sockets when the session changes.

This is an **example**, not a library auth module. The library stays
unauthenticated by default and gains no credential, session, or policy API.
The only library addition is `prsl_disconnect_clients()`, which closes open
sockets and has no auth policy in it.

## Why

Basic/Digest protects HTTP but not the browser-initiated WebSocket
handshake. A cookie session is the simplest mechanism that covers both
doors, because the browser sends cookies automatically on the handshake.

The example must be complete enough to copy. A half-example that leaves the
WebSocket or upload path open is worse than no example.

## Threat model

In scope:

- a stranger on the same LAN opening the settings page,
- a stranger calling the API or uploading firmware directly,
- a malicious website trying to drive the device through the user’s browser
  (CSRF/CSWSH),
- a browser connecting to the WebSocket without a session,
- a session that was replaced by a newer login but still has an open socket.

Out of scope:

- a network attacker who can sniff plain HTTP (use HTTPS or a trusted LAN),
- **availability and DoS/DDoS**: connection exhaustion, slowloris, request
  floods, large bodies, login brute force, Wi-Fi deauth, or jamming. The lock
  protects state, not uptime. See “Availability” below.
- multi-user accounts, roles, or per-field permissions,
- password recovery, rate limiting, or lockout,
- secure password storage on the device,
- protection from physical access or a compromised firmware image,
- a stolen session token while it is still the current token.

## Architecture

Example files:

- `examples/secure/main.cpp` — Arduino-ESP32 example (C++ because the
  handler API is C++).
- `examples/secure/session_cookie.h` — pure header-only cookie and Origin
  helpers.
- `examples/secure/README.md` — copy/configure/security notes and manual
  checklist.
- `tests/native/test_session_cookie.c` — host tests for both helpers.
- `tests/pio_smoke/src/secure.cpp` — wrapper that includes the example under
  a unique `app_main` name.
- `tests/pio_smoke/src/main.cpp` — add the wrapper to the compile/link list.
- `include/prsl.h`, `src/prsl.cpp` — `prsl_disconnect_clients()`.

The example uses the existing `AsyncWebServer` instance passed to
`prsl_init()`. It installs a **header-time guard handler before
`prsl_init()`**, so the gate runs during handler selection, before any body
callback. It does not use server middleware for authorization.

### Why not middleware

In ESPAsyncWebServer 3.12.x the request lifecycle is:

1. headers parsed,
2. handler selected (`filter` + `canHandle`),
3. body streamed to `handleBody` / `handleUpload`,
4. server middleware runs at `PARSE_REQ_END`,
5. the selected handler’s `handleRequest` runs.

A server-wide middleware therefore runs **after** the upload and body
callbacks. A `PUT /api/upload/...` can write and commit before the middleware
returns 401. A guard handler selected at step 2 does not attach the prsl
handler at all, so step 3 never reaches the library. The body is still read
and discarded; only a network-level gate can reject the bytes themselves.

### Guard handler

```cpp
class Gate : public AsyncWebHandler {
    bool canHandle(AsyncWebServerRequest *req) const override {
        if (is_public_path(req)) return false;
        if (!valid_session(req)) return true;
        if (req->isWebSocketUpgrade() && !origin_ok(req)) return true;
        return false;
    }
    void handleRequest(AsyncWebServerRequest *req) override {
        if (is_api_or_ws(req)) req->send(401, "text/plain", "Unauthorized");
        else req->redirect("/login", 302);
    }
};
server.addHandler(new Gate());   // BEFORE prsl_init()
```

The guard is first in the handler list. Authorized requests decline it and
reach the prsl handlers. Unauthorized requests attach the guard, whose body
callbacks are the base-class no-ops, so no upload, save, or WS work runs.

`is_public_path()` is an **exact path + method allowlist**:
`GET`/`POST /login`, `GET`/`POST /logout`, and `GET /pico.jade.min.css`.
No `startsWith` on allowlisted paths.

## Session model

- One shared admin password, defined in the example with a loud
  `CHANGE-ME` comment. A real product should provision it from build config,
  NVS, or a secret store.
- On successful login, generate a 128-bit random token with
  `esp_fill_random()` and hex-encode it into a 32-character string.
- Store the token in a static RAM buffer. Reboot logs everyone out.
- One active token. A new login replaces the old token and closes every open
  WebSocket with `prsl_disconnect_clients()`.
- Logout zeroes the token, closes every open WebSocket, and clears the
  cookie.
- The cookie is a session cookie (no `Max-Age`), so closing the browser
  drops it.

## Routes

### `GET /login`

- If the request already has a valid session, `302` to `/`.
- Otherwise return a small page that links the library’s
  `/pico.jade.min.css` and uses Pico’s `<dialog open><article>` styling as a
  login card.
- One password field, one submit button, inline error slot, `autofocus`,
  `autocomplete="current-password"`, and a `<label>`.
- The page is allowed before login. The stylesheet is the only other
  pre-login asset.

### `POST /login`

- Parse the URL-encoded body (`password=...`) with `req->arg("password")`.
- Compare against the configured password.
- On success:
  - generate a new token,
  - set `Set-Cookie: prsl_session=<token>; Path=/; HttpOnly;
    SameSite=Strict` (add `; Secure` when the server uses HTTPS),
  - call `prsl_disconnect_clients()` after the new token is stored,
  - respond `303` with `Location: /`.
- On failure: `401` and re-render the form with a fixed “Wrong password”
  message in a `role="alert"` element. Do not reflect input. Do not change
  the current token and do not disconnect clients.

### `GET /logout`

- Return a small Pico page with a `POST /logout` form and a cancel link to
  `/`. Allowed without a session so the page can be bookmarked.

### `POST /logout`

- If the request has a valid session: zero the token, call
  `prsl_disconnect_clients()`, set an expired cookie
  (`prsl_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`), and
  respond `303` with `Location: /login`.
- If the request has no valid session: do **not** zero the token and do
  **not** disconnect clients. Expire the requester’s cookie and redirect to
  `/login`. This prevents an unauthenticated logout/disconnect DoS.

## Gate behavior

| Request | No session | Valid session |
|---|---|---|
| `GET /` | `302` to `/login` | UI |
| `GET /app.min.js` | `302` to `/login` | asset |
| `GET /pico.jade.min.css` | allowed (login page needs it) | asset |
| `GET /login`, `POST /login` | login page / auth | redirect to `/` |
| `GET /logout`, `POST /logout` | logout page / no-op redirect | logout page / revoke |
| `POST /api/settings/save` | `401`, prsl body callback never runs | normal |
| `POST /api/settings/reset` | `401` | normal |
| `POST /api/system/reboot` | `401` | normal |
| `POST/PUT /api/upload/...` | `401`, no upload callback, no write | normal |
| `GET /api/events` (WS upgrade) | `401`, handshake fails | normal if `Origin` matches |

The redirect for static assets is harmless because the login page needs only
the stylesheet, which is allowed. Browsers may request the favicon/logo; those
are not required by the login page.

## Cookie validation

`examples/secure/session_cookie.h` provides:

```c
static inline bool session_cookie_matches(const char *header,
                                          const char *token);
```

Rules:

- Find `prsl_session=` only at a cookie boundary: start of the header or
  after `;` plus optional whitespace. Do not match inside another cookie’s
  value.
- Stop the value at `;` or end of header.
- Require a non-empty stored token and an exact-length, exact-byte match.
- Reject `prsl_session=abc` when the stored token is `abcdef`, and vice
  versa.
- Continue scanning after a non-matching duplicate cookie.
- Reject missing/empty headers and missing/empty tokens.

The same header provides the WebSocket Origin check:

```c
static inline bool origin_matches(const char *origin, const char *host);
```

- A missing or empty `Origin` is allowed (non-browser client); the cookie is
  still required.
- Otherwise the Origin must be exactly `http://<Host>` or `https://<Host>`,
  compared case-insensitively.
- `null`, a scheme mismatch, a host mismatch, or a port mismatch is rejected.

Both helpers are host-tested (see “Tests”).

## WebSocket hardening

- The guard rejects an unauthenticated handshake with `401` before the
  upgrade.
- If the request is a WebSocket upgrade, `origin_matches()` requires the
  `Origin` to be exactly `http://<Host>` or `https://<Host>`
  (case-insensitive). It rejects `Origin: null` and any mismatch.
- A missing `Origin` is allowed for non-browser clients, but the session
  cookie is still required.
- Logout and a new login call `prsl_disconnect_clients()` so existing sockets
  cannot keep sending `action:"apply"` after the session changes.
- Document that the cookie must not be readable by JavaScript
  (`HttpOnly`).

## `prsl_disconnect_clients()`

```c
esp_err_t prsl_disconnect_clients(void);
```

- Takes a snapshot of tracked client ids, closes each id one at a time, then
  calls `cleanupClients()`. It does **not** call `closeAll()` on the live
  list: the server’s `close()` can erase the element being iterated.
- No wire change: clients see a normal close, reconnect, and receive `401`
  until a new session exists.
- Safe from an HTTP/WS callback or the main loop; the server takes its
  client lock internally.
- Returns `ESP_ERR_INVALID_STATE` when the WebSocket is not started,
  `ESP_OK` otherwise.
- The example calls it only after a successful login and an authenticated
  logout.

This closes the gap where a replaced session’s socket could still mutate the
store. It does not make the device resistant to DoS.

## HTTPS caveat

The example runs plain HTTP for simplicity. On plain HTTP:

- the session cookie is sniffable,
- the password is sniffable,
- `Secure` cannot be used.

The README must say: use a trusted LAN, a TLS-terminating reverse proxy, or
switch the example to `beginSecure()` with a certificate before exposing the
device to an untrusted network. Do not claim the example is safe on the open
internet.

## Availability and DoS

The example is a state-integrity lock, not a DDoS defense. A single host on
the LAN can still:

- exhaust AsyncTCP/lwIP sockets by opening and holding connections,
- send headers slowly (slowloris),
- send large or endless bodies that the gate reads and discards,
- brute-force the shared password,
- flood requests or Wi-Fi.

The example does **not** add rate limiting, lockout, connection caps, or
header timeouts; those are out of scope. If the device is reachable from an
untrusted network, put it behind a firewall/reverse proxy with rate limits,
or do not expose it. A hardware watchdog is not a DDoS defense.

## Tests and verification

- **Compile:** `tests/pio_smoke` includes the example and links it. CI must
  stay green (`pio run -d tests/pio_smoke`).
- **Native:** `tests/native/test_session_cookie.c` covers malformed cookie
  headers, prefix collisions, duplicates, whitespace, empty tokens, exact
  matches, and the Origin cases (`null`, missing, scheme, host, port,
  case-insensitivity). Add it to `tests/native/run.sh` and
  `npm run test:native`.
- **Manual checklist** in `examples/secure/README.md`:
  - unauthenticated `/` redirects to `/login`,
  - the login page loads with Pico styling (one CSS request),
  - unauthenticated `/api/settings/save` returns `401`,
  - unauthenticated `PUT /api/upload/...` returns `401` and leaves no file
    and no upload callback output,
  - unauthenticated `/api/events` handshake fails,
  - wrong password returns `401`, sets no cookie, and does not disturb an
    existing session,
  - correct password sets the cookie and redirects with `303`,
  - page, assets, API, upload, and WS all work after login,
  - logout page works; `POST /logout` revokes the token, closes the socket,
    and blocks the API and new WS handshakes,
  - `POST /logout` without a session does not revoke an existing session,
  - a second login invalidates the first; the first socket closes and cannot
    reconnect,
  - a WS upgrade with a mismatched `Origin` is rejected (non-browser client).

## Non-goals

- A reusable `prsl_auth` module.
- Password hashing/storage in the library.
- Multiple users, roles, or per-field permissions.
- Session persistence across reboot.
- Remember-me, password reset, rate limiting, lockout, or DDoS protection.
- CSRF tokens beyond `SameSite=Strict` plus the WebSocket `Origin` check.

## Risks

- The example password is in source. The README must make replacement
  mandatory, not optional.
- One token means a second login logs out the first browser and closes its
  socket. That is intended for one administrator; document it.
- `strcmp` is not constant-time. A network timing attack against a shared
  LAN password is out of scope; note it.
- Plain HTTP makes the lock sniffable. The trusted-LAN caveat is mandatory.
- The guard still reads and discards unauthorized bodies. DoS is out of
  scope; do not expose the device to an untrusted network.
