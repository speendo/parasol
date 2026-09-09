# parasol — Responsive Nav: Always-present Device Menu + Collapsible Section Links

Date: 2026-09-09
Status: draft (pending review)

Source: `docs/audits/2026-09-01-audit-fix-triage.md` **Issue 8 (mobile nav)**.
Approach A (flex-wrap under 600px) shipped in the audit-fixes branch and was
user-tested 2026-09-09; it failed manual testing. This spec records the
replacement design and supersedes Approach A.

## Problem

On narrow viewports the top bar is broken:

- **Approach A stacked into 3 ragged lines:** title/logo, the section links
  (still one wide horizontal row), then the System/Reboot `<li>` orphaned on
  its own line because flex-wrap only spills flex items to new lines — it never
  collapses content.
- **Horizontal overflow in the 601–~845px band.** The media query only engages
  at ≤600px, but the section row's natural width is ~846px, so any viewport
  between 600 and ~845 clips.
- **System dropdown is unreliable when wrapped.** Pico `details.dropdown` is
  designed for a single-line nav; once its `<li>` lands on its own flex line
  the popup anchors wrongly and toggling becomes flaky.
- **Duplicate "System".** A `system` status *section* link and the reboot
  *actions* dropdown are both labeled "System", compounding the confusion.

Underlying cause: a config-driven, flat list of section `<a>`s is rendered as a
horizontal row. Pure CSS can wrap that row; it cannot replace it with a compact
control.

## Decisions

### D1 — Inverted model: an always-present ☰ "device" menu

There is always exactly one hamburger menu (`details.dropdown`) at the far
right of the header. It is the **permanent home of device actions** (today:
Reboot). Section links are shown inline next to the title on wide screens and
are **absorbed into the same ☰** when there isn't room:

| Width | Header contents |
|-------|-----------------|
| Wide | `logo+title` · inline section links · `☰` (device actions) |
| Narrow | `logo+title` · `☰` (section links, divider, device actions) |

