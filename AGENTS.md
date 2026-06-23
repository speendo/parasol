# Project Constraints

The target server is an **ESP32** with limited RAM, flash storage, and CPU.
All design decisions must favor shifting computation to the client (browser)
to minimize server load.

- Prefer client-side computation over server-side where possible
- Keep wire formats compact — every byte on the wire matters
- Reuse JS functions across HTTP and WebSocket paths (DRY)
- Avoid unnecessary dependencies on the ESP32
- Static files (HTML, JS, CSS) are served from the ESP32's filesystem
- **Write short JS.** Every byte matters on the ESP32. Prefer `function` over arrow
  functions (gzip compresses `function` better than the varied arrow syntax). Use
  template literals only when you have multiple variables. Favor simple imperative
  code over functional abstractions that add bytes. Avoid lodash, utility libs,
  and any dependency heavier than a single inlined helper.

See `docs/superpowers/specs/2026-06-18-unified-settings-design.md` for the
current architecture and API design.

# Commands

Node.js is at `/config/.nvm/versions/node/v24.17.0/bin/`. Source nvm first:

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
```

- `npm run build` — minify `app.js` → `app.min.js` via terser
- `npm test` — run all tests (unit + e2e)
- `npm run test:unit` — vitest unit tests only
- `npm run test:e2e` — Playwright e2e tests only
- `npm run test:watch` — vitest in watch mode

# Test Server

A FastAPI test server lives at `test_server/`. It auto-starts when e2e tests
run (configured in `playwright.config.js` webServer). Start it manually:

```bash
pip install fastapi uvicorn
uvicorn test_server.main:app --host 0.0.0.0 --port 8000
```

# Playwright E2E Tests

E2e tests use Playwright against the test server. First install browsers:

```bash
npx playwright install chromium
```

Then run e2e tests (test server auto-starts):

```bash
npm run test:e2e
```

The test server reset endpoint (`/api/settings/reset`) is called before each
test via `test.beforeEach` in `tests/e2e/app.test.js`.

# Playwright System Dependencies

The chromium headless shell used by Playwright requires several shared
libraries (libnss3, libnspr4, libdbus-1-3, libatk, etc.) that may not be
installed on the system. These are provided in `test-deps/lib/`.

To (re)generate `test-deps/lib/`, run the setup script (no sudo needed):

```bash
bash test-deps/setup.sh
```

This downloads the required .deb packages from `archive.ubuntu.com` and
extracts them into `test-deps/lib/`. The `playwright.config.js` sets
`LD_LIBRARY_PATH` to point at this directory automatically when it exists.

The cached `.deb` files live in `test-deps/debs/` to avoid re-downloading. Both
directories are safe to commit — they're platform-specific (Ubuntu Noble
24.04 amd64) but needed for CI.
