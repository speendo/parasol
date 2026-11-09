# Responsive Nav (always-present ☰ device menu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken flex-wrap mobile nav with an always-present hamburger (☰) device menu; on narrow screens the section links relocate into that menu instead of overflowing.

**Architecture:** Header keeps Pico's flex `nav` but gains a static `details.dropdown#nav-actions` (the ☰). Device actions (Reboot) always live inside it. Section links are built into `ul#nav-list` and, when a measure says they no longer fit beside logo+☰, the same `<li>` nodes are moved into `#nav-actions ul` and `#nav-list` is hidden. A `syncDeviceMenu()`/`applyNavMode()`/`updateFit()` trio in `app.js` drives it; CSS overrides stay in `index.html`'s inline `<style>`.

**Tech Stack:** Plain JS (`app.js`, no deps), Pico CSS `details.dropdown` (unmodified file), `index.html` inline CSS, vitest (jsdom) + Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-09-responsive-nav-menu-design.md`

## Global Constraints

- Server is an ESP32: short JS, `function` not arrows, no new dependencies, prefer CSS where possible.
- **Do not modify `pico.jade.min.css`.** All CSS overrides live in the `index.html` inline `<style>`.
- `index.html` static markup and the jsdom fixture in `tests/setup.js` must be kept in sync (unit tests run against the fixture, not `index.html`).
- After any `app.js` change, regenerate `app.min.js` via `npm run build` (executor: source nvm first, `. ~/.nvm/nvm.sh`, node at `/config/.nvm/versions/node/v24.17.0/bin/`).
- Test commands: `npm run test:unit`, `npm run test:e2e` (Playwright reuses the running test server on port 8000), `npm test`.
- **Unit tests read `app.js` directly and need no build. e2e loads `app.min.js` (via `index.html`), so run `npm run build` BEFORE any e2e run.**
- Line numbers in this plan are from `HEAD`. If you have already edited the file, locate code by the quoted function/markup text instead of trusting numbers.
- **Do NOT stage or commit** the uncommitted port-8000 edits in `AGENTS.md`, `README.md`, `playwright.config.js` — they are separate work. Stage only files named in each task.
- Commit messages follow repo style (`feat:`, `fix:`, `docs:`, `test:`).

---

### Task 1: Wide-mode device menu scaffold

Replace the standalone "System ▾" reboot dropdown with a device menu that holds Reboot, add its static markup and trigger styling, and keep all wide-screen behavior green.

**Files:**
- Modify: `index.html` (header `<nav>` markup; add `<style>` rules for the ☰ trigger + danger row)
- Modify: `app.js` (top-of-IIFE element refs; `renderNav()` at 666-724; new `syncDeviceMenu()`, `buildRebootItem()`; replace the click delegation at 705-713)
- Modify: `tests/setup.js` (body fixture → real header structure)
- Modify: `tests/unit/app.test.js` (reboot-dropdown describe at ~1002)
- Modify: `tests/e2e/app.test.js` ("Reboot button" describe at 241-288)

**Interfaces:**
- Consumes: existing `navList`, `showReboot`, `groups`, `statusGroups`, `renderLink()`.
- Produces: static elements `#nav-actions` (`details.dropdown`, hidden initially), `#nav-actions summary`, `#nav-actions ul`, `#nav-sep` (`<li>`, hidden initially); JS refs `navActions`, `navActionsList`, `navSep`, var `navCollapsed = false`; functions `buildRebootItem()`, `syncDeviceMenu()`, `wireNavClick()`.

- [ ] **Step 1: Update the jsdom fixture DOM**

In `tests/setup.js`, replace the line `<nav id="nav-list"></nav>` with a structure mirroring the real header:

```html
<header>
  <nav>
    <ul id="nav-list"></ul>
    <details class="dropdown" id="nav-actions" hidden>
      <summary>☰</summary>
      <ul>
        <li id="nav-sep" hidden></li>
      </ul>
    </details>
  </nav>
</header>
```

