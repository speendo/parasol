# Branch Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate `per-field-storage-callbacks` branch into `parasol-api-redesign`, fix the library version from 1.0.0 to 0.3.0, fix CI e2e test flakiness from missing WS round-trip waits, then merge and cleanup.

**Architecture:** The `per-field-storage-callbacks` branch has 5 spec/plan commits not present on `parasol-api-redesign`. All JS and CI code is identical between branches. The C code on `parasol-api-redesign` is a strict superset. We cherry-pick the missing spec commits, fix the version, fix CI timing issue in e2e tests, merge the absorbed branch, and verify.

**Tech Stack:** Git, npm, vitest, Playwright, Python/FastAPI

---

### Task 1: Cherry-pick spec/plan commits from per-field-storage-callbacks

**Files:**
- Restore: `docs/superpowers/specs/2026-07-09-parasol-api-redesign.md`
- Restore: `docs/superpowers/plans/2026-07-09-parasol-api-redesign.md`

5 commits to cherry-pick in chronological order (newest first):

```
003fc98 - plan: PARASOL API redesign — 19 tasks
e0cf8a0 - spec: rename load→get, apply→set in callback types
4f96e5c - spec: add Page Configuration section
ce18368 - spec: add dirty check hook
a5de9bf - spec: rename pwui→prsl, component→group, simplify group registration
```

- [ ] **Step 1: Cherry-pick all 5 commits**

```bash
git cherry-pick 003fc98 e0cf8a0 4f96e5c ce18368 a5de9bf
```

Expected: all 5 cherry-pick cleanly (only touch `.md` files not present on this branch).

If any fails: `git cherry-pick --abort` and escalate.

- [ ] **Step 2: Verify files restored**

```bash
ls docs/superpowers/specs/2026-07-09-parasol-api-redesign.md
ls docs/superpowers/plans/2026-07-09-parasol-api-redesign.md
```

Expected: both files exist.

---

### Task 2: Fix library.json version to 0.3.0

**Files:**
- Modify: `components/parasol/library.json`

The original plan hardcoded `"version": "1.0.0"`. Starting from `per-field-storage-callbacks` at 0.2.0 with a further breaking change, the correct version is 0.3.0.

- [ ] **Step 1: Read and edit**

Current: `"version": "1.0.0"` at `components/parasol/library.json`
Change to: `"version": "0.3.0"`

- [ ] **Step 2: Commit**

```bash
git add components/parasol/library.json
git commit -m "fix: set correct version to 0.3.0"
```

---

### Task 3: Fix CI e2e test flakiness

**Files:**
- Modify: `tests/e2e/app.test.js`

**Root cause:** e2e tests that trigger WS apply (via fill+blur) immediately assert button visibility without waiting for the WS round-trip to complete. In CI's slower environment, the browser hasn't received and processed the server's response yet. The `aria-busy` attribute on `#config-form` is set to `"true"` by `sendToServer` and removed by `onWSMessage` when processing completes — a perfect signal that the round-trip is done.

**Fix:** Before each `.toBeVisible()` / `.toBeHidden()` check that follows a blur, wait for `#config-form:not([aria-busy])`.

- [ ] **Step 1: Insert `waitForSelector` before save-button visibility checks after blur/change that triggers an apply**

The specific locations to add waits:

**Test line 78** — "Save & Apply enabled when dirty flag true":
```javascript
// After: await page.locator('[name="wifi.ssid"]').blur()
// Before: await expect(page.locator('#btn-save-apply')).not.toBeHidden()
// Add:
await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
```

**Test line 103** — "Save & Apply clears dirty after save":
```javascript
// After: await page.locator('[name="wifi.ssid"]').blur()
// Before: await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 10000 })
// Add:
await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
```

**Test line 120-124** — "Save stays visible after multiple radio changes":
```javascript
// After: await page.locator('[value="output"]').click()
// Before: await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 10000 })
// Add:
await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
```

**Test line 149** — "shows notification on external change":
```javascript
// After: await page.locator('[name="wifi.ssid"]').blur()
// Before: await expect(page.locator('#server-changed')).not.toBeHidden()
// Add:
await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
```

