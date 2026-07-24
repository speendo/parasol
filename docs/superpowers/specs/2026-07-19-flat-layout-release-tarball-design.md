# Flat Layout + Release Tarball — 2026-07-19

## Problem

GitHub Releases upload `app.min.js`, `index.html`, and `pico.jade.min.css` as separate assets. A downstream PlatformIO developer doesn't use these — they add `lib_deps` which clones the entire repo (including tests, docs, npm config). There is no clean, minimal package for PlatformIO consumption.

Additionally, the repo layout is nonstandard: `library.json` lives at `components/parasol/` (not root), so the repo doesn't match the canonical PlatformIO library shape. Assets live at the repo root outside the component. The CMake build navigates `../../..` to find them.

Finally, `dependencies/cJSON/` is a git submodule that bundles a full cJSON checkout — including tests, docs, and CI config — despite both ESP-IDF (`REQUIRES cJSON`) and PlatformIO (`"DaveGamble/cJSON"` in `library.json`) resolving cJSON through their own dependency mechanisms. The bundled copy provides only a redundant header and adds git submodule overhead.

## Goal

1. Flatten the repo so the library root IS the repo root — standard PlatformIO layout, no `srcDir`/`includeDir` configuration needed.
2. Remove the cJSON submodule — both build systems resolve it independently.
3. CI produces a clean release tarball containing only library files (no tests, docs, npm).
4. Downstream dev gets a one-line `lib_deps` install with a minimal package.

## Restructure

### Files to move

| From | To |
|---|---|
| `components/parasol/library.json` | `library.json` |
| `components/parasol/CMakeLists.txt` | `CMakeLists.txt` |
| `components/parasol/cmake/generate_assets.cmake` | `cmake/generate_assets.cmake` |
| `components/parasol/src/*` | `src/*` |
| `components/parasol/include/*` | `include/*` |
| `components/parasol/examples/*` | `examples/*` |

### Files to delete

- `components/` directory entirely.
- `dependencies/` git submodule (cJSON). The `library.json` dependency `"DaveGamble/cJSON": "~1.7"` provides it for PlatformIO; ESP-IDF provides it via `REQUIRES cJSON` in `CMakeLists.txt`. The bundled copy was only a redundant header.
- `.gitmodules` file (cJSON was the only submodule).

### Files that stay at root (unchanged)

`app.js`, `app.min.js`, `index.html`, `pico.jade.min.css`, `build.sh`, `package.json`, `parasol_config.json`, `docs/`, `tests/`, `test_server/`, `.github/`.

### Resulting layout

```
(repo root)/
├── library.json
├── CMakeLists.txt
├── cmake/generate_assets.cmake
├── src/                   # prsl.cpp, prsl_ws.cpp, prsl_store.c, prsl_json.c, + .h
├── include/prsl.h
├── examples/basic/main.c
├── app.min.js
├── index.html
├── pico.jade.min.css
├── (dev files: app.js, package.json, tests/, docs/, .github/, ...)
```

This is the canonical PlatformIO library shape (`library.json` + `src/` + `include/` at root). Default `srcDir` (`src`) and `includeDir` (`include`) work out of the box — no `build.srcDir` or `build.includeDir` configuration needed.

### CMakeLists.txt changes

Two edits:

**1. `ASSETS_SRC` path** — CMakeLists.txt now lives in the same directory as the assets:

```cmake
# Before (was 3 levels deep in components/parasol/):
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}/../../..")

# After (at repo root, alongside assets):
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}")
```

This also works in the release tarball — CMakeLists.txt and assets are always in the same directory whether the user extracts into `components/parasol/` or uses the repo directly.

**2. `INCLUDE_DIRS`** — remove the redundant cJSON include path:

```cmake
# Before:
INCLUDE_DIRS "include" "src" "dependencies/cJSON" "${GENERATED_DIR}"

# After:
INCLUDE_DIRS "include" "src" "${GENERATED_DIR}"
```

All other paths (`COMPONENT_SRCS`, `DEPENDS`, `cmake/generate_assets.cmake`) are unchanged — they are relative to `CMakeLists.txt` and the files moved with it.

### `library.json`