- [ ] **Step 2: Update `index.html` header markup**

Replace the `<nav>…</nav>` block (currently logo `<ul>` + `<ul id="nav-list">`) with three children (logo ul, section-list ul, and the static device-menu details):

```html
<nav>
  <ul>
    <li style="display:flex;align-items:center"><img id="nav-logo" src="{{LOGO}}" alt="Logo" style="height:2rem;margin-right:0.5rem" onerror="this.style.display='none'"><h1 style="margin:0">{{TITLE}}</h1></li>
  </ul>
  <ul id="nav-list">
    <!-- JS populates section links here -->
  </ul>
  <details class="dropdown" id="nav-actions" hidden>
    <summary aria-label="Menu" title="Menu">☰</summary>
    <ul dir="rtl">
      <li id="nav-sep" hidden></li>
    </ul>
  </details>
</nav>
```

- [ ] **Step 3: Add trigger + danger CSS in `index.html`**

Append these rules to the inline `<style>` (they coexist with the old `@media (max-width:600px)` block for now; Task 2 removes it):

```css
#nav-actions { margin-left: auto; }
#nav-actions[hidden], #nav-sep[hidden] { display: none; }
#nav-actions summary {
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  line-height: 1;
}
#nav-actions summary::after { content: none; }
#nav-actions .nav-action a {
  color: var(--pico-color-red);
  font-weight: 600;
}
```

- [ ] **Step 4: Write the failing unit tests**

In `tests/unit/app.test.js`, replace the whole `describe('renderNav reboot dropdown', ...)` block (lines ~1002-1021) with:

```js
describe('renderNav device menu', function () {
  it('builds Reboot into #nav-actions when showReboot is true', function () {
    window.__test.showReboot = true;
    window.__test.groups = [];
    window.__test.statusGroups = [];
    window.renderNav();
    expect(document.getElementById('nav-system')).toBeNull();
    expect(document.getElementById('nav-actions').hasAttribute('hidden')).toBe(false);
    var rebootLink = document.getElementById('nav-reboot');
    expect(rebootLink).not.toBeNull();
    expect(rebootLink.textContent).toBe('Reboot');
    expect(document.getElementById('nav-actions').contains(rebootLink)).toBe(true);
  });

  it('hides #nav-actions and omits Reboot when showReboot is false', function () {
    window.__test.showReboot = false;
    window.__test.groups = [];
    window.__test.statusGroups = [];
    window.renderNav();
    expect(document.getElementById('nav-reboot')).toBeNull();
    expect(document.getElementById('nav-actions').hasAttribute('hidden')).toBe(true);
  });
});
```

- [ ] **Step 5: Run the failing unit tests**

Run: `npm run test:unit -- tests/unit/app.test.js -t "device menu"`
Expected: FAIL — `#nav-actions` is null / `nav-system` still exists (old code builds it).

- [ ] **Step 6: Update `app.js` element refs**

After the existing ref block (lines 4-9), add:

```js
var navActions = document.getElementById('nav-actions');
var navActionsList = navActions ? navActions.querySelector('ul') : null;
var navSep = navActions ? document.getElementById('nav-sep') : null;
var navCollapsed = false;
var navClickWired = false;
```

- [ ] **Step 7: Replace `renderNav()` and add the new functions**

Delete the ENTIRE existing `renderNav()` function — from the line `function renderNav() {` through its closing `}`. The function ends immediately after this block, which you must delete along with it:

```js
    if (navList._clickWired) return;
    navList._clickWired = true;
    navList.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link && link.hash) {
        var el = document.getElementById(link.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    });
  }
```

Keep `renderLink()` (it starts right after with `/** Append a single nav link for a group. */`). Insert this new `renderNav()` in place of the deleted function, and append `buildRebootItem`, `syncDeviceMenu`, and `wireNavClick` immediately AFTER `renderLink()`'s closing brace:

