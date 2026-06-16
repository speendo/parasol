# Form Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side form validation using HTML5 constraint validation API, with Pico CSS visuals, native validation messages on blur, and button gating.

**Architecture:** Validation rules are declared via `attrs` in component JSON files. Pico CSS auto-styles `:invalid` fields. A blur listener calls `el.reportValidity()` to show native HTML5 tooltips. The `updateUI()` function gates buttons on both pending changes and form validity.

**Tech Stack:** Vanilla JS, Pico CSS, HTML5 Constraint Validation API

---

### Task 1: Gate buttons on form validity

**Files:**
- Modify: `app.js` — `updateUI()` function

- [ ] **Step 1: Extend `updateUI()` to check form validity**

Change the button enable/disable logic to also require `configForm.checkValidity()`. Use chained assignment to save bytes. Keep `pending` for the footer toggle and pending count so user still sees feedback when form is invalid.

Current:
```js
function updateUI() {
    const changes = getPending();
    const count = Object.keys(changes).length;
    const pending = count > 0;
    btnSaveApply.disabled = !pending;
    btnApply.disabled = !pending;
    btnReset.disabled = !pending;
    footer.classList.toggle('pending', pending);
    pendingCount.textContent = pending ? count + ' pending' : '';
}
```

Replace the three button lines and add the validity check:
```js
function updateUI() {
    const changes = getPending();
    const count = Object.keys(changes).length;
    const pending = count > 0;
    const ok = pending && configForm.checkValidity();
    btnSaveApply.disabled = btnApply.disabled = btnReset.disabled = !ok;
    footer.classList.toggle('pending', pending);
    pendingCount.textContent = pending ? count + ' pending' : '';
}
```

- [ ] **Step 2: Test manually**

Open `index.html` in a browser. Add `"required": true` to any field's attrs in a component JSON (e.g., `components/wifi.json` — add to the ssid field: `{"attrs": {"maxlength": 32, "required": true}}`). Verify:
- The SSID field shows red styling via Pico CSS
- Buttons are disabled even when a pending change exists
- Clearing the required field value and tabbing away shows validation message (blur listener comes in Task 2)
- Buttons re-enable once form is valid with pending changes

Remove the test `required` attr after verifying.

- [ ] **Step 3: Rebuild and commit**

```bash
npm run build
git add app.js app.min.js
git commit -m "feat: gate action buttons on form validity"
```

---

### Task 2: Add validation messages on blur

**Files:**
- Modify: `app.js` — `createField()` function, 4 locations (checkbox/switch, radio, shared input path)

- [ ] **Step 1: Add blur listener to each input type**

Add `input.onblur=input.reportValidity` at these locations in `createField()`:

**Checkbox branch** (~line 293, after `applyAttrs(input, opts.attrs)`):
```js
      applyAttrs(input, opts.attrs);
      input.onblur=input.reportValidity;
      label.appendChild(input);
```

**Switch branch** (~line 306, after `applyAttrs(input, opts.attrs)`):
```js
      applyAttrs(input, opts.attrs);
      input.onblur=input.reportValidity;
      label.appendChild(input);
```

**Radio branch** (~line 327, after `radio.checked` assignment):
```js
          if (opts.default !== undefined && String(opt[0]) === String(opts.default)) {
            radio.checked = true;
          }
          radio.onblur=radio.reportValidity;
          radioLabel.appendChild(radio);
```

**Shared input path** (after the if/else chain for inputTypes/range/select/textarea, before `labelEl.appendChild(input)` — ~line 384):
```js
      input.onblur=input.reportValidity;
    }

    labelEl.appendChild(input);
```

- [ ] **Step 2: Test manually**

Open `index.html` with a component JSON that has `"required": true` on a field. Tab into the field and out without entering a value. Verify the native HTML5 validation tooltip appears ("Please fill out this field").

- [ ] **Step 3: Rebuild and commit**

```bash
npm run build
git add app.js app.min.js
git commit -m "feat: show native validation tooltips on blur"
```
