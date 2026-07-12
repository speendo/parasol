# PlatformIO Distribution & CI — 2026-07-07

## Goal

Downstream dev adds one line to `platformio.ini`:

```ini
lib_deps = https://github.com/<owner>/pico-website.git#v0.1.0
```

`pio run` pulls the library, builds assets (via CMake), compiles firmware.

## Pieces

### 1. `library.json` — already exists

```json
{"name": "pico-settings", "version": "0.1.0", ...}
```

PlatformIO reads this for metadata. Already correct.

### 2. Semver tags

```bash
git tag v0.1.0
git push --tags
```

Tag points to a stable commit. Downstream pins to `#v0.1.0`.

### 3. GitHub Actions — CI

`.github/workflows/ci.yml`:
- On push/PR: `npm ci`, `npm run build`, `npm test`
- On tag `v*`: same tests + create GitHub Release

Releases get an auto-generated changelog and a tarball.

### 4. GitHub Actions — release

On tag push, upload `app.min.js`, `index.html`, `pico.jade.min.css` as release assets (optional — library is pulled via git).

### 5. README update

Add `## Install` section with the one-line `lib_deps` snippet.

## Out of scope

- Publishing to PlatformIO Registry (needs account, separate step)
- E2E tests on real ESP32 hardware via CI