```js
function renderNav() {
  navList.innerHTML = '';
  var seen = {};
  for (var si = 0; si < statusGroups.length; si++) {
    seen[statusGroups[si].id] = true;
    renderLink(statusGroups[si]);
  }
  for (var gi = 0; gi < groups.length; gi++) {
    if (seen[groups[gi].id]) continue;
    seen[groups[gi].id] = true;
    renderLink(groups[gi]);
  }
  syncDeviceMenu();
  wireNavClick();
}
```

```js
function buildRebootItem() {
  var li = document.createElement('li');
  li.className = 'nav-action';
  var a = document.createElement('a');
  a.href = '#';
  a.id = 'nav-reboot';
  a.textContent = 'Reboot';
  a.addEventListener('click', function (e) {
    e.preventDefault();
    if (navActions) navActions.open = false;
    var dd = document.getElementById('reboot-dialog');
    if (dd) dd.showModal();
  });
  li.appendChild(a);
  return li;
}

function syncDeviceMenu() {
  if (!navActions || !navActionsList) return;
  var existing = document.getElementById('nav-reboot');
  if (showReboot && !existing) {
    navActionsList.appendChild(buildRebootItem());
  } else if (!showReboot && existing) {
    existing.parentNode.removeChild(existing.parentNode);
  }
  var hasReboot = !!document.getElementById('nav-reboot');
  navActions.hidden = !(navCollapsed || hasReboot);
  if (navSep) navSep.hidden = !(navCollapsed && hasReboot);
}

function wireNavClick() {
  if (navClickWired) return;
  navClickWired = true;
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a');
    if (link && link.hash) {
      var el = document.getElementById(link.hash.slice(1));
      if (el && el.tagName === 'DETAILS') el.open = true;
      if (navActions) navActions.open = false;
    }
  });
}
```

Note: `#nav-reboot` is inside the closed dropdown when wide; `document.getElementById` still finds it, so `syncDeviceMenu`'s visibility logic works regardless of `open` state.

- [ ] **Step 8: Run unit tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS. Also confirm the pre-existing `renderNav` tests (status-first order, dedupe) still pass unchanged — Reboot no longer lives in `#nav-list`, so their link counts are unaffected.

- [ ] **Step 9: Update the e2e "Reboot button" group**

In `tests/e2e/app.test.js`, rewrite the group (lines 241-288) so every `#nav-system summary` becomes `#nav-actions summary`, and the first test targets the new structure:

```js
test.describe('Reboot button', () => {
  test('device menu appears in nav', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('#nav-system')).toHaveCount(0)
    await expect(page.locator('#nav-actions')).toBeVisible()
    await page.locator('#nav-actions summary').click()
    await expect(page.locator('#nav-reboot')).toHaveText('Reboot')
  })
  // 'Reboot opens confirmation dialog', 'Cancel closes dialog without POST',
  // 'Confirm sends POST and shows Rebooting…', 'WebSocket disconnects after reboot':
  // keep bodies identical but replace `#nav-system summary` with `#nav-actions summary`.
})
```

- [ ] **Step 10: Regenerate assets and run the full e2e group**

Run:
```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run build
npm run test:e2e -- tests/e2e/app.test.js -g "Reboot button"
```
Expected: PASS (test server already running on 8000; Playwright reuses it).

Then run the WHOLE e2e file to catch regressions in "Form rendering" and "Navigation and hash" (their selectors are unchanged but they exercise the nav):

```bash
npm run test:e2e
```
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add index.html tests/setup.js app.js tests/unit/app.test.js tests/e2e/app.test.js app.min.js
git commit -m "feat: add always-present device menu for Reboot"
```

If anything in the unit or e2e suite fails here, fix it before committing — do not proceed to Task 2 with red tests.

---

### Task 2: Measure-based collapse — relocate section links into the ☰

Add the geometry measurement and node relocation so section links move into the device menu when they no longer fit, and back out when space returns. Remove the Approach A flex-wrap media query.

