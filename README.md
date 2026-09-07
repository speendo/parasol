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
uvicorn test_server.main:app

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
| [`docs/superpowers/specs/2026-06-18-unified-settings-design.md`](docs/superpowers/specs/2026-06-18-unified-settings-design.md) | Contributors | Full architecture spec, API contract, JSON wire format, state machine *(internal design artifact — may reference superseded APIs)* |

## Installing on ESP32

Add to `platformio.ini`:

```ini
; Tarball — clean, minimal (recommended):
lib_deps = https://github.com/speendo/parasol/releases/download/v0.6.4/parasol-v0.6.4.tar.gz

; Git — full repo (for development):
lib_deps = https://github.com/speendo/parasol.git#v0.6.4
```

> **PlatformIO:** generated assets (`prsl_assets.h`/`prsl_assets.c`) are produced by CMake during the ESP-IDF build and are not in the tarball — run `cmake/generate_assets.cmake` (or an equivalent `extra_script`) before compiling.
>
> **Dependencies:** list ESPAsyncWebServer (the actively maintained `esp32async` fork — me-no-dev's original is archived) and cJSON in `lib_deps`. Do **not** list `AsyncTCP` explicitly — the fork resolves its transport transitively. If you pull the superseded `me-no-dev/ESPAsyncWebServer@^3.6` tree (which drags in RP2040 ports), add `lib_ignore = AsyncTCP_RP2040W` to keep the RP2040 transport out of an ESP32 build.

## Troubleshooting

- **Asset generation:** `prsl_assets.h`/`prsl_assets.c` are built by `cmake/generate_assets.cmake` (gzip of the minified UI + config injection) and are not shipped in the tarball. On PlatformIO, run the script or an `extra_script` before compiling — stale or missing assets silently serve the wrong UI.
- **C++ compound literals:** option structs must be `static const prsl_field_opts_t` objects. C99 compound literals passed inline at file scope are not safely initialised and are rejected by some toolchains.
- **`prsl_get` returns `NULL`:** it only reads fields stored as strings. Numeric/boolean fields need the typed getters `prsl_get_int` / `prsl_get_float` / `prsl_get_bool`.
- **Dirty flag:** if firmware never calls `prsl_set_dirty(true)`, the Save button never shows and a Save click is a silent no-op. Call `prsl_set_dirty(true)` inside `on_set` (or wherever external state changes).
- **`_`-prefixed groups:** reserved for protocol meta-fields. `prsl_add_group` rejects IDs starting with `_` (`ESP_ERR_INVALID_ARG`) — a `_`-group has no valid interpretation. Use a non-underscore ID.
- **Reset button:** appears only when an `on_reset` callback is registered and the form is dirty (or `always_show_save` is set). A successful reset clears the dirty flag.

See [`API_REFERENCE.md`](API_REFERENCE.md) for the complete C API.
