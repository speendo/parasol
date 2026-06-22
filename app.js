(function () {
  'use strict';

  var navList = document.getElementById('nav-list');
  var configForm = document.getElementById('config-form');
  var statusBar = document.getElementById('status-bar');
  var footer = document.querySelector('footer');
  var btnSaveApply = document.getElementById('btn-save-apply');

  var baseline = null;
  var components = [];
  var dirty = false;
  var ws = null;
  var lastSent = {};
  var inFlight = {};
  var wsReconnectTimer = null;
  var wsRetries = 0;

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
    if (!comps) comps = components;
    for (var ci = 0; ci < comps.length; ci++) {
      var comp = comps[ci];
      if (!comp.fields) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var el = configForm.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        var fopts = field.opts || {};
        if (field.type === 'checkbox' || field.type === 'switch') {
          el.checked = !!fopts.value;
        } else if (field.type === 'radio') {
          var radios = configForm.querySelectorAll('[name="' + comp.id + '.' + field.key + '"]');
          for (var ri = 0; ri < radios.length; ri++) {
            radios[ri].checked = fopts.value !== undefined && String(radios[ri].value) === String(fopts.value);
          }
        } else {
          el.value = fopts.value !== undefined ? fopts.value : '';
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

  function updateUI() {
    var formOk = configForm.checkValidity();
    var showBtn = dirty && formOk;
    btnSaveApply.hidden = !showBtn;
    btnSaveApply.disabled = !showBtn;
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

  function connectWS() {
    configForm.setAttribute('aria-busy', 'true');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/api/settings/ws');
    ws.onopen = function () {};
    ws.onmessage = onWSMessage;
    ws.onclose = onWSClose;
    ws.onerror = function () { if (ws) ws.close(); };
  }

  function disconnectWS() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  function onWSClose() {
    ws = null;
    configForm.setAttribute('aria-busy', 'true');
    wsRetries++;
    if (wsRetries >= 5) {
      showError('Cannot connect to device');
      var retryBtn = document.getElementById('btn-ws-retry') || createRetryButton();
      retryBtn.hidden = false;
      return;
    }
    var delay = Math.min(1000 * Math.pow(2, wsRetries), 15000);
    showError('Connection lost. Retrying in ' + (delay / 1000) + 's\u2026');
    wsReconnectTimer = setTimeout(connectWS, delay);
  }

  function createRetryButton() {
    var btn = document.createElement('button');
    btn.id = 'btn-ws-retry';
    btn.className = 'secondary';
    btn.textContent = 'Retry';
    btn.addEventListener('click', function () {
      btn.hidden = true;
      wsRetries = 0;
      connectWS();
    });
    document.getElementById('status-bar').after(btn);
    return btn;
  }

  function processSettings(data, dirtyFlag) {
    dirty = dirtyFlag === true;
    var comps = [];
    for (var key in data) {
      if (key[0] === '_') continue;
      var group = data[key];
      var fields = [];
      for (var fieldKey in group) {
        var arr = group[fieldKey];
        fields.push({key: fieldKey, type: arr[0], label: arr[1], opts: arr[2]});
      }
      comps.push({id: key, label: labelFromKey(key), fields: fields});
    }
    components = comps;
    renderNav();
    renderForm();
    bindChangeListeners();
    populateFromComponents();
    setBaseline();
    configForm.removeAttribute('aria-busy');
    clearError();
    updateUI();
    handleHash();
  }

  function onWSMessage(event) {
    var msg = JSON.parse(event.data);
    if (msg.type === 'error') { showError(msg.message); return; }
    if (msg.type !== 'settings' && msg._dirty === undefined) return;
    wsRetries = 0;

    var dirtyFlag = msg._dirty;
    var data = msg.data || msg;
    dirty = dirtyFlag;

    // ── Echo resolution ──
    var echoMatched = false;
    for (var key in inFlight) {
      if (!inFlight[key]) continue;
      var parts = key.split('.');
      var serverVal = resolveNested(data, parts);
      if (serverVal !== undefined && serverVal instanceof Array && serverVal.length >= 3) {
        serverVal = serverVal[2] && serverVal[2].value;
      }
      if (serverVal !== undefined && String(serverVal) === String(lastSent[key])) {
        inFlight[key] = false;
        echoMatched = true;
      }
    }

    if (echoMatched) {
      var queuedKeys = [];
      for (var key in inFlight) {
        if (inFlight[key]) continue;
        var parts = key.split('.');
        var fv = readFormValue(parts);
        if (fv !== undefined && String(fv) !== String(lastSent[key])) {
          queuedKeys.push({key: key, value: fv});
        }
      }
      if (queuedKeys.length > 0) {
        for (var qi = 0; qi < queuedKeys.length; qi++) {
          sendToServer(queuedKeys[qi].key, queuedKeys[qi].value);
        }
        updateAV(data);
        applyAV();
        return;
      }
      updateAV(data);
      applyAV();
      return;
    }

    var hasInFlight = false;
    for (var k in inFlight) { if (inFlight[k]) { hasInFlight = true; break; } }
    if (hasInFlight) return;

    // Initial load — no components yet, process settings directly
    if (components.length === 0) {
      processSettings(data, dirtyFlag);
      return;
    }

    var changedFields = {};
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var sGroup = data[comp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var sField = sGroup[field.key];
        if (!sField) continue;
        var newAV = sField[2].value;
        var oldAV = field.opts.value;
        if (String(newAV) === String(oldAV)) continue;
        var el = document.querySelector('[name="' + comp.id + '.' + field.key + '"]');
        if (!el) continue;
        var fv = (el.type === 'checkbox') ? el.checked :
                 (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
        changedFields[comp.id + '.' + field.key] = {newAV: newAV, oldAV: oldAV, fv: fv, label: field.label};
      }
    }

    if (Object.keys(changedFields).length === 0) return;

    updateAV(data);

    var conflicts = [];
    var externalFields = [];
    for (var key in changedFields) {
      var cf = changedFields[key];
      if (String(cf.fv) === String(cf.oldAV)) {
        externalFields.push({key: key, label: cf.label, newValue: cf.newAV});
      } else if (String(cf.fv) !== String(cf.newAV)) {
        conflicts.push({key: key, label: cf.label, localValue: cf.fv, serverValue: cf.newAV});
      }
    }

    if (conflicts.length > 0) {
      showConflictPrompt(conflicts);
    } else if (externalFields.length > 0) {
      showExternalNotification(externalFields);
    } else {
      applyAV();
      syncLS();
    }
  }

  function updateAV(data) {
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var sGroup = data[comp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < comp.fields.length; fi++) {
        var field = comp.fields[fi];
        var sField = sGroup[field.key];
        if (!sField) continue;
        field.opts.value = sField[2].value;
      }
    }
  }

  function applyAV() {
    populateFromComponents();
    setBaseline();
    updateUI();
  }

  function syncLS() {
    for (var ci = 0; ci < components.length; ci++) {
      for (var fi = 0; fi < components[ci].fields.length; fi++) {
        var key = components[ci].id + '.' + components[ci].fields[fi].key;
        lastSent[key] = components[ci].fields[fi].opts.value;
      }
    }
  }

  function sendToServer(key, value) {
    if (!ws || ws.readyState !== 1) return;
    lastSent[key] = value;
    inFlight[key] = true;
    var parts = key.split('.');
    var compId = parts[0];
    var fieldKey = parts[1];
    var patch = {};
    for (var ci = 0; ci < components.length; ci++) {
      if (components[ci].id !== compId) continue;
      for (var fi = 0; fi < components[ci].fields.length; fi++) {
        if (components[ci].fields[fi].key !== fieldKey) continue;
        patch[compId] = {};
        patch[compId][fieldKey] = [components[ci].fields[fi].type, components[ci].fields[fi].label, { value: value }];
        break;
      }
      break;
    }
    ws.send(JSON.stringify({action: 'apply', data: patch}));
  }

  function onUserInput(key, newValue) {
    if (inFlight[key]) { console.log('onUserInput SKIP inFlight', key, newValue); return; }
    var ls = lastSent[key];
    if (JSON.stringify(newValue) === JSON.stringify(ls)) { console.log('onUserInput SKIP same', key, newValue, ls); return; }
    console.log('onUserInput SEND', key, newValue);
    sendToServer(key, newValue);
  }

  function resolveNested(obj, parts) {
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function readFormValue(parts) {
    var el = document.querySelector('[name="' + parts.join('.') + '"]');
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  }

  function showExternalNotification(fields) {
    var bar = document.getElementById('server-changed');
    var text = document.getElementById('notif-text');
    text.textContent = 'Server settings changed: ' + fields.map(function (f) { return f.label; }).join(', ');
    document.getElementById('notif-load').hidden = false;
    document.getElementById('notif-keep').hidden = false;
    document.getElementById('notif-keep-local').hidden = true;
    document.getElementById('notif-accept-server').hidden = true;
    bar.hidden = false;
  }

  function showConflictPrompt(conflicts) {
    var bar = document.getElementById('server-changed');
    var text = document.getElementById('notif-text');
    text.textContent = 'Conflict: ' + conflicts.map(function (f) { return f.label; }).join(', ');
    document.getElementById('notif-load').hidden = true;
    document.getElementById('notif-keep').hidden = true;
    document.getElementById('notif-keep-local').hidden = false;
    document.getElementById('notif-accept-server').hidden = false;
    bar.hidden = false;
    footer.classList.add('pending');
  }

  function hideNotification() {
    document.getElementById('server-changed').hidden = true;
    footer.classList.remove('pending');
  }

  function syncThen() {
    clearError();
    dirty = false;
    setBaseline();
    updateUI();
  }

  function handleSaveApply() {
    var changes = getPending();
    var count = 0;
    for (var k in changes) count++;
    if (count === 0 && !dirty) return;
    var body = count > 0 ? buildPatch(changes) : buildPatch(serialize());
    postJSON('/api/settings/save', body).then(function (ok) {
      if (ok) syncThen();
    });
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
    navList.innerHTML = '';
    for (var ci = 0; ci < components.length; ci++) {
      var comp = components[ci];
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + comp.id;
      a.textContent = comp.label;
      li.appendChild(a);
      navList.appendChild(li);
    }
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

  function renderForm() {
    configForm.innerHTML = '';
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
    var els = configForm.querySelectorAll('input, select, textarea');
    for (var ei = 0; ei < els.length; ei++) {
      var el = els[ei];
      var key = el.name;
      if (!key) continue;
      (function (el, key) {
        var handler = function () {
          if (!el.checkValidity()) { updateUI(); return; }
          var val = (el.type === 'checkbox') ? el.checked :
                    (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
          console.log('handler firing', el.type, el.name, el.value, 'checked:', el.checked, 'key:', key, 'val:', val);
          onUserInput(key, val);
          updateUI();
        };
        if (el.type === 'text' || el.type === 'password' || el.type === 'email' ||
            el.type === 'tel' || el.type === 'url' || el.type === 'textarea') {
          el.addEventListener('blur', handler);
        } else if (el.type === 'radio') {
          el.addEventListener('click', handler);
        } else {
          el.addEventListener('change', handler);
        }
        el.addEventListener('input', function () { updateUI(); });
      })(el, key);
    }
  }

  function wireButtons() {
    btnSaveApply.addEventListener('click', handleSaveApply);
    document.getElementById('notif-load').addEventListener('click', function () {
      hideNotification();
      applyAV();
      syncLS();
    });
    document.getElementById('notif-keep').addEventListener('click', function () {
      hideNotification();
      for (var ci = 0; ci < components.length; ci++) {
        var comp = components[ci];
        for (var fi = 0; fi < comp.fields.length; fi++) {
          var field = comp.fields[fi];
          var el = document.querySelector('[name="' + comp.id + '.' + field.key + '"]');
          if (!el) continue;
          var fv = (el.type === 'checkbox') ? el.checked :
                   (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
          field.opts.value = fv;
        }
      }
      syncLS();
      setBaseline();
      updateUI();
    });
    document.getElementById('notif-keep-local').addEventListener('click', function () {
      hideNotification();
      var changes = serialize();
      for (var key in changes) {
        sendToServer(key, changes[key]);
      }
    });
    document.getElementById('notif-accept-server').addEventListener('click', function () {
      hideNotification();
      applyAV();
      syncLS();
    });
  }

  async function init() {
    if (!configForm || !navList || !statusBar || !footer || !btnSaveApply) return;
    wireButtons();
    connectWS();
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
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = input.id = namePrefix + '.' + key;
      if (opts.value) input.checked = true;
      var label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = ' ' + labelText + (required ? '*' : '');
      var container = document.createElement('div');
      container.appendChild(input);
      container.appendChild(label);
      if (opts.tooltip) {
        var helper = document.createElement('small');
        helper.id = input.id + '-helper';
        helper.textContent = opts.tooltip;
        input.setAttribute('aria-describedby', helper.id);
        container.appendChild(helper);
      }
      return container;
    }

    if (type === 'switch') {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.role = 'switch';
      input.name = input.id = namePrefix + '.' + key;
      if (opts.value) input.checked = true;
      applyAttrs(input, opts.attrs);
      var label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = ' ' + labelText + (required ? '*' : '');
      var container = document.createElement('div');
      container.appendChild(input);
      container.appendChild(label);
      if (opts.tooltip) {
        var helper = document.createElement('small');
        helper.id = input.id + '-helper';
        helper.textContent = opts.tooltip;
        input.setAttribute('aria-describedby', helper.id);
        container.appendChild(helper);
      }
      return container;
    }

    if (type === 'radio') {
      var fieldset = document.createElement('fieldset');
      var legend = document.createElement('legend');
      legend.textContent = labelText + (required ? '*' : '');
      fieldset.appendChild(legend);
      if (opts.options) {
        for (var oi = 0; oi < opts.options.length; oi++) {
          var opt = opts.options[oi];
          var radioId = namePrefix + '.' + key + '.' + opt[0];
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = namePrefix + '.' + key;
          radio.id = radioId;
          radio.value = opt[0];
          if (opts.value !== undefined && String(opt[0]) === String(opts.value)) {
            radio.checked = true;
          }
          var radioLabel = document.createElement('label');
          radioLabel.setAttribute('for', radioId);
          radioLabel.textContent = ' ' + opt[1];
          fieldset.appendChild(radio);
          fieldset.appendChild(radioLabel);
        }
      }
      var container = document.createElement('div');
      container.appendChild(fieldset);
      if (opts.tooltip) {
        var helper = document.createElement('small');
        helper.id = namePrefix + '.' + key + '-helper';
        helper.textContent = opts.tooltip;
        container.appendChild(helper);
      }
      return container;
    }

    var labelEl = document.createElement('label');
    labelEl.textContent = labelText + (required ? '*' : '');
    var input;
    var rangeOutput;

    if (inputTypes.indexOf(type) !== -1) {
      input = document.createElement('input');
      input.type = type;
      input.name = input.id = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.name = input.id = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
      var valueDisplay = document.createElement('output');
      valueDisplay.textContent = input.value;
      valueDisplay.style.marginLeft = '0.5em';
      input.addEventListener('input', function () {
        valueDisplay.textContent = input.value;
      });
      rangeOutput = valueDisplay;
    } else if (type === 'select') {
      input = document.createElement('select');
      input.name = input.id = namePrefix + '.' + key;
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
      input.name = input.id = namePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
    } else {
      return null;
    }

    labelEl.setAttribute('for', input.id);
    var container = document.createElement('div');
    container.appendChild(labelEl);
    container.appendChild(input);
    if (opts.tooltip) {
      var helper = document.createElement('small');
      helper.id = input.id + '-helper';
      helper.textContent = opts.tooltip;
      input.setAttribute('aria-describedby', helper.id);
      container.appendChild(helper);
    }
    if (rangeOutput) {
      container.appendChild(rangeOutput);
    }
    return container;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
  }
  /* test-expose */if(window.__TEST_MODE){window.serialize=serialize;window.setBaseline=setBaseline;window.getPending=getPending;window.createField=createField;window.populateFromComponents=populateFromComponents;window.applyAttrs=applyAttrs;window.updateUI=updateUI;window.showError=showError;window.clearError=clearError;window.postJSON=postJSON;window.loadSettings=loadSettings;window.refreshComponents=refreshComponents;window.syncThen=syncThen;window.handleSaveApply=handleSaveApply;window.renderNav=renderNav;window.renderForm=renderForm;window.handleHash=handleHash;window.wireButtons=wireButtons;window.bindChangeListeners=bindChangeListeners;window.init=init;window.buildPatch=buildPatch;window.connectWS=connectWS;window.disconnectWS=disconnectWS;window.onWSClose=onWSClose;window.processSettings=processSettings;window.onWSMessage=onWSMessage;window.updateAV=updateAV;window.applyAV=applyAV;window.syncLS=syncLS;window.resolveNested=resolveNested;window.sendToServer=sendToServer;window.onUserInput=onUserInput;window.readFormValue=readFormValue;window.showExternalNotification=showExternalNotification;window.showConflictPrompt=showConflictPrompt;window.hideNotification=hideNotification;window.__test={};window.__test.receiveWSMessage=onWSMessage;window.__test.wsReady=function(){if(ws)ws.readyState=1};Object.defineProperty(window.__test,'components',{get:function(){return components},set:function(v){components=v}});Object.defineProperty(window.__test,'dirty',{get:function(){return dirty},set:function(v){dirty=v}});Object.defineProperty(window.__test,'lastSent',{get:function(){return lastSent},set:function(v){lastSent=v}});Object.defineProperty(window.__test,'inFlight',{get:function(){return inFlight},set:function(v){inFlight=v}});}
})();
