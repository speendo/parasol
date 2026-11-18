# Secure example: one password, cookie session, gated UI

This example locks the whole Parasol UI behind one shared password:

- the page and its assets,
- every `/api/` route, including settings, reset, reboot, and uploads,
- the WebSocket handshake.

It is an **application-level example**, not a library auth module. Parasol
itself stays unauthenticated by default. It registers one text field
(`system.name`) and one file field (`system.blob`) so the upload path is
exercised too; the authorized blob is stored in LittleFS as `/secure.bin`.

Files:

- `main.cpp` — the example.
- `session_cookie.h` — pure cookie and `Origin` helpers.

## Build and run

This is an Arduino-ESP32 sketch (`app_main`) that needs the same dependencies
as the other examples:

- Arduino-ESP32 core (includes LittleFS),
- `esp32async/ESPAsyncWebServer` (the pinned 3.12.x fork),
- Parasol (`prsl.h` and the library sources).

For a quick compile check, the repository’s `tests/pio_smoke` project includes
this file through a wrapper and is built by CI.

The example uses an ESP-IDF-style `app_main`; it calls `prsl_start()` and then
keeps the entry point alive in a loop, because the `AsyncWebServer` is an
automatic local. In an Arduino sketch, put the same setup in `setup()` and
leave `loop()` running instead.

The example starts an access point:

| Setting | Value |
|---|---|
| SSID | `parasol-secure` |
| AP password | `CHANGE-ME-AP` |
| UI password | `CHANGE-ME` |

**Replace both `CHANGE-ME` values before using this anywhere.** The UI
password is in source, so a real product should provision it from build
configuration, NVS, or a secret store.

Connect to the AP, open `http://192.168.4.1/`, and sign in. The page redirects
to `/login` until a session exists.

## How the gate works

The example installs a guard handler **before** `prsl_init()`:

```cpp
server.addHandler(new Gate());   // first handler
prsl_init(&server, save_to_nvs, NULL, NULL);
```

`Gate::canHandle()` runs when the server selects a handler, at the end of the
request headers. For an unauthorized request it claims the request, so the
prsl handler is never attached and its body callbacks never run. That matters
for uploads: a `PUT /api/upload/...` can otherwise stream and commit before
server middleware sees the request.

This is why the example does **not** use `addMiddleware()` for authorization.
In ESPAsyncWebServer 3.12.x the lifecycle is:

1. parse headers,
2. select a handler (`canHandle`),
3. stream the body to `handleBody` / `handleUpload`,
4. run server middleware,
5. run the selected handler’s `handleRequest`.

The guard intervenes at step 2. The body is still read and discarded; only a
network-level gate can reject those bytes earlier. DoS is out of scope.

The pre-auth allowlist is exact path **and** method:

- `GET` / `POST /login`
- `GET` / `POST /logout`
- `GET /pico.jade.min.css` (the login page uses Pico)

No `startsWith` matching is used for the allowlist.

## Session behavior

- A successful login creates a 128-bit random token (`esp_fill_random`),
  hex-encoded to 32 characters, stored in RAM.
- The cookie is `prsl_session=<token>; Path=/; HttpOnly; SameSite=Strict`.
  Add `; Secure` (set `COOKIE_SECURE`) when the server runs HTTPS.
- It is a session cookie: no `Max-Age`.
- There is exactly one token. A reboot logs everyone out.
- A second login replaces the token and calls `prsl_disconnect_clients()`;
  the previous browser’s socket closes and cannot reconnect.
- An authenticated logout zeroes the token, closes every socket, and expires
  the cookie.
- `POST /logout` without a valid session does **not** revoke the current
  session or disconnect clients. It only clears the requester’s cookie.
- A wrong password does not change the current token or disconnect anyone.

`prsl_disconnect_clients()` is the only library addition used here. It closes
all WebSocket clients; it is wire-neutral and does not add auth policy to the
library.

## Logging out

Open `http://192.168.4.1/logout` (bookmark it) and use the **Sign out** button.
The page is intentionally reachable without a session; the POST only revokes
when the request carries a valid session cookie.

## Security caveats

This is a trusted-LAN lock, not an internet-facing authentication system.

- **Plain HTTP is sniffable.** The cookie and the password can be read by
  anyone who can sniff the LAN. Use a trusted LAN, a TLS-terminating reverse
  proxy, or switch the example to `beginSecure()` with a certificate before
  exposing it to an untrusted network.
- **No rate limiting or lockout.** An attacker can brute-force the shared
  password. That is out of scope for this example.
- **No DoS/DDoS protection.** A single host can exhaust connections, send
  large bodies, slowloris the headers, or flood requests. The gate prevents
  state changes, not resource exhaustion. Do not expose the device directly to
  the internet.
- **`strcmp` is not constant-time.** A timing attack against a shared LAN
  password is out of scope. Note it if you adapt the example.
- **One user, one token.** This is deliberate for one administrator. It is not
  a multi-user account system.

## Manual checklist

Run this on a real device before shipping a build based on the example.

- [ ] Unauthenticated `/` redirects to `/login`.
- [ ] The login page loads with Pico styling (one CSS request).
- [ ] Unauthenticated `POST /api/settings/save` returns `401` and changes
      nothing.
- [ ] Unauthenticated `PUT /api/upload/system/blob?name=secure.bin` returns
      `401`, leaves no `/secure.bin`, and produces no upload callback output.
- [ ] Unauthenticated `/api/events` WebSocket handshake fails.
- [ ] Wrong password returns `401`, sets no cookie, and leaves an existing
      session working.
- [ ] Correct password sets the cookie and redirects with `303` to `/`.
- [ ] The page, assets, API, upload, and WebSocket all work after login.
- [ ] `/logout` shows the sign-out page.
- [ ] Authenticated `POST /logout` revokes the token, closes the socket, and
      blocks the API and new WS handshakes.
- [ ] Unauthenticated `POST /logout` does not revoke an existing session.
- [ ] A second login invalidates the first; the first socket closes and cannot
      reconnect.
- [ ] A WS upgrade with a mismatched `Origin` is rejected by a non-browser
      client.

Useful commands:

```bash
curl -i -X POST http://DEVICE/api/settings/save \
  -H 'Content-Type: application/json' -d '{"system":{"name":"pwned"}}'

curl -i -X PUT 'http://DEVICE/api/upload/system/blob?name=secure.bin' \
  -H 'Content-Type: application/octet-stream' --data-binary @file.bin

curl -i http://DEVICE/ -H 'Cookie: prsl_session=abc'
curl -i http://DEVICE/ -H 'Cookie: foo=xprsl_session=abc'
curl -i -X POST http://DEVICE/logout
```

For the WebSocket checks, use a client that can set an `Origin` header, for
example `websocat -H='Origin: null' ws://DEVICE/api/events`.
