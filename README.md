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
| [`docs/superpowers/specs/2026-06-18-unified-settings-design.md`](docs/superpowers/specs/2026-06-18-unified-settings-design.md) | Contributors | Full architecture spec, API contract, JSON wire format, state machine |

## Installing on ESP32

Add to `platformio.ini`:

```ini
lib_deps = https://github.com/speendo/parasol.git#v0.1.0
```

See [`API_REFERENCE.md`](API_REFERENCE.md) for the complete C API.
