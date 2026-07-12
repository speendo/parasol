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

# Before Committing

**Embedded awareness** — when changing `app.js`, `index.html`, or `pico.jade.min.css`, ask:
- Does this add duplicate logic that runs on the device? (build scripts don't count)
- Does the net byte change in minified output justify the feature?
- Are there any new runtime allocations (strings, objects, closures) without explicit need?

# Commands

Node.js is at `/config/.nvm/versions/node/v24.17.0/bin/`. Source nvm first:

```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
```

- `npm run build` — minify `app.js` → `app.min.js` via terser
- \`npm test\` — build minified JS, then run all tests (unit + e2e)
- `npm run test:unit` — vitest unit tests only
- `npm run test:e2e` — Playwright e2e tests only
- `npm run test:watch` — vitest in watch mode

# E2E Test Setup

Run these once, in order:

```bash
npm install
npx playwright install chromium
bash test-deps/setup.sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r test_server/requirements.txt
```

Then run the tests:

```bash
npm run test:e2e
```

Playwright config auto-starts uvicorn on port 8765 and stops it when done.

## Troubleshooting

- **Tests time out:** missing system libs — `LD_LIBRARY_PATH=test-deps/lib ldd ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | grep "not found"`. Add missing packages to `test-deps/setup.sh` and re-run.
- **Port 8765 in use:** `kill $(ps aux | grep 'uvicorn test_server' | grep -v grep | awk '{print $2}')`
- **uvicorn not found:** venv not activated — re-run `. .venv/bin/activate`
- **Playwright "Executable doesn't exist":** re-run `npx playwright install chromium`

# Version Bumping

When a change merits a new release, bump `components/parasol/library.json`
and tag accordingly:

- **Major (X.0.0):** Breaking changes to wire format, WS protocol, or public API
- **Minor (0.X.0):** New features, new field types, new UI elements
- **Patch (0.0.X):** Bug fixes, edge case hardening, indentation, doc updates

Bump the version yourself when the change clearly fits one of these buckets.
Ask the user on borderline cases.

The tag (`git tag vX.Y.Z`) must match the version in `library.json`.
