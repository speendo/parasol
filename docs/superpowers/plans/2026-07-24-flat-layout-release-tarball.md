# Flat Layout + Release Tarball Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatten the repo to canonical PlatformIO library shape, remove the cJSON submodule, and produce a clean release tarball via CI.

**Architecture:** Move all library files from `components/parasol/` to repo root, delete the cJSON submodule (both build systems resolve it independently), and update the CI release job to produce a minimal tarball instead of individual file uploads.

**Tech Stack:** Git, Bash, CMake, YAML (GitHub Actions), Markdown

## Global Constraints

- ESP32 target with limited RAM/flash — no runtime changes
- PlatformIO `library.json` at repo root, `src/` and `include/` at root (canonical shape)
- cJSON resolved externally by both ESP-IDF (`REQUIRES cJSON`) and PlatformIO (`"DaveGamble/cJSON": "~1.7"`)
- Release tarball contains only library files — no tests, docs, npm, or dev config
- Tarball root is `parasol/` so users extract straight into `components/` directory

---

### Task 1: Remove cJSON git submodule

**Files:**
- Delete: `.gitmodules`
- Modify: `components/parasol/CMakeLists.txt`

**Interfaces:**
- Consumes: nothing
- Produces: cleansed `CMakeLists.txt` with no cJSON `INCLUDE_DIRS` reference, no submodule

- [ ] **Step 1: Deinitialize and remove the submodule**

```bash
git submodule deinit -f components/parasol/dependencies/cJSON
git rm components/parasol/dependencies/cJSON
rm -rf .git/modules/components/parasol/dependencies/cJSON
```

- [ ] **Step 2: Delete `.gitmodules`** (cJSON was the only submodule)

```bash
git rm .gitmodules
```

- [ ] **Step 3: Remove cJSON from `CMakeLists.txt` `INCLUDE_DIRS`**

Edit `components/parasol/CMakeLists.txt`, change line 39 from:

```cmake
    INCLUDE_DIRS "include" "src" "dependencies/cJSON" "${GENERATED_DIR}"
```

to:

```cmake
    INCLUDE_DIRS "include" "src" "${GENERATED_DIR}"
```

- [ ] **Step 4: Verify the edit**

```bash
rg 'dependencies/cJSON' -- components/
```

Expected: no matches.

- [ ] **Step 5: Run tests to verify no regressions**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all tests pass (unit + e2e).

- [ ] **Step 6: Commit**

```bash
git add components/parasol/CMakeLists.txt .gitmodules components/parasol/dependencies/cJSON
git commit -m "chore: remove cJSON git submodule — resolved by build systems"
```

---

### Task 2: Move library files to repo root

**Files:**
- Create: `library.json`, `CMakeLists.txt`, `cmake/generate_assets.cmake`, `src/*`, `include/prsl.h`, `examples/basic/main.c` (moved from `components/parasol/`)
- Delete: `components/` directory

**Interfaces:**
- Consumes: files at `components/parasol/` from Task 1
- Produces: files at repo root, no `components/` directory

- [ ] **Step 1: Move files from `components/parasol/` to repo root**

```bash
git mv components/parasol/library.json .
git mv components/parasol/CMakeLists.txt .
git mv components/parasol/cmake cmake
git mv components/parasol/src src
git mv components/parasol/include include
git mv components/parasol/examples examples
```

- [ ] **Step 2: Remove the now-empty `components/parasol/` directory and its remaining contents**

```bash
git rm -r components/parasol/test
git rm components/  # should fail if not empty — check first
rmdir components/parasol components 2>/dev/null || true
```

Note: `components/parasol/` still contains the `test/` directory (ESP-IDF device tests). Remove it:

```bash
git rm -r components
```

If `git rm -r components` reports nothing to do (already empty after earlier moves), run:

```bash
rmdir components/parasol components 2>/dev/null || true
```

- [ ] **Step 3: Verify the new layout**

