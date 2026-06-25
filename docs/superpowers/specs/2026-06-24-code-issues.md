# Code Issues Found During Doc Tidy — 2026-06-24

## 1. Duplicate `populateFromComponents(statusComponents)` call

**File:** `app.js:280-282`

```js
renderForm();
populateFromComponents(statusComponents);       // line 280
populateFromComponents();                        // line 281
if (statusComponents.length > 0) populateFromComponents(statusComponents);  // line 282
```

Line 280 already populates status fields. Line 282 does the same thing redundantly. The `if` guard on 282 also always passes since `statusComponents.length > 0` is guaranteed by being inside the first-run branch (where statusComponents was just built from `processStatus` data).

**Fix:** Remove line 282.

---

## 2. Inconsistent indentation in `processStatus`

**File:** `app.js:281-283`

Lines 281-283 use 4-space indent while the enclosing `if` body on lines 279-280 and 284 uses 8-space indent. The code is functionally inside the `if` block but the indentation misleadingly suggests lines 281-283 are at the same level as the `if` itself.

**Fix:** Re-indent lines 281-283 to match the surrounding block.

---

## 3. `aria-invalid` not set on form fields after validation

**File:** `app.js:684` (resolved in 2026-06-25)

```js
// Before (fixed on 2026-06-25):
if (!el.checkValidity()) { var d = el.closest('details'); if (d) d.open = true; updateUI(); return; }

// Fixed:
var valid = el.checkValidity();
el.setAttribute('aria-invalid', valid ? 'false' : 'true');
if (!valid) { var d = el.closest('details'); if (d) d.open = true; updateUI(); return; }
```

PicoCSS validation styling uses `aria-invalid` attributes (`"true"` for red,
`"false"` for green), not just the native `:invalid` pseudo-class. The blur
handler now sets `aria-invalid` after each `checkValidity()` call, and
`renderForm()` initializes all fields to `aria-invalid="false"`.
`reportValidity()` is intentionally NOT called to avoid browser-native
validation pop-ups.

---

## 4. Status processing modifies settings baseline

**File:** `app.js:283`

```js
setBaseline();
```

In `processStatus()` first-run branch, after re-rendering the form (which includes both status AND settings fields), `setBaseline()` captures the baseline for the settings `components` array. This is correct behavior (re-establish after re-render) but is triggered by a status event — status changes shouldn't need to touch settings baseline at all. A future optimization would be to render status fields without destroying settings DOM elements.

---

## 5. `_dirty` position in WS message doesn't match spec

**File:** `test_server/main.py:187`

```python
await ws.send_json({"type": "settings", "_dirty": ..., "data": build_settings()})
```

The spec says `_dirty` appears before `type` and `data`. Here it appears after `type`. JSON key order doesn't affect parsing, so this is a documentation nit only. But the spec should match reality.