No changes needed. Default `srcDir` (`src`) and `includeDir` (`include`) match the flat layout. The existing `"DaveGamble/cJSON": "~1.7"` dependency already provides cJSON for PlatformIO builds.

## Release Tarball

### Structure

The CI release job creates `parasol-v<VERSION>.tar.gz` with this flat layout:

```
parasol/
├── library.json
├── CMakeLists.txt
├── cmake/generate_assets.cmake
├── src/
│   ├── prsl.cpp
│   ├── prsl_ws.cpp
│   ├── prsl_ws.h
│   ├── prsl_store.c
│   ├── prsl_store.h
│   ├── prsl_json.c
│   └── prsl_json.h
├── include/prsl.h
├── examples/basic/main.c
├── app.min.js
├── index.html
└── pico.jade.min.css
```

The tarball root is `parasol/` (not `parasol-v0.5.0/`) so users can extract directly into their `components/` directory:

```bash
tar xzf parasol-v0.5.1.tar.gz -C components/
# → components/parasol/CMakeLists.txt — ESP-IDF discovers by directory name
```

### Why this structure works

- **PlatformIO** finds `library.json` at the tarball root → recognizes as library. Defaults find `src/` and `include/` without configuration.
- **ESP-IDF** discovers `components/parasol/CMakeLists.txt` when the user extracts into their `components/` directory. `ASSETS_SRC` is `${CMAKE_CURRENT_LIST_DIR}` — finds `app.min.js` etc. in the same directory.
- **Git-based install** also works — PlatformIO finds `library.json` at the repo root with the same flat layout.

### Excluded from tarball

`tests/`, `test_server/`, `test-deps/`, `test-results/`, `docs/`, `.github/`,
`node_modules/`, `package.json`, `package-lock.json`, `app.js` (unminified),
`build.sh`, `playwright.config.js`, `vitest.config.js`, `.venv/`, `.pytest_cache/`,
`.superpowers/`, `.git/`, `.gitignore`, `.gitmodules`, `AGENTS.md`,
`API_REFERENCE.md`, `WS_PROTOCOL.md`, `parasol_config.json`, `pico CI log.txt`.

`parasol_config.json` is excluded — it is a per-project build configuration file. The `CMakeLists.txt` gracefully defaults all config values when the file is absent. Users who need custom title/logo/always_show_save create their own at their project root.

### How CI builds it

The release job runs:

```bash
VERSION="${GITHUB_REF_NAME#v}"
mkdir parasol
cp library.json CMakeLists.txt parasol/
cp -r cmake src include examples parasol/
cp app.min.js index.html pico.jade.min.css parasol/
tar czf "parasol-v${VERSION}.tar.gz" parasol
```

### Release assets

Upload only `parasol-v<VERSION>.tar.gz`. Remove the individual `app.min.js`, `index.html`, `pico.jade.min.css` uploads.

## Downstream Usage

```ini
; Tarball — clean, minimal (recommended):
lib_deps = https://github.com/speendo/parasol/releases/download/v0.5.1/parasol-v0.5.1.tar.gz

; Git — full repo (for development or running tests):
lib_deps = https://github.com/speendo/parasol.git#v0.5.1
```

Both work because the flat layout serves both paths without configuration.

## CI Changes

No `submodules: true` needed — the cJSON submodule is removed. The checkout step stays as-is.

The release job replaces individual file uploads with tarball creation:

```yaml
- name: Build release tarball
  run: |
    VERSION="${GITHUB_REF_NAME#v}"
    mkdir parasol
    cp library.json CMakeLists.txt parasol/
    cp -r cmake src include examples parasol/
    cp app.min.js index.html pico.jade.min.css parasol/
    tar czf "parasol-v${VERSION}.tar.gz" parasol

- name: Create GitHub Release
  uses: softprops/action-gh-release@v3
  with:
    files: parasol-v*.tar.gz
```

## Out of Scope

- Publishing to PlatformIO Registry (future step, requires account).
- `pio pkg pack` integration (can replace manual tarball when ready for Registry).
- Changing the test or build infrastructure.
- Arduino IDE support — dependency graph (cJSON, ESPAsyncWebServer, AsyncTCP) requires PlatformIO's dependency resolution.
