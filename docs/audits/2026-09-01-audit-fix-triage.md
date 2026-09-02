# parasol Audit Fix Triage

Source: `docs/audits/ciclo piezole audit.md` (reduzent2026 integration, v0.6.3).
Verification of that audit completed 2026-09-01 — see conversation summary in git history.

## Architectural Questions — DEFERRED (discuss later)

These change the library contract, behavior, or dependency graph. No code
changes until decided.

1. **on_set ownership (Issue 10).** Library writes the store after `on_set`
   returns ESP_OK (callback = validation/notification only), or keep
   callback-owned writes and fix docs + example? Affects `prsl_apply_body`,
   API_REFERENCE, `examples/basic/main.c`.

2. **Dirty semantics (Issue 12).** Keep the developer-driven `prsl_set_dirty`
   contract (document the sharp consequence), or auto-set dirty when a WS
   apply actually changes a stored value?

3. **Underscore groups (Issue 13).** Document the `_`-prefix reservation as
   a warning, reject `_`-groups at registration, or render them as hidden
   meta fields?

4. **prsl_get type handling (Issue 11).** Keep string-only (explicitly
   documented), extend `prsl_get` to also return numbers/bools as strings,
   or add typed getters (`prsl_get_int`, etc.)?

5. **Lifecycle teardown (Issue 6).** Add `prsl_stop()`? Semantics: stop the
   server, tear down WS, free the store? Or document the
   `server.end()` + `WiFi.mode(WIFI_OFF)` pattern as supported?

6. **Public header shape (Issue 2).** Keep `prsl_build_settings_payload`
   public (make header self-contained: name struct, forward-declare) or move
   it to a private header and shrink the public API?

7. **Dependency policy (Issue 4).** Switch `library.json` to
   `esp32async/ESPAsyncWebServer`, keep `me-no-dev` + document override, or
   leave and document only? (Issue 5 AsyncTCP guidance follows this choice.)

8. **Distribution of generated assets (Issue 1, extension).** Ship
   pre-generated `prsl_assets.h/c` in the release tarball only, also ship a
   PlatformIO `extra_script` for regeneration, or recommend a documented
   regenerate-on-change flow?

## Non-Architectural Fixes — approved to implement

Fixes that preserve the current contract and API. See `writing-plans`
output for the ordered implementation plan.

- **Compile blockers:** make `prsl.h` self-contained and compilable as C and
  C++ (name `prsl_store_s`, forward-declare, drop `const` from
  `prsl_build_settings_payload`). Verify with gcc/g++.
- **Restore native host C test harness** (`test_prsl_store.c`,
  `test_prsl_json.c`, `freertos_stub.h`) recovered from git history; compile
  as C++ so the const bug can never regress.
- **Issue 14:** fix `/api/settings/save` body handler — accumulate body
  across chunks, parse on final chunk, expect no `"data"` wrapper.
- **Issue 15:** show Reset only while dirty (or always-show config); clear
  dirty after successful reset.
- **Issue 9:** Save button busy/feedback during the POST round-trip.
- **Issue 7:** replace C99 compound literals in docs + example with
  `static const` objects.
- **Issue 8:** mobile top-bar nav — no horizontal overflow. **Approach A
  chosen (flex-wrap vertical stacking):** one CSS rule under 600px lets
  Pico's flex nav wrap — logo on its own line, group links wrap below. Pico
  has no built-in responsive nav collapse; wrapping is pure flex behavior.
  Will be tested manually; if unsuitable, fall back to an alternative below.
- **Doc warnings (Issues 11/12/13):** explicit `prsl_get` string-only note,
  dead-Save-without-dirty note, `_`-prefix reservation warning.
- **Docs:** README version v0.6.0→v0.6.3, PlatformIO setup notes,
  troubleshooting section, CHANGELOG entries for 0.6.1–0.6.3, spec-reference
  note.
- **Verify unassessables:** Issue 4 upstream status, Issue 5 PlatformIO dep
  resolution, Issue 8 mobile viewport, Issue 14a ESPAsyncWebServer chunking.
- **Version bump** to 0.6.4 (patch: bug fixes + docs, no new public API) and
  tag.

## Issue 8 (mobile nav) — alternatives to Approach A

Recorded 2026-09-01. Approach A (flex-wrap stacking) is implemented in the
plan and will be user-tested. If unsuitable, these are the fallbacks:

- **B. Collapse to a dropdown on mobile.** Reuse Pico's `details.dropdown`
  (already used for System/Reboot) to hold all group links under 600px.
  Nicer on phones, but requires JS to relocate the `<a>` elements into a
  `<details>` on resize (CSS can't move content between containers), plus a
  resize handler and keeping hash navigation working. More bytes; invents
  behavior Pico doesn't provide natively.
- **C. User-facing nav setting.** A `nav_style` option in
  `parasol_config.json` → new meta tag → asset regeneration. Overkill for a
  LOW cosmetic issue and adds config/wire surface; noted as YAGNI.

Both B and C are intentionally NOT in the implementation plan unless A fails
manual testing.