```bash
ls library.json CMakeLists.txt
ls cmake/generate_assets.cmake
ls src/prsl.cpp src/prsl_store.c src/prsl_json.c
ls include/prsl.h
ls examples/basic/main.c
test -d components && echo "FAIL: components/ still exists" || echo "OK: components/ removed"
```

Expected: all files exist at root, `components/` directory removed.

- [ ] **Step 4: Run tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: flatten library to repo root"
```

---

### Task 3: Update `CMakeLists.txt` `ASSETS_SRC` path

**Files:**
- Modify: `CMakeLists.txt` (at repo root)

**Interfaces:**
- Consumes: `CMakeLists.txt` at repo root from Task 2
- Produces: `ASSETS_SRC` pointing to `${CMAKE_CURRENT_LIST_DIR}`

- [ ] **Step 1: Update the `ASSETS_SRC` path**

Edit `CMakeLists.txt`, change line 5 from:

```cmake
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}/../../..")
```

to:

```cmake
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}")
```

- [ ] **Step 2: Verify the edit**

```bash
rg 'ASSETS_SRC' CMakeLists.txt
```

Expected output:
```
5:set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}")
```

- [ ] **Step 3: Verify the full `CMakeLists.txt` looks correct**

```bash
cat CMakeLists.txt
```

Expected:

```cmake
set(COMPONENT_SRCS "src/prsl_store.c" "src/prsl_json.c" "src/prsl.cpp" "src/prsl_ws.cpp")
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}")
set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(ASSETS_C "${GENERATED_DIR}/prsl_assets.c")
set(ASSETS_H "${GENERATED_DIR}/prsl_assets.h")
# ... rest unchanged

add_custom_command(
    OUTPUT ${ASSETS_C} ${ASSETS_H}
    COMMAND ${CMAKE_COMMAND}
        -DASSETS_SRC="${ASSETS_SRC}"
        ...
    DEPENDS
        "${ASSETS_SRC}/index.html"
        "${ASSETS_SRC}/app.min.js"
        "${ASSETS_SRC}/pico.jade.min.css"
        "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    ...
)

idf_component_register(
    SRCS ${COMPONENT_SRCS} ${ASSETS_C}
    INCLUDE_DIRS "include" "src" "${GENERATED_DIR}"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
    COMPILE_DEFINITIONS PRSL_ALWAYS_SHOW_SAVE=${PRSL_ALWAYS_SHOW_SAVE}
)
```

- [ ] **Step 4: Run tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add CMakeLists.txt
git commit -m "fix: update ASSETS_SRC path for flat layout"
```

---

### Task 4: Update CI workflow to produce release tarball

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: flat repo layout from Tasks 2-3
- Produces: release job that creates `parasol-v<VERSION>.tar.gz` instead of individual file uploads

- [ ] **Step 1: Replace the release job's upload step**

Edit `.github/workflows/ci.yml`. Locate the `release` job (starts at line 39). The current steps 48-63:

```yaml
      - name: Install system dependencies
        run: |
          apt-get update -qq
          apt-get install -y -qq git curl ca-certificates
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - run: npm ci && npm run build
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v3
        with:
          files: |
            app.min.js
            index.html
            pico.jade.min.css
```

Replace the last step (lines 57-63) with tarball creation and updated release step:

```yaml
      - name: Install system dependencies
        run: |
          apt-get update -qq
          apt-get install -y -qq git curl ca-certificates
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - run: npm ci && npm run build
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

**Full release job after edit** (lines 39-63):

```yaml
  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build-and-test
    runs-on: ubuntu-latest
    permissions:
      contents: write
    container:
      image: debian:trixie-slim
    steps:
      - name: Install system dependencies
        run: |
          apt-get update -qq
          apt-get install -y -qq git curl ca-certificates
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - run: npm ci && npm run build
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

- [ ] **Step 2: Verify the CI file is valid YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: no output (no parse errors).

- [ ] **Step 3: Run tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: replace individual release uploads with tarball creation"
```

---

### Task 5: Update documentation for new layout

**Files:**
- Modify: `API_REFERENCE.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: flat layout from Tasks 2-3
- Produces: docs with correct paths