**Test line 162** — "Load button accepts server change":
```javascript
// After: await page.locator('[name="wifi.ssid"]').blur()
// Before: await expect(page.locator('#server-changed')).toBeHidden()
// Add:
await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
```

**Test line 376-382** — "invalid field blocks WS send until corrected":
```javascript
// After: await input.fill('valid-device') and await input.blur()
// Before: await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
// Add:
await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
```
(Also add the same wait after the first `input.fill('ab')` and `input.blur()` at line 377-378, before the `await expect(page.locator('#btn-save-apply')).toBeHidden()` at line 379.)

**Test line 259** — "required empty field shows :invalid after blur":
There's no button check here but the test does a blur followed by a wait — add `waitForSelector` to ensure the blur has been processed.

The exact edits to `tests/e2e/app.test.js`:

Edit A (line 79, after `await page.locator('[name="wifi.ssid"]').blur()`):
```
    await page.locator('[name="wifi.ssid"]').blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).not.toBeHidden()
```

Edit B (line 103 area, after `await page.locator('[name="wifi.ssid"]').blur()`):
```
    await page.locator('[name="wifi.ssid"]').blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await page.locator('#btn-save-apply').click()
```

Edit C (line 122 area, after `await page.locator('[value="output"]').click()`):
```
    await page.locator('[value="output"]').click()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await page.locator('#btn-save-apply').click()
```

Edit D (lines 149-152, after blur):
```
    await page.locator('[name="wifi.ssid"]').blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#server-changed')).not.toBeHidden()
```

Edit E (lines 162-163, after blur):
```
    await page.locator('[name="wifi.ssid"]').blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await page.locator('#notif-load').click()
```

Edit F (lines 378-382, after both blurs):
```
    await input.fill('ab')
    await input.blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeHidden()
    await input.fill('valid-device')
    await input.blur()
    await page.waitForSelector('#config-form:not([aria-busy])', { timeout: 5000 })
    await expect(page.locator('#btn-save-apply')).toBeVisible({ timeout: 5000 })
```

- [ ] **Step 2: Run e2e tests to verify**

```bash
. .venv/bin/activate && npm run test:e2e
```

Expected: 47/47 pass locally.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.test.js
git commit -m "fix: wait for WS round-trip before asserting visibility in e2e tests"
```

---

### Task 4: Merge per-field-storage-callbacks into parasol-api-redesign

**Files:**
- Merge branch: `per-field-storage-callbacks` → `parasol-api-redesign`

After cherry-picking the 5 spec commits, all changes from `per-field-storage-callbacks` are now on `parasol-api-redesign`. A merge will tie the branches together in git history.

- [ ] **Step 1: Merge per-field-storage-callbacks**

```bash
git merge per-field-storage-callbacks -m "merge: absorb per-field-storage-callbacks (all changes superseded)"
```

Expected: This will likely auto-merge cleanly since:
- The 5 spec commits are identical (cherry-picked)
- All C code changes in per-field-storage-callbacks are in files that were deleted/renamed by our branch (git will recognize that)
- JS/CI files are identical between branches

If there are conflicts: resolve by accepting `parasol-api-redesign`'s version of C files and the JS/CI files (they're supersets or identical).

- [ ] **Step 2: Verify clean merge**

```bash
git status --short
git log --oneline --graph -5
```

- [ ] **Step 3: Delete absorbed branch**

```bash
git branch -d per-field-storage-callbacks
git tag -d v0.2.0 2>/dev/null; true
```

---

### Task 5: Full test suite verification

- [ ] **Step 1: Build minified JS**

```bash
. ~/.nvm/nvm.sh && export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH" && npm run build
```

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```

Expected: 164/164 pass.

- [ ] **Step 3: Run e2e tests**

```bash
. .venv/bin/activate && npm run test:e2e
```

Expected: 47/47 pass.

- [ ] **Step 4: Verify final branch state**

```bash
git log --oneline --graph -10
git branch
```

Expected: Clean linear/merged history on `parasol-api-redesign`, `per-field-storage-callbacks` deleted.
