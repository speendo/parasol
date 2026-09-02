# parasol 0.7.0 — Architectural Decisions Design

Date: 2026-09-02
Status: approved (pending implementation plan)

Source: `docs/audits/2026-09-01-audit-fix-triage.md` (the eight "Architectural
Questions — DEFERRED" items), decided in collaboration 2026-09-02.

## Guiding Constraints

Unchanged from `2026-06-18-unified-settings-design.md`:

- Server is an ESP32 (limited RAM, flash, CPU). Shift computation to the client.
- Compact wire format. Short JS.
- Public API compiles as **both C and C++**.
- Public surface stays minimal (AGENTS.md).

---

## Decision 1 — `on_set` ownership (Issue 10)

**Decision:** Keep callback-owned writes. No library code change.

`on_set` is the firmware's decision point for what happens to a changed value:
accept, reject (return non-OK), transform (write a different value), or route
elsewhere (write nothing). The library only auto-writes when `on_set` is
absent (src/prsl_body.c:37-42 already does this). Forcing the library to write
after `on_set` returns OK would be unable to express transform/discard.

**Changes (docs + example only):**

- `include/prsl.h` — rewrite the `prsl_set_cb_t` doc comment to state that the
  callback owns persistence: it must write the accepted value back via a
  `prsl_set_*` (or `prsl_set_val`) call, may transform before writing, or may
  write nothing to discard.
- `API_REFERENCE.md` — same contract in the `on_set` section.
- `examples/basic/main.c` — `on_ssid_change` must write the value back (per
  Decision 4, `value` is now a `prsl_val_t *`): call
  `prsl_set_val("wifi.ssid", value)` (accept as-is) or `prsl_set_str("wifi.ssid",
  value->u.str)` after checking `value->kind == PRSL_VAL_STRING`, plus
  `prsl_set_dirty(true)`, so the shipped example persists end-to-end.

---

## Decision 2 — Dirty semantics (Issue 12)

**Decision:** Keep the developer-driven `prsl_set_dirty` contract. Document the
sharp consequence.

Rationale: "dirty" means "applied values differ from NVS", and only the firmware
knows NVS contents; the library sees only RAM. Auto-setting dirty on WS apply
would conflate "user changed RAM" with "RAM differs from flash" and cannot
account for transforms/discards/status fields.

**Changes (docs only):**

- `include/prsl.h` — `prsl_set_dirty` doc: state the consequence explicitly
  (if never set, the Save button never appears and nothing persists, silently).
- `API_REFERENCE.md` + troubleshooting section — same warning.

The library continues to only ever *clear* dirty (after successful `on_save`
and, per Issue 15, after successful reset).

---

## Decision 3 — Underscore-prefixed groups (Issue 13)

**Decision:** Reject `_`-prefixed `group_id` at registration. Document the
reservation.

The `_` namespace is reserved for top-level meta keys (`_dirty`, `_show_reset`,
`_show_reboot`). A user `_`-group has no valid interpretation, so rejection can
only convert a silently-broken program into a loudly-broken one. Compile-time
rejection is infeasible (the string is runtime data, and the header compiles as
both C and C++). The failure cascades usefully: the group fails to register,
subsequent `prsl_add_field` for it returns `ESP_ERR_NOT_FOUND`, and
`prsl_get`/`prsl_set_*` on it return `NULL`/error.

**Changes:**

- `src/prsl_store.c` — in `prsl_store_add_group`, return `ESP_ERR_INVALID_ARG`
  if `group_id[0] == '_'` (before the existing duplicate check). Placed in the
  store (not the public wrapper) so the native host test harness covers it.
- `include/prsl.h` — `prsl_add_group` doc: note the `_`-prefix reservation.
- `API_REFERENCE.md` + troubleshooting — explain the reservation.

---

## Decision 4 — Typed `on_set` + typed getters (Issue 11) — BREAKING

**Decision:** Make the value pipeline type-clean. Change `on_set` to receive a
`prsl_val_t` discriminated union, add typed getters, and stop flattening
incoming values to strings. This is a breaking public-API change, accepted
because parasol is pre-1.0 with a single known integrator.

The browser already sends typed values (`app.js`: `number`/`range` →
`parseFloat` → JSON number; `checkbox`/`switch` → boolean/null; else string),
so the wire is already type-clean. The type is currently discarded at exactly
one place: `prsl_apply_body` flattens every value through `prsl_json_value_str`
+ `prsl_set_str`. Preserving type makes validation and read-back unambiguous.

### New public types (in `include/prsl.h`)

```c
typedef enum {
    PRSL_VAL_STRING,
    PRSL_VAL_NUMBER,
    PRSL_VAL_BOOL,
    PRSL_VAL_NULL
} prsl_val_kind_t;

typedef struct {
    prsl_val_kind_t kind;
    union {
        const char *str;   /* PRSL_VAL_STRING */
        double      num;   /* PRSL_VAL_NUMBER */
        bool        b;     /* PRSL_VAL_BOOL */
    } u;
} prsl_val_t;
```

- A **named** union (`u`) is used for C99 + C++ compatibility (anonymous unions
  are C11/GNU-ext, not standard C99).
- `num` is `double` to faithfully hold cJSON numbers (a 32-bit integer config
  value is exact in double up to 2^53).
- "No value" is represented by `kind == PRSL_VAL_NULL`; the callback pointer is
  always non-NULL.

### Changed callback

```c
typedef esp_err_t (*prsl_set_cb_t)(const char *group_id, const char *key,
                                    const prsl_val_t *value);
```

### New functions

```c
esp_err_t prsl_set_val(const char *path, const prsl_val_t *value);
esp_err_t prsl_get_int(const char *path, int *out);
esp_err_t prsl_get_float(const char *path, float *out);
esp_err_t prsl_get_bool(const char *path, bool *out);
```

- `prsl_set_val` writes the value with its native cJSON type (STRING →
  `cJSON_CreateString`, NUMBER → `cJSON_CreateNumber`, BOOL → `cJSON_CreateBool`,
  NULL → `cJSON_CreateNull`). It is the "accept as-is" one-liner for `on_set`.
- `prsl_get_int`/`prsl_get_float` read a cJSON number (casting to `int`/`float`);
  `prsl_get_bool` reads a cJSON bool. Each returns `ESP_OK` and sets `*out` when
  the field exists and has a compatible type, else `ESP_ERR_NOT_FOUND` (missing
  **or** wrong type). They are strict — they do not parse strings.
- `prsl_get` (string-only, returns `NULL` for non-string) is unchanged.

### `prsl_apply_body` change (src/prsl_body.c)

Replace the flatten-to-string logic. For each field:

1. Read the `"value"` cJSON node.
2. Build a `prsl_val_t` from it:
   - `cJSON_IsString` → `{PRSL_VAL_STRING, .u.str = node->valuestring}`
   - `cJSON_IsNumber` → `{PRSL_VAL_NUMBER, .u.num = cJSON_GetNumberValue(node)}`
   - `cJSON_IsTrue`/`cJSON_IsFalse` → `{PRSL_VAL_BOOL, .u.b = ...}`
   - `cJSON_IsNull` → `{PRSL_VAL_NULL}`
3. If the field has `on_set`: call `on_set(group, key, &v)`; on `ESP_OK` count it
   (callback owns the write).
4. Else: store the native value via
   `prsl_store_set_json(store, group, key, cJSON_Duplicate(val, 1))`.

`prsl_json_value_str` (src/prsl_json.c:6) becomes unused and is removed, along
with its declaration in `src/prsl_json.h`.

### Rationale for strict getters

With `prsl_apply_body` preserving types, the store's type is now stable across
a browser round-trip (a number stays a number), so strict typed getters are no
longer "false type safety". They only mismatch if the author deliberately
writes a value with the wrong setter — which is now an explicit, documented act.

---

## Decision 5 — Lifecycle teardown (Issue 6)

**Decision:** Add `prsl_stop()`, symmetric with `prsl_start()`.

```c
esp_err_t prsl_stop(void);
```

Semantics:

1. Close WS clients and remove the WS handler; call `g_server->end()`.
2. `prsl_store_deinit(&g_store)` — free fields, groups, and the recursive mutex
   (already implemented in src/prsl_store.c:27).
3. Reset globals: `g_server = NULL`, callbacks = NULL, `g_initialized = false`,
   so a later `prsl_add_group` → `prsl_init` → `prsl_start` can run cleanly.
4. Return `ESP_ERR_INVALID_STATE` if not initialized (mirrors `prsl_reset`).

**Implementation note (must be verified during implementation):** `g_ws` is
currently a `static AsyncWebSocket`. AsyncWebServer's `end()`/handler lifecycle
and reuse of a static `AsyncWebSocket` across stop→re-init must be verified;
if reuse is unsafe, `g_ws` should be heap-allocated and recreated per init.

---

## Decision 6 — Public header shape (Issue 2)

**Decision:** Move `prsl_build_settings_payload` to a private header.

It is used only by `src/prsl.cpp` and `src/prsl_ws.cpp`; no example/test/user
calls it. It returns a caller-owned `cJSON *`, leaking cJSON's memory model
into the public contract for no benefit.

**Changes:**

- Remove `cJSON *prsl_build_settings_payload(const prsl_store_t *store);` from
  `include/prsl.h`.
- Declare it in `src/prsl_store.h` (which already defines `prsl_store_t`).
- Remove `#include "cJSON.h"` from `include/prsl.h` (now unused there).

This also resolves the Issue 2 compile blocker: `prsl.h` no longer references
`prsl_store_t` at all, so the anonymous-struct / forward-declaration / const
problems disappear. `prsl.h` becomes self-contained (stdbool, esp_err, and the
`AsyncWebServer` forward-decl only).

---

## Decision 7 — Dependency policy (Issue 4 / Issue 5)

**Decision:** Switch to the maintained fork.

- `library.json`: replace `"me-no-dev/ESP Async WebServer": "~3.11"` with
  `"ESP32Async/ESPAsyncWebServer": "^3.12.0"` (latest release, 2025-07-26;
  includes a WebSocket refactoring fixing torn frames / use-after-free /
  fragmented-message acks — directly relevant to `/api/events`).
  - Verify the exact PlatformIO registry owner casing (`ESP32Async` vs
    `esp32async`) during implementation.
- `DaveGamble/cJSON ~1.7` unchanged.
- Issue 5 guidance (document in README/API_REFERENCE): do **not** list
  `AsyncTCP` explicitly — let ESPAsyncWebServer resolve it transitively; add
  `lib_ignore = AsyncTCP_RP2040W` to prevent the RP2040 port from being pulled.

---

## Decision 8 — Distribution of generated assets (Issue 1)

**Decision:** Ship pre-baked default assets **and** a portable regeneration
script; keep the CMake path unchanged for ESP-IDF.

Problem: `prsl_assets.h/c` are generated only by CMake (`cmake/generate_assets.cmake`)
into the build dir; they are never committed or shipped, so the documented
PlatformIO/tarball install path cannot compile (`prsl.cpp:5` includes
`prsl_assets.h`). Customization (title/logo/favicon/`always_show_save`) is
baked into `index.html` at generation time from `parasol_config.json`.

- **Pre-baked default assets:** commit `prsl_assets.h` and `prsl_assets.c`,
  baked from the default `parasol_config.json`, at stable paths that PlatformIO
  and Arduino auto-compile (e.g. `include/prsl_assets.h` and
  `src/prsl_assets.c`). Default users need zero generation.
- **Portable regen script:** add `scripts/generate_assets.py` — pure Python
  using `zlib` (no external `gzip` binary), reproducing `generate_assets.cmake`
  output from `index.html`, `app.min.js`, `pico.jade.min.css`, and
  `parasol_config.json`. Customizers run it manually, or wire it as
  `extra_scripts = pre:scripts/generate_assets.py` in `platformio.ini`.
- **CMake/ESP-IDF:** unchanged — continues to generate from source into the
  build dir.
- **Sync guard:** wire regeneration of the committed assets into `npm run build`
  and add a CI check that the committed assets match freshly generated ones, so
  the pre-baked copy cannot drift.

---

## Cross-cutting implications

- Decision 6 **supersedes** the planned "compile blocker" work (name
  `prsl_store_s`, forward-declare, drop `const`): deleting the function from
  `prsl.h` makes it self-contained. The other half — restore the native host C
  test harness and compile it as C++ — still stands.
- Decision 4 **folds** the Issue 7 fix (C99 compound literals) into the example
  rewrite: `on_set` changes signature anyway; `static const prsl_field_opts_t`
  still applies to field registration.
- Decision 4 requires **no JS change** (the wire is already typed); Issues 8/9/15
  (all `app.js`) are unaffected.
- Decision 4 + Issue 14 both touch `prsl_apply_body` / the save handler; they
  compose (Issue 14 = chunk accumulation + no `data` wrapper; Decision 4 = value
  type). Sequence them together.
- Decisions 3/4/5 **refine** the planned doc warnings: `_`-prefix (reject at
  registration), `prsl_get` string-only (now "string `prsl_get` + typed
  getters"), "no deinit" (now `prsl_stop`).
- Decision 7 **resolves** (rather than "verifies") the Issue 4 upstream-status
  task.
- Decision 8 reshapes the PlatformIO/troubleshooting docs and the Issue 5
  verification context.
- Issue 15's "clear dirty after reset" remains consistent with Decision 2: the
  library *clears* dirty on save-success and reset-success; the developer only
  ever *sets* it.

## Non-architectural fixes — status after these decisions

**Unchanged, still implement:** Issue 14 (chunk accumulation + no `data`
wrapper), Issue 15 (Reset while dirty + clear dirty after reset), Issue 9 (Save
busy feedback), Issue 8 (mobile nav, Approach A), restore native host C test
harness (compiled as C++), README/CHANGELOG version + spec-reference note.

**Doc addition (from audit Integration Notes, not an original triage line):**
troubleshooting note that field-registration order matters — all groups must be
added before their fields, and all registration before `prsl_init`.

**Superseded / merged:** compile-blocker fix (→ Decision 6), Issue 7 compound
literals (→ Decision 4 example rewrite), doc warnings 11/12/13 (→ Decisions
2/3/4).

## Deferred — Reset button visibility vs. `on_reset` (Issue 15 follow-up)

**Status: deferred, no code change in 0.7.0.** Recorded for a future decision.

Mismatch: README states Reset "appears when an `on_reset` callback is
registered," but the client shows it whenever the form is dirty — even with no
callback — and clicking then POSTs `/api/settings/reset`, which returns 404
when `on_reset` is NULL (src/prsl.cpp:149-151).

Facts:

- Server already advertises whether reset is possible: the settings payload
  carries `_show_reset` (from `prsl_has_reset()` → `g_on_reset != NULL`), which
  the client receives as `showReset`.
- Client gating (app.js:129, post-Task-4): `btnReset.hidden = !(dirty || (showReset && alwaysShow))`
  — the `dirty` term is **not** gated on `showReset`, which is the defect.
- Task 4 (Issue 15) intended "show Reset only while dirty" but left the `dirty`
  term ungated.

Recommended resolution for a later pass (matches the "no dead UI" principle
established in Decisions 2/3, and unlike dirty the server already knows the
answer): gate on the callback —

```js
btnReset.hidden = !(showReset && (dirty || alwaysShow));
```

and make the README sentence fully accurate. This requires `npm run build`
(`app.min.js` regen) plus updating the pinned unit test asserting the current
logic. Deferred here to keep 0.7.0 scoped to the eight architectural decisions;
it is a one-line client fix plus test/doc alignment, not a wire or API change.

## Version

**0.7.0** — breaking public-API change (Decision 4) + new API (Decision 5).
Documented in CHANGELOG. (Not 1.0.0; parasol remains pre-1.0.)

## Testing implications

- **Native host C test harness** (restored; compiled as C++ to catch the const
  regression): add cases for —
  - Decision 3: `prsl_store_add_group` with `"_x"` returns `ESP_ERR_INVALID_ARG`.
  - Decision 4: `prsl_apply_body` preserves type (number stays number, bool stays
    bool, null stays null) for fields without `on_set`; `on_set` receives a
    `prsl_val_t` with the correct `kind`/value.
  - Decision 4: `prsl_set_val` + `prsl_get_int`/`prsl_get_float`/`prsl_get_bool`
    round-trip, including the `ESP_ERR_NOT_FOUND` path (missing and wrong type).
- **Unit/e2e (`app.js`):** unaffected by Decision 4; Issues 8/9/15 need their
  existing tests updated/extended.
- **Decision 5** (`prsl_stop`) lives in `prsl.cpp` and is not host-testable
  without the web server; verify on hardware (or a future e2e path).

## Risks / open items

- Decision 5: `AsyncWebSocket` static-instance reuse across stop→re-init (see
  note above).
- Decision 7: exact PlatformIO registry owner casing must be confirmed.
- Decision 8: exact committed-asset path that PlatformIO/Arduino auto-compile
  must be confirmed against a real PlatformIO build.
