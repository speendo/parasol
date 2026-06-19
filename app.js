(function () {
  'use strict';

  var navList = document.getElementById('nav-list');
  var configForm = document.getElementById('config-form');
  var statusBar = document.getElementById('status-bar');
  var footer = document.querySelector('footer');
  var btnSaveApply = document.getElementById('btn-save-apply');
  var btnReset = document.getElementById('btn-reset');

  var baseline = null;
  var components = [];
  var dirty = false;

  function showError(msg) {
    statusBar.textContent = msg;
    statusBar.style.color = 'var(--pico-color-red)';
  }

  function clearError() {
    statusBar.textContent = '';
    statusBar.style.color = '';
  }

  function serialize() {
    var data = {};
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var el = configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        data[comp.id + '.' + field.key] = field.type === 'checkbox' || field.type === 'switch' ? el.checked
          : field.type === 'radio' ? (configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]:checked') || {}).value || null
          : el.value;
      }
    }
    return data;
  }

  function setBaseline() {
    baseline = serialize();
  }

  function getPending() {
    if (!baseline) return {};
    var current = serialize();
    var changes = {};
    for (var key in current) {
      if (current[key] !== baseline[key]) changes[key] = current[key];
    }
    return changes;
  }

  function populateFromComponents(comps) {
    for (var ci = 0; ci < comps.length; ci++) {
      var comp = comps[ci];
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var el = configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        if (field.type === 'checkbox' || field.type === 'switch') {
          el.checked = !!field.opts.value;
        } else if (field.type === 'radio') {
          var radios = configForm.querySelectorAll('[name="' + comp.id + '.' + field.key + '"]');
          for (var ri = 0; ri < radios.length; ri++) {
            radios[ri].checked = field.opts.value !== undefined && String(radios[ri].value) === String(field.opts.value);
          }
        } else {
          el.value = field.opts.value !== undefined ? field.opts.value : '';
        }
      }
    }
  }

  async function refreshComponents() {
    try {
      var res = await fetch('/api/settings');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      dirty = data._dirty === true;
      for (var ci = 0; ci < components.length; ci++) {
        var comp = components[ci];
        var group = data[comp.id];
        if (!group) {
          comp.fields = [];
          continue;
        }
        comp.fields = [];
        for (var fkey in group) {
          var field = group[fkey];
          comp.fields.push({ key: fkey, type: field[0], label: field[1], opts: field[2] });
        }
      }
      clearError();
    } catch (err) {
      showError('Failed to refresh settings: ' + err.message);
    }
  }

  // Drives button states. Two independent conditions:
  //   btnReset:  enabled when there are pending local changes (FV != AV) AND form is valid
  //   btnSaveApply: enabled when server _dirty flag is true AND form is valid
  function updateUI() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    var modified = count > 0;
    var formOk = configForm.checkValidity();
    btnReset.disabled = !(modified && formOk);
    btnSaveApply.disabled = !(dirty && formOk);
  }

  function buildPatch(changes) {
    var data = {};
    for (var name in changes) {
      var dot = name.indexOf('.');
      var compId = name.slice(0, dot);
      var fieldKey = name.slice(dot + 1);
      if (!data[compId]) data[compId] = {};
      for (var ci = 0; ci < components.length; ci++) {
        if (components[ci].id === compId) {
          var fields = components[ci].fields;
          for (var fi = 0; fi < fields.length; fi++) {
            if (fields[fi].key === fieldKey) {
              data[compId][fieldKey] = [fields[fi].type, fields[fi].label, { value: changes[name] }];
              break;
            }
          }
          break;
        }
      }
    }
    return data;
  }

  document.addEventListener('DOMContentLoaded', init);

  async function postJSON(url, data) {
    clearError();
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var text = await res.text();
        throw new Error(text || 'HTTP ' + res.status);
      }
      return true;
    } catch (err) {
      showError('Request failed: ' + err.message);
      return false;
    }
  }

  function syncThen(doPopulate) {
    refreshComponents().then(function () {
      if (doPopulate) populateFromComponents(components);
      setBaseline();
      updateUI();
      clearError();
    });
  }

  function handleSaveApply() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    if (count === 0 && !dirty) return;
    var body = count > 0 ? buildPatch(changes) : buildPatch(serialize());
    postJSON('/api/settings/save', body).then(function (ok) {
      if (ok) syncThen(true);
    });
  }

  function handleReset() {
    clearError();
    syncThen(true);
  }

  function labelFromKey(key) {
    return key
      .replace(/[_-]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  async function loadSettings() {
    try {
      var res = await fetch('/api/settings');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      dirty = data._dirty === true;
      var comps = [];
      for (var key in data) {
        if (key[0] === '_') continue;
        var comp = { id: key, label: labelFromKey(key), fields: [] };
        var group = data[key];
        for (var fkey in group) {
          var field = group[fkey];
          comp.fields.push({ key: fkey, type: field[0], label: field[1], opts: field[2] });
        }
        comps.push(comp);
      }
      components = comps;
      clearError();
      return true;
    } catch (err) {
      showError('Failed to load settings: ' + err.message);
      return false;
    }
  }

  function renderNav() {
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + comp.id;
      a.textContent = comp.label;
      li.appendChild(a);
      navList.appendChild(li);
    }
    navList.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link && link.hash) {
        var el = document.getElementById(link.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    });
  }

  function renderForm() {
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var details = document.createElement('details');
      details.id = comp.id;
      var summary = document.createElement('summary');
      summary.textContent = comp.label;
      details.appendChild(summary);
      if (comp.fields) {
        for (var fi = 0; fi < comp.fields.length; fi++) {
          var fieldEl = createField(comp.id, comp.fields[fi]);
          if (fieldEl) details.appendChild(fieldEl);
        }
      }
      configForm.appendChild(details);
    }
  }

  function handleHash() {
    function openHash() {
      if (location.hash) {
        var el = document.getElementById(location.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
      }
    }
    window.addEventListener('hashchange', openHash);
    openHash();
  }

  function bindChangeListeners() {
    configForm.addEventListener('input', updateUI);
    configForm.addEventListener('change', updateUI);
  }

  function wireButtons() {
    btnSaveApply.addEventListener('click', handleSaveApply);
    btnReset.addEventListener('click', handleReset);
  }

  async function init() {
    if (!configForm || !navList || !statusBar || !footer || !btnSaveApply || !btnReset) return;
    var ok = await loadSettings();
    if (!ok) return;
    renderNav();
    renderForm();
    populateFromComponents(components);
    setBaseline();
    bindChangeListeners();
    wireButtons();
    updateUI();
    handleHash();
  }

  function createField(namePrefix, field) {
    if (!field || typeof field !== 'object' || !field.key) return null;
    var key = field.key;
    var type = field.type;
    var labelText = field.label;
    var opts = field.opts || {};
    var required = opts.attrs && opts.attrs.required;
    var inputTypes = ['text', 'email', 'number', 'password', 'tel', 'url', 'color'];

    if (type === 'checkbox') {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = namePrefix + '.' + key;
      if (opts.value) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText + (required ? '*' : '')));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'switch') {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.name = namePrefix + '.' + key;
      if (opts.value) input.checked = true;
      applyAttrs(input, opts.attrs);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labelText + (required ? '*' : '')));
      if (opts.tooltip) label.setAttribute('data-tooltip', opts.tooltip);
      return label;
    }

    if (type === 'radio') {
      var fieldset = document.createElement('fieldset');
      var legend = document.createElement('legend');
      legend.textContent = labelText + (required ? '*' : '');
      if (opts.tooltip) legend.setAttribute('data-tooltip', opts.tooltip);
      fieldset.appendChild(legend);
      if (opts.options) {
        for (var oi = 0; oi < opts.options.length; oi++) {
          var opt = opts.options[oi];
          var radioLabel = document.createElement('label');
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = namePrefix + '.' + key;
          radio.value = opt[0];
          if (opts.value !== undefined && String(opt[0]) === String(opts.value)) {
            radio.checked = true;
          }
          radioLabel.appendChild(radio);
          radioLabel.appendChild(document.createTextNode(' ' + opt[1]));
          fieldset.appendChild(radioLabel);
        }
      }
      return fieldset;
    }

    var labelEl = document.createElement('label');
    labelEl.textContent = labelText + (required ? '*' : '');
    if (opts.tooltip) labelEl.setAttribute('data-tooltip', opts.tooltip);
    var input;

    if (inputTypes.indexOf(type) !== -1) {
      input = document.createElement('input');
      input.type = type;
      input.name = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.name = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
      var valueDisplay = document.createElement('output');
      valueDisplay.textContent = input.value;
      valueDisplay.style.marginLeft = '0.5em';
      input.addEventListener('input', function () {
        valueDisplay.textContent = input.value;
      });
      labelEl._rangeOutput = valueDisplay;
    } else if (type === 'select') {
      input = document.createElement('select');
      input.name = namePrefix + '.' + key;
      if (opts.options) {
        for (var oi = 0; oi < opts.options.length; oi++) {
          var opt = opts.options[oi];
          var option = document.createElement('option');
          option.value = opt[0];
          option.textContent = opt[1];
          if (opts.value !== undefined && String(opt[0]) === String(opts.value)) {
            option.selected = true;
          }
          input.appendChild(option);
        }
      }
      applyAttrs(input, opts.attrs);
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.name = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
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
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
  }
  /* test-expose */if(window.__TEST_MODE){window.serialize=serialize;window.setBaseline=setBaseline;window.getPending=getPending;window.createField=createField;window.populateFromComponents=populateFromComponents;window.applyAttrs=applyAttrs;window.updateUI=updateUI;window.showError=showError;window.clearError=clearError;window.postJSON=postJSON;window.loadSettings=loadSettings;window.refreshComponents=refreshComponents;window.syncThen=syncThen;window.handleSaveApply=handleSaveApply;window.handleReset=handleReset;window.renderNav=renderNav;window.renderForm=renderForm;window.handleHash=handleHash;window.wireButtons=wireButtons;window.bindChangeListeners=bindChangeListeners;window.init=init;window.buildPatch=buildPatch;window.__test={};Object.defineProperty(window.__test,'components',{get:function(){return components},set:function(v){components=v}});Object.defineProperty(window.__test,'dirty',{get:function(){return dirty},set:function(v){dirty=v}});}
})();
