/**
 * ESP32 Modular Configuration UI
 *
 * Loads manifest.json → fetches per-component JSON files → builds
 * nav links and accordion form dynamically. Minify for deployment.
 */
(function () {
  'use strict';

  // DOM references
  const navList = document.getElementById('nav-list');
  const configForm = document.getElementById('config-form');
  const statusBar = document.getElementById('status-bar');

  let components = [];

  function showError(msg) {
    statusBar.textContent = msg;
    statusBar.style.color = 'var(--pico-color-red)';
  }

  function clearError() {
    statusBar.textContent = '';
    statusBar.style.color = '';
  }

  // Bootstrap on DOM ready
  document.addEventListener('DOMContentLoaded', init);

  function renderForm() {
    for (const comp of components) {
      const details = document.createElement('details');
      details.id = comp.id;

      const summary = document.createElement('summary');
      summary.textContent = comp.label;
      details.appendChild(summary);

      if (comp.fields) {
        for (const field of comp.fields) {
          const fieldEl = createField(field);
          if (fieldEl) details.appendChild(fieldEl);
        }
      }

      configForm.appendChild(details);
    }
  }

  function handleHash() {
    function openHash() {
      if (location.hash) {
        const el = document.getElementById(location.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    }
    window.addEventListener('hashchange', openHash);
    openHash();
  }

  async function init() {
    if (!configForm || !navList || !statusBar) return;
    const ok = await loadManifest();
    if (!ok) return;
    await loadComponents();
    renderNav();
    renderForm();
    handleHash();
  }

  async function loadManifest() {
    try {
      const res = await fetch('/manifest.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      components = await res.json();
      clearError();
      return true;
    } catch (err) {
      showError('Failed to load manifest: ' + err.message);
      return false;
    }
  }

  function renderNav() {
    for (const comp of components) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + comp.id;
      a.textContent = comp.label;
      li.appendChild(a);
      navList.appendChild(li);
    }
  }

  async function loadComponents() {
    const results = await Promise.allSettled(
      components.map(async (comp) => {
        const res = await fetch('/' + comp.file);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        comp.fields = await res.json();
      })
    );
    // Filter out failed components, show single warning
    const failed = results.filter((r) => r.status === 'rejected');
    const skipped = [];
    components = components.filter((comp, i) => {
      if (results[i].status === 'fulfilled') return true;
      skipped.push(comp.label);
      return false;
    });
    if (failed.length > 0) {
      showError('Skipped: ' + skipped.join(', '));
    }
  }

  function createField(field) {
    // field = [key, type, label, opts?]
    if (!Array.isArray(field) || field.length < 3) return null;

    const key = field[0];
    const type = field[1];
    const labelText = field[2];
    const opts = field[3] || {};

    // HTML input types that map directly to <input type="...">
    const inputTypes = ['text', 'email', 'number', 'password', 'tel', 'url', 'color'];

    if (type === 'checkbox') {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = key;
      if (opts.default) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'switch') {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.name = key;
      if (opts.default) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'radio') {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = labelText;
      if (opts.tooltip) legend.setAttribute('data-tooltip', opts.tooltip);
      fieldset.appendChild(legend);

      if (opts.options) {
        for (const opt of opts.options) {
          const radioLabel = document.createElement('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = key;
          radio.value = opt[0];
          if (opts.default !== undefined && String(opt[0]) === String(opts.default)) {
            radio.checked = true;
          }
          radioLabel.appendChild(radio);
          radioLabel.appendChild(document.createTextNode(' ' + opt[1]));
          fieldset.appendChild(radioLabel);
        }
      }
      return fieldset;
    }

    const labelEl = document.createElement('label');
    labelEl.textContent = labelText;
    if (opts.tooltip) labelEl.setAttribute('data-tooltip', opts.tooltip);

    let input;

    if (inputTypes.indexOf(type) !== -1) {
      input = document.createElement('input');
      input.type = type;
      input.name = key;
      if (opts.default !== undefined) input.value = opts.default;
      applyAttrs(input, opts.attrs);
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.name = key;
      if (opts.default !== undefined) input.value = opts.default;
      applyAttrs(input, opts.attrs);

      const valueDisplay = document.createElement('output');
      valueDisplay.textContent = input.value;
      valueDisplay.style.marginLeft = '0.5em';
      input.addEventListener('input', function () {
        valueDisplay.textContent = input.value;
      });
      labelEl._rangeOutput = valueDisplay;
    } else if (type === 'select') {
      input = document.createElement('select');
      input.name = key;
      if (opts.options) {
        for (const opt of opts.options) {
          const option = document.createElement('option');
          option.value = opt[0];
          option.textContent = opt[1];
          if (opts.default !== undefined && String(opt[0]) === String(opts.default)) {
            option.selected = true;
          }
          input.appendChild(option);
        }
      }
      applyAttrs(input, opts.attrs);
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.name = key;
      if (opts.default !== undefined) input.value = opts.default;
      applyAttrs(input, opts.attrs);
    } else {
      return null;
    }

    labelEl.appendChild(input);
    if (labelEl._rangeOutput) {
      labelEl.appendChild(labelEl._rangeOutput);
    }
    return labelEl;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
  }
})();
