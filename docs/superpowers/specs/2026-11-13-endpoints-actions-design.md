# Endpoints and Actions Design (Future Work)

**Parent:** `2026-11-13-0.10-scope-design.md`
**Branch:** `docs/future-endpoints-actions`
**Status:** design-only. Not a 0.10 commitment.

## Why

A single settings form is the right 0.10 model. Some products need a public
`/user` view and a privileged `/admin` view, or a one-shot action such as
“factory reset” that is not a setting.

Both are coherent future features. They are intentionally left out of 0.10
because they change the library’s shape: multiple instances or a new action
model.

## Independent endpoints (model C)

### The decision

`/user` and `/admin` must be **independent**, not two filtered views of one
global store.

The cheaper “one store, filtered payloads” model was rejected because it
leaks shared state immediately:

- a shared dirty flag lights the wrong Save button,
- a shared save callback persists the other endpoint’s edits,
- a shared store forces globally unique group/key names,
- a shared upload lock blocks the wrong page,
- `prsl_push()` and `prsl_broadcast_status()` have no endpoint context.

If endpoints exist, they get their own store, dirty flag, callbacks,
WebSocket, upload state, and runtime API.

### API sketch

```c
typedef struct prsl_s prsl_t;

typedef bool (*prsl_auth_cb_t)(AsyncWebServerRequest *req);

/** Create an independent endpoint mounted at base_path. */
esp_err_t prsl_create(prsl_t **out, AsyncWebServer *server,
                      const char *base_path, prsl_auth_cb_t auth);

esp_err_t prsl_destroy(prsl_t *p);

esp_err_t prsl_add_group(prsl_t *p, const char *group_id, const char *label);
esp_err_t prsl_add_field(prsl_t *p, prsl_type_t type, const char *group_id,
                         const char *key, const char *label,
                         const prsl_field_opts_t *opts);
esp_err_t prsl_add_file_field(prsl_t *p, const char *group_id,
                              const char *key, const char *label,
                              const prsl_file_opts_t *opts);

esp_err_t prsl_init(prsl_t *p, prsl_save_cb_t on_save,
                    prsl_reset_cb_t on_reset,
                    prsl_reboot_cb_t on_reboot);
esp_err_t prsl_start(prsl_t *p);
esp_err_t prsl_stop(prsl_t *p);

esp_err_t prsl_set_str(prsl_t *p, const char *path, const char *value);
const char *prsl_get(prsl_t *p, const char *path);
esp_err_t prsl_push(prsl_t *p);
esp_err_t prsl_broadcast_status(prsl_t *p);
```

Names and exact signatures are illustrative; the future design review
decides them. The important part is that **every runtime call carries the endpoint**.

### Routing and assets

- Endpoint base paths: `/user`, `/admin`, or `/` for a single instance.
- API routes live under `<base>/api/...`.
- Each endpoint has its own WebSocket at `<base>/api/events`.
- Assets are served under `<base>/` (`<base>/app.min.js`, etc.).
- `<base>` redirects to `<base>/` so relative asset URLs resolve.
- The same `app.min.js` and `pico.jade.min.css` blobs are reused; the client
  derives API, upload, and WS URLs from the page base instead of hardcoding
  `/api/...`.
- Per-endpoint title/logo/config is an open question. Either generate a
  small HTML wrapper per endpoint or inject a `<base>`/config meta tag at
  serve time.

### Auth at the endpoint boundary

- `prsl_auth_cb_t` is called for every HTTP request and the WS handshake
  under that endpoint.
- The application owns credentials and sessions; Parasol owns the gate.
- A failed check returns `401` for API/WS. For HTML, the endpoint may
  redirect to a configured login path.
- Cookies should be scoped with `Path=/admin` so the admin session is not
  sent to `/user`.
- The 0.10 secure example is the reference implementation; a future endpoint
  release extends it per endpoint.

### Refactor plan

1. Extract the current globals in `src/prsl.cpp` into `prsl_t`.
2. Add `base_path` to route registration and asset serving.
3. Add per-endpoint WebSocket and upload state.
4. Make `app.js` base-path aware.
5. Keep the old global API as wrappers around one default endpoint for a
   migration period, or remove it in a future release with a migration
   guide.
6. Add two-endpoint tests: independent dirty flags, callbacks, upload locks,
   duplicate group IDs, and auth.

Estimated effort: 5–10 working days for the internals, client, and tests.

## `prsl_add_action`

### Why

One-shot actions (factory reset, calibrate, format SD) should not wear a
field’s clothes. A settings field has a value, participates in dirty/Save,
and can be replayed. An action fires once and has no stored state.

### API sketch

```c
typedef esp_err_t (*prsl_action_cb_t)(void);

typedef struct {
    bool confirm;             /* show a confirmation prompt */
    const char *help;         /* optional helper text */
} prsl_action_opts_t;

esp_err_t prsl_add_action(prsl_t *p, const char *group_id,
                          const char *key, const char *label,
                          prsl_action_cb_t cb,
                          const prsl_action_opts_t *opts);
```

- Rendered as a button in the group or in `#nav-actions`.
- Fires via its own endpoint or a dedicated WS message.
- Never sets dirty, never participates in Save, never carries a value.
- `confirm` defaults to true for destructive actions; the design review
  decides the default.
- Needs an explicit result path: success, failure, and optional user
  message via `prsl_message`.

### Why later, not 0.10

- It is additive for most users, so it could be a minor release.
- If it changes how nav actions or groups are declared, it belongs with the
  endpoint refactor.
- It needs confirmation and result semantics that deserve their own design
  and tests.

## Open questions for the future design

- Migration: keep the global API as wrappers, or make the handle API the
  only one?
- Upload lock: per endpoint, or a device-wide lock with a per-endpoint
  opt-out?
- Duplicate group IDs: allowed because stores are separate, or still
  discouraged for DOM/URL clarity?
- Per-endpoint assets/config: one shared HTML with injected base, or one
  generated page per endpoint?
- Auth failure for HTML: always `401`, or a configurable login redirect?
- Action transport: HTTP endpoint, WS message, or both?
- Action result: how much detail does the browser need?

## Non-goals

- Multi-user accounts, roles, or per-field permissions.
- Conflict resolution between endpoints.
- A device-management suite (file manager, mDNS, graphs).
- TLS termination in the library; HTTPS remains the application’s job.