Why this over the alternative ("keep a separate text 'Device ▾' dropdown on
wide, flatten into the menu when collapsed"): actions keep **one** permanent
DOM shape across widths — no converting between a dropdown wrapper and flat
rows. The only elements that relocate are the homogeneous section `<li><a>`s.

**☰ visibility rule.** The ☰ is rendered only when it has a job to do:
- wide AND a device action exists → ☰ shows the action(s);
- collapsed → ☰ always shows (it holds the section links);
- wide AND no device actions (`showReboot` false, no future actions) → the ☰
  is hidden and only inline section links render.

Equivalently: the ☰ is visible when `showActions || collapsed`. Devices without
`on_reboot` see an ordinary inline nav on wide screens and a sections-only menu
when narrow.

### D2 — Remove the separate "System ▾" actions dropdown

The standalone reboot dropdown (`#nav-system`) is deleted from wide layouts;
Reboot lives inside the ☰ at both widths. This removes the duplicate-"System"
problem and the wide-only dropdown shape. Section links still include the
`system` *status section* if the device exposes one — unchanged.

### D3 — Measure-based collapse (no fixed px breakpoint)

Collapse is decided by geometry, not a `max-width` guess, because the section
list is config-driven and its natural width varies per device.

- Compute the space available for inline sections = header inner width minus
  (logo/title block + ☰ control + spacing).
- Compute the natural width of the inline section list.
- Collapsed ⟺ sections do not fit in the available space.
- **Inline sections never wrap.** The Approach A `@media (max-width:600px)`
  flex-wrap rules are removed; overflow now resolves to collapse, never wrap,
  so there are exactly two crisp modes and no 601–845px overflow band.
- Recompute on: initial render, each `renderNav()`, window `resize` /
  orientation change, and `load` (fonts). Debounced.

Design constraint for the implementation: the natural width of the section
links must be measurable even while collapsed (menu contents are hidden when
closed). Do not read layout from `display:none` subtrees — use a transient
offscreen/visibility-hidden measure if needed. No flicker: never visibly move
links just to measure.

### D4 — Reboot is distinguished, not a plain link

Reboot is a destructive device action. Inside the ☰ it is separated from
section links (divider) and styled as a **danger** row (red, consistent with
`--pico-color-red` used by the status bar). On wide screens the ☰ holds only
the action, so there is no ambiguity about what the ☰ contains. A confirmation
modal already guards accidental reboots (`#reboot-dialog`) — unchanged.

### D5 — Trigger: ☰ glyph with accessible name

The trigger is the ☰ glyph (U+2630) with an accessible name for screen readers
(visually-hidden text and/or `aria-label`/`title`, e.g. "Menu"). No icon font,
no image assets. Pico `details.dropdown` styling is reused; cosmetic overrides
(larger touch target, centered glyph) go in the inline `<style>`.

### D6 — Menu ordering and interaction

Collapsed ☰ lists, top to bottom: section links (status groups first, then
setting groups — same order as inline today), a divider, then the danger-styled
Reboot row at the bottom.

- Clicking a section link scrolls to its accordion section (existing behaviour)
  **and closes the menu**.
- Clicking Reboot closes the menu and opens `#reboot-dialog` (existing flow).
- `details`/`summary` give open/close and keyboard behaviour natively; links
  remain focusable while open. No new JS state machine.

### D7 — CSS lives in `index.html` only

All overrides go in the existing inline `<style>` in `index.html`.
**`pico.jade.min.css` is not modified.** Pico's flex `nav` layout is left
intact where possible; the header's own flex children are spaced via the
inline `<style>` (e.g. the ☰ pushed to the far right) rather than relying on
Pico defaults for a 3-child nav.

## Header DOM shape (target)

```html
<header class="container-fluid">
  <nav>
    <ul>                  <!-- logo + title (unchanged) -->
      <li>…img…<h1>…</h1></li>
    </ul>
    <ul id="nav-list">    <!-- section links only; hidden/moved when collapsed -->
      <!-- JS: status + setting group links -->
    </ul>
    <details class="dropdown" id="nav-actions">   <!-- always present -->
      <summary aria-label="Menu" title="Menu">☰</summary>
      <ul dir="rtl">
        <!-- JS: device actions; + section links when collapsed -->
      </ul>
    </details>
  </nav>
</header>
```

`#nav-actions` is added statically to `index.html` (like the reboot dialog) and
its contents are populated by JS. Section-link `<li>` elements are the **same
DOM nodes** relocated between `#nav-list` and `#nav-actions ul` (move, never
clone) so anchors, order, and any attached state stay consistent.

## JS behaviour

- `renderNav()` (app.js:666) no longer appends the `#nav-system` dropdown.
  It appends section links to `#nav-list`, then populates `#nav-actions` with
  the Reboot row (when `showReboot`) as a `<li><a id="nav-reboot">`.
- A new collapse routine runs after every `renderNav()` and on resize/load:
  - decides `collapsed` per D3;
  - when `collapsed`, moves section `<li>`s from `#nav-list` into
    `#nav-actions ul` (before the divider/actions) and hides `#nav-list`;
  - when not collapsed, moves them back and shows `#nav-list`.
- The header click delegation that opens a target `<details>` section from an
  anchor hash is broadened to also close `#nav-actions` after navigating.
- Rebooting, dialog wiring, and `showReboot` logic are unchanged.

Bytes: target a small net increase. The added JS is one measure function, one
relocate function, one debounced resize/load listener, plus removal of the
`#nav-system` builder. Prefer `function`, no arrows, no deps (AGENTS.md).

## Accessibility

- ☰ summary has an accessible name ("Menu").
- Focus order: collapsed menu links are reachable once the menu is open;
  standard `details` behaviour applies.
- Reboot row conveys "action, destructive" via its separated/danger styling and
  existing confirmation dialog; it is not presented as a navigation link.

## Testing

Unit (jsdom, `tests/unit/app.test.js`):
- `renderNav()` builds section links and the Reboot row inside `#nav-actions`;
  **no** `#nav-system` element is created.
- Collapse routine relocates nodes correctly in both directions given a forced
  collapsed/wide decision (jsdom cannot lay out, so the measure itself is
  injected/stubbed; assert the DOM move, divider order, and Reboot separation).
- Existing `renderNav` reboot-dropdown tests (unit lines ~1002) are rewritten
  for the new structure.

E2E (`tests/e2e/app.test.js`):
- Existing "Reboot button" group is updated from `#nav-system summary` to the
  new `#nav-actions` trigger.
- New: at a narrow viewport the ☰ contains the section links and Reboot; at a
  wide viewport sections render inline and the ☰ contains only Reboot.
- New: narrow-viewport navigation via the menu still opens the target section.

The test server currently runs the demo schema; e2e may set an explicit
viewport width to force each mode deterministically.

## Docs and release

- `WS_PROTOCOL.md:101` describes the "System" dropdown — update to the ☰ device
  menu. Historical specs (`2026-07-19-reboot-button-and-v060-release-design.md`,
  backlog triage) are left as history but should not be cited as current UI.
- `CHANGELOG.md`: entry added under the existing unreleased **0.7.0** section
  (0.7.0 has not shipped on master; the responsive-nav fix rides in the 0.7.0
  release train rather than as a separate 0.8.0/0.7.1). `library.json` stays
  `0.7.0`; the `v0.7.0` tag is created once at release.
- `app.min.js` must be regenerated (`npm run build`) and committed; `npm test`
  (unit + e2e) must pass.

## Out of scope

- Firmware upload / additional device actions (future rows drop into
  `#nav-actions` when they land — this design anticipates them, nothing more).
- Renaming the `system` status group or any wire/API surface.
- Visual redesign beyond the header bar.
- Re-evaluating the "System" *section* label.