**Files:**
- Modify: `app.js` (`renderNav()` to reset collapsed state + call `updateFit()`; new `applyNavMode`, `updateFit`, `moveSectionsToNavList`, `moveSectionsToMenu`, `wireNavResize`; dev-guard export of `setNavMode`; `sectionCount`, `GAP`)
- Modify: `index.html` (remove the `@media (max-width:600px)` block; add collapse-visibility CSS)
- Modify: `tests/unit/app.test.js` (new collapse/expand describe)
- Modify: `tests/e2e/app.test.js` (new "Responsive nav" describe)

**Interfaces:**
- Consumes: from Task 1 — `navActions`, `navActionsList`, `navSep`, `navCollapsed`, `renderLink()`, `syncDeviceMenu()`.
- Produces: functions `applyNavMode(collapsed)`, `updateFit()`, `moveSectionsToNavList()`, `moveSectionsToMenu()`, `wireNavResize()`; module-level `sectionCount`, `GAP`; `window.__test.setNavMode`.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/app.test.js`:

```js
describe('nav collapse/expand', function () {
  beforeEach(function () {
    window.__test.groups = [{ id: 'wifi', label: 'Wifi' }, { id: 'gpio', label: 'Gpio' }];
    window.__test.statusGroups = [];
    window.__test.showReboot = true;
    window.renderNav();
  });

  it('collapses section links into the device menu', function () {
    window.__test.setNavMode(true);
    expect(document.getElementById('nav-list').hasAttribute('hidden')).toBe(true);
    var labels = Array.prototype.map.call(
      document.querySelectorAll('#nav-actions a'),
      function (a) { return a.textContent; });
    expect(labels).toEqual(['Wifi', 'Gpio', 'Reboot']);
    expect(document.getElementById('nav-sep').hasAttribute('hidden')).toBe(false);
    expect(document.querySelectorAll('#nav-list a').length).toBe(0);
  });

  it('expands links back to inline', function () {
    window.__test.setNavMode(true);
    window.__test.setNavMode(false);
    expect(document.getElementById('nav-list').hasAttribute('hidden')).toBe(false);
    expect(document.querySelectorAll('#nav-list a').length).toBe(2);
    expect(document.getElementById('nav-reboot')).not.toBeNull();
    expect(document.getElementById('nav-sep').hasAttribute('hidden')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing unit tests**

Run: `npm run test:unit -- tests/unit/app.test.js -t "collapse"`
Expected: FAIL — `window.__test.setNavMode` is not a function.

- [ ] **Step 3: Add helpers to `app.js`**

Add near the Task 1 functions:

```js
var GAP = 10;
var sectionCount = 0;

function moveSectionsToNavList() {
  var node = navActionsList.firstChild;
  while (node && node !== navSep) {
    var nx = node.nextSibling;
    navList.appendChild(node);
    node = nx;
  }
}

function moveSectionsToMenu() {
  var node = navList.firstChild;
  while (node) {
    var nx = node.nextSibling;
    navActionsList.insertBefore(node, navSep);
    node = nx;
  }
}

function applyNavMode(collapsed) {
  navCollapsed = collapsed;
  if (collapsed) moveSectionsToMenu();
  else moveSectionsToNavList();
  var hasReboot = !!document.getElementById('nav-reboot');
  navList.hidden = collapsed;
  if (navActions) navActions.hidden = !(collapsed || hasReboot);
  if (navSep) navSep.hidden = !(collapsed && hasReboot && sectionCount > 0);
}

function updateFit() {
  if (!navActionsList || !navActions || !navSep) return;
  if (!document.documentElement.clientWidth) return; // no layout (jsdom)
  if (navCollapsed) {
    moveSectionsToNavList();
    navList.hidden = false;
  }
  var boundary;
  if (navActions.hidden) {
    var navEl = document.querySelector('header nav');
    if (!navEl) { navList.hidden = false; return; }
    boundary = navEl.getBoundingClientRect().right - GAP;
  } else {
    boundary = navActions.getBoundingClientRect().left - GAP;
  }
  var right = navList.getBoundingClientRect().right;
  var fits = sectionCount === 0 || right <= boundary + 0.5;
  applyNavMode(!fits);
}

function wireNavResize() {
  if (wireNavResize._done) return;
  wireNavResize._done = true;
  var timer = null;
  window.addEventListener('resize', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(updateFit, 150);
  });
  window.addEventListener('load', updateFit);
}
```

- [ ] **Step 4: Wire the new logic into `renderNav()` and refs**

In `renderNav()`:
- At the top, before `navList.innerHTML = '';`, add:

```js
if (navCollapsed) {
  moveSectionsToNavList();
  navList.hidden = false;
  navCollapsed = false;
}
```

- After the link loops and before `syncDeviceMenu();`, set:

```js
sectionCount = navList.children.length;
```

- After `wireNavClick();` add:

```js
wireNavResize();
updateFit();
```

`updateFit()` early-returns in jsdom (`clientWidth === 0`), so the existing jsdom `renderNav` tests keep their wide default; real browsers get measurement.

- [ ] **Step 5: Expose `setNavMode` in the dev guard**

In the `window.__test` block (~line 1054), add:

```js
Object.defineProperty(window.__test, 'setNavMode', { value: function (v) { applyNavMode(!!v); }, enumerable: true, configurable: true });
```

- [ ] **Step 6: Update `index.html` CSS**

In the inline `<style>`, replace the whole `@media (max-width: 600px) { header nav { flex-wrap: wrap; } header nav ul { flex-wrap: wrap; } }` block with:

```css
header nav { justify-content: flex-start; }
#nav-list[hidden] { display: none; }
```

(`#nav-actions[hidden]` and `#nav-sep[hidden]` display rules were added in Task 1.)

- [ ] **Step 7: Run unit tests**

Run: `npm run test:unit`
Expected: PASS (new collapse/expand tests plus all existing).

- [ ] **Step 8: Add e2e responsive-nav tests**

Append to `tests/e2e/app.test.js`:

```js
test.describe('Responsive nav', () => {
  test('sections inline and ☰ holds only Reboot on wide screens', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('#nav-list')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#wifi"]')).toBeVisible()
    await page.locator('#nav-actions summary').click()
    await expect(page.locator('#nav-reboot')).toBeVisible()
    await expect(page.locator('#nav-actions a[href="#wifi"]')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('sections move into the ☰ menu on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('#nav-list')).toBeHidden()
    await page.locator('#nav-actions summary').click()
    await expect(page.locator('#nav-actions a[href="#wifi"]')).toBeVisible()
    await expect(page.locator('#nav-actions a[href="#gpio"]')).toBeVisible()
    await page.locator('#nav-actions a[href="#gpio"]').click()
    await expect(page.locator('details#gpio')).toHaveAttribute('open', '')
    await expect(page.locator('#nav-actions')).not.toHaveAttribute('open', '')
  })

  test('re-expands to inline sections when widened', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto('/')
    await page.waitForSelector('#config-form:not([aria-busy])')
    await expect(page.locator('#nav-list')).toBeHidden()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(500)
    await expect(page.locator('#nav-list')).toBeVisible()
    await expect(page.locator('#nav-list a[href="#wifi"]')).toBeVisible()
  })
})
```

- [ ] **Step 9: Regenerate assets and run e2e**

Run:
```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run build
npm run test:e2e
```
Expected: PASS — including the existing "Reboot button" and "Navigation and hash" groups.

- [ ] **Step 10: Commit**

```bash
git add app.js index.html tests/unit/app.test.js tests/e2e/app.test.js app.min.js
git commit -m "feat: collapse section links into device menu on narrow screens"
```

---

### Task 3: Docs and changelog

Update the docs that would otherwise mislead readers and add the changelog entry. **No version bump**: 0.7.0 has not shipped on master, so the responsive-nav fix rides inside the existing unreleased 0.7.0 release train (see spec). `library.json` stays `0.7.0`; the `v0.7.0` tag is created once at release time, not here.

**Files:**
- Modify: `WS_PROTOCOL.md` (lines 100-102)
- Modify: `docs/audits/2026-09-01-audit-fix-triage.md` (Issue 8 section)
- Modify: `docs/superpowers/specs/2026-07-19-reboot-button-and-v060-release-design.md`
- Modify: `docs/superpowers/specs/2026-09-02-architectural-decisions-design.md`
- Modify: `CHANGELOG.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `WS_PROTOCOL.md`**

Replace lines 100-102:

```markdown
**`_show_reboot`:** Boolean owned by the server. `true` when an `on_reboot`
callback was registered at `prsl_init()`. Adds a "Reboot" action to the header
device menu (the ☰ button) with a confirmation dialog. When no actions exist
and the nav is not collapsed, the ☰ is hidden.
```

- [ ] **Step 2: Add superseded-by status notes**

At the top of the Issue 8 section in `docs/audits/2026-09-01-audit-fix-triage.md` (after the "## Issue 8 (mobile nav) — alternatives to Approach A" heading, line 78), add:

```markdown
> **Status (2026-09-09):** Approach A failed manual testing (ragged 3-line
> stack, 601–845px overflow band, flaky dropdown when wrapped). Superseded by
> `docs/superpowers/specs/2026-09-09-responsive-nav-menu-design.md`.
```

At the top of `docs/superpowers/specs/2026-07-19-reboot-button-and-v060-release-design.md` (after line 4's intro), add:

```markdown
> **UI status (2026-09-09):** the "System" dropdown described here was replaced
> by the always-present ☰ device menu — see
> `2026-09-09-responsive-nav-menu-design.md`. The reboot feature, API, and
> `_show_reboot` semantics are unchanged.
```

In `docs/superpowers/specs/2026-09-02-architectural-decisions-design.md`, find the line in the "Non-architectural fixes" list that reads `Issue 8 (mobile nav, Approach A)` and append:

```markdown
(Approach A later failed manual testing — superseded by
`2026-09-09-responsive-nav-menu-design.md`)
```

- [ ] **Step 3: Add a CHANGELOG entry**

In the EXISTING `## 0.7.0` section of `CHANGELOG.md` (do NOT add a new version heading — 0.7.0 is unreleased and this change belongs to it), add at the top of the bullet list:

```markdown
- Responsive nav: always-present ☰ device menu; section links collapse into it on narrow screens (replaces the flex-wrap layout and the "System" dropdown).
```

- [ ] **Step 4: Full test suite**

Run:
```bash
. ~/.nvm/nvm.sh
export PATH="/config/.nvm/versions/node/v24.17.0/bin:$PATH"
npm test
```
Expected: build, native tests, unit tests, and e2e all PASS.

- [ ] **Step 5: Commit**

```bash
git add WS_PROTOCOL.md docs/audits/2026-09-01-audit-fix-triage.md docs/superpowers/specs/2026-07-19-reboot-button-and-v060-release-design.md docs/superpowers/specs/2026-09-02-architectural-decisions-design.md CHANGELOG.md
git commit -m "docs: responsive nav — update protocol doc, add superseded notes, changelog"
```

---

## Self-review notes

- The old `@media (max-width: 600px)` wrap rules are fully removed in Task 2 (Step 6), closing the 601–845px overflow band — no wrapping, only collapse.
- Section `<li>` nodes are moved, never cloned; jsdom unit tests exercise relocation via `setNavMode`, bypassing `updateFit`'s no-layout guard.
- Task 1 intentionally leaves `#nav-list[hidden]`/flex-start CSS out so the transitional state still renders wide correctly; Task 2 completes the layout.
