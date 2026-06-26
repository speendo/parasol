# Checkbox Three-State + Helper Text CSS

## Motivation

The `checkbox` field type was originally removed in favor of `switch` (both
represented the same boolean value). Unlike `switch`, a plain checkbox supports
the **indeterminate** state — a visual "not yet set" state that is neither
checked nor unchecked. For settings where the user must explicitly choose (no
safe default), the indeterminate checkbox signals that the field requires
attention.

PicoCSS v2.1.1 styles `<small>` globally (`display: block; color:
var(--pico-muted-color); margin-top: calc(var(--pico-spacing) * -0.75)`).
This works well when `<small>` sits as a direct sibling after a block-level
`<input>`, `<select>`, or `<textarea>` (the documented helper text pattern).
Inside our `<div>` wrappers, the `<small>` follows an inline `<label>`
(checkbox/switch) or `<fieldset>` (radio) — neither of which is a block
input — and the negative `margin-top` pulls the helper text up awkwardly. A
targeted CSS rule removes the negative margin for these element types.

## Wire format

| State | Wire value | HTML state |
|---|---|---|
| Checked | `true` | `checked`, `indeterminate=false` |
| Unchecked | `false` | `checked=false`, `indeterminate=false` |
| Unset | `null` | `checked=false`, `indeterminate=true` |

`null` is distinct from `false` and `true` on the wire. The state machine
comparisons (`String(serverVal) === String(lastSent[key])`) already
distinguish them: `String(null)` = `"null"`, `String(true)` = `"true"`,
`String(false)` = `"false"`.

## DOM structure (createField)

The `checkbox` type uses the same structure as `switch` but without
`role="switch"`:

```html
<div>
  <input type="checkbox" name="prefix.key" id="prefix.key">
  <label for="prefix.key"> Label*</label>
  <small id="prefix.key-helper">helper text</small>
</div>
```

**On populate (null):** `el.checked = false; el.indeterminate = true`
**On populate (true/false):** `el.checked = !!value; el.indeterminate = false`
**On serialize:** `el.indeterminate ? null : el.checked`

## Changes per function

### createField
- Add `type === 'checkbox'` branch alongside the existing `type === 'switch'`
  branch, but omit `input.role = 'switch'`.

### serialize (currently matches `switch` only)
- Add `type === 'checkbox'` alongside the existing `type === 'switch'` check
  in the ternary, returning `el.indeterminate ? null : el.checked`

### populateFromComponents (currently matches `switch` only)
- Add `type === 'checkbox'` alongside the existing `type === 'switch'` check
- When `fopts.value` is `null`: set `el.checked = false` and
  `el.indeterminate = true`
- When truthy/falsy: set `el.checked = !!fopts.value` and
  `el.indeterminate = false`

### readFormValue
- Currently returns `el.checked` for checkbox — change to
  `el.indeterminate ? null : el.checked`

### bindChangeListeners
- The handler closure currently captures only `el` and `key`, and reads
  value with a direct `el.checked` for all checkbox-type elements. Change
  the value read to use `readFormValue` instead, so indeterminate checkboxes
  produce `null`.
- `readFormValue` is safe for both switch and checkbox: switches are never
  set to indeterminate, so `el.indeterminate ? null : el.checked` always
  returns `el.checked` for switches.

### Validation handler
- Add a custom check after `el.checkValidity()`: if `el.indeterminate` and
  `el.required`, treat as invalid (`aria-invalid="true"`, block send). No
  need to check the logical field type — our code never sets indeterminate
  on a switch, so this check is a no-op for switches and fires only for
  checkboxes. Native `el.checkValidity()` does not flag indeterminate as
  invalid.

## CSS rule (index.html)

Add to the existing `<style>` block in `index.html`:

```css
input[type="checkbox"] + label + small,
fieldset + small {
  display: block;
  color: var(--pico-muted-color);
  margin-bottom: var(--pico-spacing);
}
```

PicoCSS's global `small` rule includes a negative `margin-top` designed for
the `<input> → <small>` helper text pattern. For checkbox/switch the
`<small>` follows an inline `<label>`, so the negative margin doesn't apply
cleanly — this rule adds bottom spacing via `margin-bottom` to separate the
helper text from the next field. Radio helper text uses `<fieldset>` which is
block-like enough that PicoCSS's default negative margin works correctly.

## Validation

| Scenario | `aria-invalid` | Blocks save/apply |
|---|---|---|
| Not required, indeterminate | `"false"` | No |
| Not required, checked | `"false"` | No |
| Not required, unchecked | `"false"` | No |
| Required, indeterminate | `"true"` (custom check) | Yes |
| Required, checked | `"false"` | No |
| Required, unchecked | `"true"` (native) | Yes |

## Docs update

Add `checkbox` row to the supported types table in
`docs/reference/field-format.md`:

```diff
+| `checkbox` | `<input type="checkbox">` | yes | settings, status |
```

Add a note under "value Coercion":

```diff
+| `checkbox` | boolean or null (`el.indeterminate ? null : el.checked`) |
```
