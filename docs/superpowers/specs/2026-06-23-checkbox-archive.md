# Checkbox Type — Revival

The `checkbox` field type was originally removed in favor of `switch` (the
Pico-CSS-native boolean toggle). Both represented the same boolean value, so
keeping both was redundant.

The old implementation is preserved in the `checkpoint/checkbox` branch.

## Revival rationale

`checkbox` has a third state that `switch` lacks: **indeterminate** (the
[MDN docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#indeterminate_state)
call it "a state that is neither checked nor unchecked"). A switch is always either on or off — there is no visual "not yet set"
state. For settings where the user must explicitly choose (e.g., "enable
feature X" with no safe default), the indeterminate checkbox signals that the
field requires attention.

The revived `checkbox` field type uses the HTML
`<input type="checkbox">` element (no `role="switch"`) and supports three wire
values: `true`, `false`, and `null` (indeterminate).

## Wire format

| State | Wire value | HTML state |
|---|---|---|
| Checked | `true` | `checked`, `indeterminate=false` |
| Unchecked | `false` | `checked=false`, `indeterminate=false` |
| Indeterminate/unset | `null` | `checked=false`, `indeterminate=true` |

## Validation

`indeterminate` is purely a visual state — it does not make the checkbox
natively invalid. Whether `null` (indeterminate) blocks form submission
follows the same `required` rule as other fields: if `required`, an
indeterminate checkbox fails validation; if not `required`, it submits as
`null`.

