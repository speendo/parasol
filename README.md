# PARASOL

Web-based configuration UI for ESP32 devices. Renders live settings forms,
handles dirty tracking, and syncs changes via WebSocket.

## Requirements

- Modern browser (Chrome, Firefox, Safari, Edge)
- ESP32 running PARASOL firmware, **or** the Python test server for development

## Quick Start (Browser-side development)

```bash
# Install dependencies
npm install

# Start the Python test server
pip install fastapi uvicorn
uvicorn test_server.main:app --host 127.0.0.1 --port 8000

# Run tests
npm test              # all tests
npm run test:unit     # vitest unit tests
npm run test:e2e      # Playwright e2e tests

# Build (minify JS)
npm run build
```

## Documentation

| Document | Audience | Content |
|---|---|---|
| [`API_REFERENCE.md`](API_REFERENCE.md) | ESP32 firmware developers | C API reference with doxygen examples — group registration, field types, save callbacks, dirty check, runtime value access |
| [`WS_PROTOCOL.md`](WS_PROTOCOL.md) | Developers debugging WebSocket traffic | Message format reference — status, settings, apply, error payloads, state machine summary |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Contributors | Living list of open work before/after 1.0, deferred items, and resolved/superseded decisions |
| [`docs/superpowers/specs/2026-06-18-unified-settings-design.md`](docs/superpowers/specs/2026-06-18-unified-settings-design.md) | Contributors | Full architecture spec, API contract, JSON wire format, state machine *(internal design artifact — may reference superseded APIs)* |

## Installing on ESP32

Add to `platformio.ini`:

```ini
; Tarball — clean, minimal (recommended):
lib_deps = https://github.com/speendo/parasol/releases/download/v0.7.0/parasol-v0.7.0.tar.gz

; Git — full repo (for development):
lib_deps = https://github.com/speendo/parasol.git#v0.7.0
```

> **Assets:** default `prsl_assets.h`/`prsl_assets.c` (gzip of the minified UI,
> config-injected) are committed under `src/` and auto-compiled by PlatformIO
> and Arduino — default users need zero generation. To customize
> (`title`/`logo`/`favicon`/`always_show_save`), edit `parasol_config.json`
> and `index.html`, then run `python3 scripts/generate_assets.py` (or wire it
> as `extra_scripts = pre:scripts/generate_assets.py`) so the committed copy
> stays in sync. ESP-IDF generates into the build dir via CMake, which invokes
> the same `scripts/generate_assets.py` — every path emits identical bytes.
>
> **Dependencies:** list only ESPAsyncWebServer (the actively maintained `esp32async` fork — me-no-dev's original is archived) in `lib_deps`. Do **not** list cJSON — it ships inside the Arduino-ESP32 core (ESP-IDF's `json` component; ESP-IDF CMake users get it via `REQUIRES cJSON`). A separately-installed cJSON package is both unnecessary and harmful: `DaveGamble/cJSON` is not on the PlatformIO registry (unresolvable), and republished copies bundle their own `test.c`/`fuzzing` `main()`s that break the final link. Do **not** list `AsyncTCP` explicitly — the fork resolves its transport transitively. If you pull the superseded `me-no-dev/ESPAsyncWebServer@^3.6` tree (which drags in RP2040 ports), add `lib_ignore = AsyncTCP_RP2040W` to keep the RP2040 transport out of an ESP32 build.

## Troubleshooting

- **Asset generation:** default `prsl_assets.h`/`prsl_assets.c` (gzip of the minified UI, config-injected) are committed under `src/` and auto-compiled by PlatformIO and Arduino — default users need zero generation. To customize (`title`/`logo`/`favicon`/`always_show_save`), edit `parasol_config.json` and `index.html`, then run `python3 scripts/generate_assets.py` (or wire it as `extra_scripts = pre:scripts/generate_assets.py`) so the committed copy stays in sync. Stale assets silently serve the wrong UI.
- **C++ compound literals:** option structs must be `static const prsl_field_opts_t` objects. C99 compound literals passed inline at file scope are not safely initialised and are rejected by some toolchains.
- **`prsl_get` returns `NULL`:** it only reads fields stored as strings. Numeric/boolean fields need the typed getters `prsl_get_int` / `prsl_get_float` / `prsl_get_bool`.
- **Dirty flag:** if firmware never calls `prsl_set_dirty(true)`, the Save button never shows and a Save click is a silent no-op. Call `prsl_set_dirty(true)` inside `on_set` (or wherever external state changes).
- **`_`-prefixed groups:** reserved for protocol meta-fields. `prsl_add_group` rejects IDs starting with `_` (`ESP_ERR_INVALID_ARG`) — a `_`-group has no valid interpretation. Use a non-underscore ID.
- **Registration order matters:** all groups must be added before their fields (`prsl_add_field` on an unknown group returns `ESP_ERR_NOT_FOUND`), and ALL registration must finish before `prsl_init`.
- **Reset button:** appears only when an `on_reset` callback is registered and the form is dirty (or `always_show_save` is set). A successful reset clears the dirty flag.

See [`API_REFERENCE.md`](API_REFERENCE.md) for the complete C API.