- [ ] **Step 1: Update `API_REFERENCE.md` example link**

Edit line 592, change:

```markdown
[`components/parasol/examples/basic/main.c`](components/parasol/examples/basic/main.c)
```

to:

```markdown
[`examples/basic/main.c`](examples/basic/main.c)
```

- [ ] **Step 2: Update `AGENTS.md` version bump path**

Edit line 82, change:

```markdown
When a change merits a new release, bump `components/parasol/library.json`
```

to:

```markdown
When a change merits a new release, bump `library.json`
```

- [ ] **Step 3: Update `README.md` lib_deps example**

Edit the "Installing on ESP32" section (lines 40-44). Replace the current `lib_deps` example:

```ini
lib_deps = https://github.com/speendo/parasol.git#v0.1.0
```

with both options:

```ini
; Tarball — clean, minimal (recommended):
lib_deps = https://github.com/speendo/parasol/releases/download/v0.5.0/parasol-v0.5.0.tar.gz

; Git — full repo (for development):
lib_deps = https://github.com/speendo/parasol.git#v0.5.0
```

- [ ] **Step 4: Verify edits**

```bash
rg 'components/parasol' API_REFERENCE.md AGENTS.md README.md
```

Expected: no matches (all references updated).

- [ ] **Step 5: Run tests**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add API_REFERENCE.md AGENTS.md README.md
git commit -m "docs: update paths for flat repo layout"
```

---

### Task 6: Final verification

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: all prior tasks
- Produces: confirmation that everything works

- [ ] **Step 1: Run full test suite**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm test
```

Expected: all tests pass (unit + e2e).

- [ ] **Step 2: Verify no stale references remain**

```bash
rg 'components/parasol' --glob '!docs/superpowers/specs/*' --glob '!.superpowers/*' --glob '!.git/*'
```

Expected: no matches in active code (specs and .superpowers history are exempt).

- [ ] **Step 3: Verify tarball can be created locally**

```bash
VERSION="0.6.0"
mkdir -p /tmp/tarball-test
mkdir /tmp/tarball-test/parasol
cp library.json CMakeLists.txt /tmp/tarball-test/parasol/
cp -r cmake src include examples /tmp/tarball-test/parasol/
cp app.min.js index.html pico.jade.min.css /tmp/tarball-test/parasol/
tar czf /tmp/tarball-test/parasol-v0.6.0.tar.gz -C /tmp/tarball-test parasol
tar tzf /tmp/tarball-test/parasol-v0.6.0.tar.gz
```

Expected output:
```
parasol/
parasol/library.json
parasol/CMakeLists.txt
parasol/cmake/
parasol/cmake/generate_assets.cmake
parasol/src/
parasol/src/prsl.cpp
parasol/src/prsl_ws.cpp
parasol/src/prsl_ws.h
parasol/src/prsl_store.c
parasol/src/prsl_store.h
parasol/src/prsl_json.c
parasol/src/prsl_json.h
parasol/include/
parasol/include/prsl.h
parasol/examples/
parasol/examples/basic/
parasol/examples/basic/main.c
parasol/app.min.js
parasol/index.html
parasol/pico.jade.min.css
```

- [ ] **Step 4: Verify no dev files in tarball**

```bash
tar tzf /tmp/tarball-test/parasol-v0.6.0.tar.gz | grep -E '(tests/|test_server/|docs/|node_modules/|package.json|app\.js$$|\.github/|\.git/)' && echo "FAIL: dev files in tarball" || echo "OK: tarball clean"
```

Expected: `OK: tarball clean`

- [ ] **Step 5: Clean up test tarball**

```bash
rm -rf /tmp/tarball-test
```

- [ ] **Step 6: Verify git log is clean**

```bash
git log --oneline -6
```

Expected: 5 commits from Tasks 1-5, all on `feature/flat-layout-release-tarball`.
