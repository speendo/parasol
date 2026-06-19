# Pico Website

Web-based configuration UI for ESP32 devices. Renders live settings forms,
handles dirty tracking, and syncs changes via HTTP or WebSocket.

## Requirements

- Modern browser (Chrome, Firefox, Safari, Edge)
- ESP32 running pico-website firmware, **or** the Python test server for development

## Quick Start

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

## Architecture

See [`docs/superpowers/specs/2026-06-18-unified-settings-design.md`](docs/superpowers/specs/2026-06-18-unified-settings-design.md)
for the full design spec, API contract, and JSON format reference.
