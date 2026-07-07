(function () {
  'use strict';

  var navList = document.getElementById('nav-list');
  var configForm = document.getElementById('config-form');
  var statusBar = document.getElementById('status-bar');
  var footer = document.querySelector('footer');
  var btnSaveApply = document.getElementById('btn-save-apply');

  var baseline = null;
  var groups = [];
  /** @type {Array} Read-only status group definitions, parallel to groups. */
  var statusGroups = [];
  var dirty = false;
  var ws = null;
  var lastSent = {};
  var inFlight = {};
  var wsReconnectTimer = null;
  var wsRetries = 0;
  var formInteracted = false;

  /** Show an error message in the status bar. @param {string} msg */
  function showError(msg) {
    statusBar.textContent = msg;
    statusBar.style.color = 'var(--pico-color-red)';
  }

  /** Clear the status bar error. */
  function clearError() {
    statusBar.textContent = '';
    statusBar.style.color = '';
  }

  /**
   * Serialize all form field values into a flat key-value object.
   * Keys are "grpId.fieldKey", values are native types (string, boolean).
   * @returns {Object<string, (string|boolean)>}
   */
  function serialize() {
    var data = {};
    for (var ci = 0; ci < groups.length; ci++) {
      var grp = groups[ci];
      if (!grp.fields) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        var val = readFormValue([grp.id, field.key]);
        data[grp.id + '.' + field.key] = val === undefined
          ? (field.type === 'radio' ? null : '')
          : val;
      }
    }
    return data;
  }

  /** Snapshot current form values as the baseline for diffing. */
  function setBaseline() {
    baseline = serialize();
  }

  /**
   * Return only the fields whose form value differs from the baseline.
   * @returns {Object<string, (string|boolean)>}
   */
  function getPending() {
    if (!baseline) return {};
    var current = serialize();
    var changes = {};
    for (var key in current) {
      if (current[key] !== baseline[key]) changes[key] = current[key];
    }
    return changes;
  }

  /**
   * Populate form elements from group field definitions' opts.value.
   * @param {Array} [grps] - optional group array, defaults to global `groups`
   */
  function populateFromGroups(grps, domPrefix) {
    if (!grps) grps = groups;
    var pfx = domPrefix || '';
    for (var ci = 0; ci < grps.length; ci++) {
      var grp = grps[ci];
      if (!grp.fields) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        var el = configForm.querySelector('[name="' + pfx + grp.id + '.' + field.key + '"]');
        if (!el) continue;
        var fopts = field.opts || {};
        if (field.type === 'checkbox') {
          if (fopts.value === null) {
            el.checked = false;
            el.indeterminate = true;
          } else {
            el.checked = !!fopts.value;
            el.indeterminate = false;
          }
        } else if (field.type === 'switch') {
          el.checked = !!fopts.value;
          el.indeterminate = false;
        } else if (field.type === 'radio') {
          var radios = configForm.querySelectorAll('[name="' + pfx + grp.id + '.' + field.key + '"]');
          for (var ri = 0; ri < radios.length; ri++) {
            radios[ri].checked = fopts.value !== undefined && String(radios[ri].value) === String(fopts.value);
          }
        } else {
          el.value = fopts.value !== undefined ? fopts.value : '';
        }
      }
    }
  }

  /**
   * Determine whether the Save button should be visible.
   * Gated by formInteracted — validity only checked after first user interaction.
   */
  function updateUI() {
    var formOk = formInteracted ? configForm.checkValidity() : true;
    var showBtn = dirty && formOk;
    btnSaveApply.hidden = !showBtn;
    btnSaveApply.disabled = !showBtn;
  }

  /**
   * Find a field definition by group ID and field key.
   * @param {string} grpId - e.g. "wifi"
   * @param {string} fieldKey - e.g. "ssid"
   * @returns {Object|null} the field object {key, type, label, opts} or null if not found
   */
  function findField(grpId, fieldKey) {
    for (var ci = 0; ci < groups.length; ci++) {
      if (groups[ci].id !== grpId) continue;
      var fields = groups[ci].fields;
      if (!fields) return null;
      for (var fi = 0; fi < fields.length; fi++) {
        if (fields[fi].key === fieldKey) return fields[fi];
      }
      return null;
    }
    return null;
  }

  /**
   * Build a nested JSON patch body from a flat changes object.
   * Input:  {"wifi.ssid": "MyNet"}
   * Output: {"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}}
   * @param {Object<string, *>} changes - flat key→value map of changed fields
   * @returns {Object}
   */
  function buildPatch(changes) {
    var data = {};
    for (var name in changes) {
      var dot = name.indexOf('.');
      var grpId = name.slice(0, dot);
      var fieldKey = name.slice(dot + 1);
      if (!data[grpId]) data[grpId] = {};
      var field = findField(grpId, fieldKey);
      if (field) data[grpId][fieldKey] = [field.type, field.label, { value: changes[name] }];
    }
    return data;
  }

  document.addEventListener('DOMContentLoaded', init);

  /**
   * POST JSON to a URL, display errors on failure.
   * @param {string} url
   * @param {*} data - JSON-serializable body
   * @returns {Promise<boolean>} true on success, false on error
   */
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

  /** Open a WebSocket connection to /api/settings/ws. Sets aria-busy on the form. */
  function connectWS() {
    configForm.setAttribute('aria-busy', 'true');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/api/events');
    ws.onopen = function () {};
    ws.onmessage = onWSMessage;
    ws.onclose = onWSClose;
    ws.onerror = function () { ws.close(); };
  }

  /** Close the WebSocket and cancel any reconnect timer. */
  function disconnectWS() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  /** Handle WS close: exponential backoff reconnect up to 5 retries, then show manual retry button. */
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

  /** Create a "Retry" button for manual reconnection after WS retries exhausted. */
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

  /**
   * Parse the full settings JSON from the server into the `groups` array,
   * render nav + form, bind listeners, set baseline, handle hash navigation.
   * Called on initial WebSocket load (when groups is empty).
   * @param {Object} data - settings payload (without _dirty)
   * @param {boolean} dirtyFlag - server `_dirty` flag
   */
  function processSettings(data, dirtyFlag) {
    dirty = dirtyFlag === true;
    var grps = [];
    for (var key in data) {
      if (key[0] === '_') continue;
      var group = data[key];
      var fields = [];
      for (var fieldKey in group) {
        if (fieldKey === 'label') continue;
        var arr = group[fieldKey];
        fields.push({key: fieldKey, type: arr[0], label: arr[1], opts: arr[2]});
      }
      grps.push({id: key, label: group.label || labelFromKey(key), fields: fields});
    }
    groups = grps;
    renderNav();
    renderForm();
    bindChangeListeners();
    populateFromGroups();
    setBaseline();
    configForm.removeAttribute('aria-busy');
    clearError();
    updateUI();
    handleHash();
  }

  /**
   * Parse a status data payload into statusGroups and render.
   * First call builds the full group tree. Subsequent calls (partial updates)
   * merge changed field values and update the DOM via populateFromGroups.
   * @param {Object} data - status payload keyed by group ID
   */
  function processStatus(data) {
    if (statusGroups.length === 0) {
      for (var key in data) {
        if (key[0] === '_') continue;
        var group = data[key];
        var fields = [];
        for (var fieldKey in group) {
          if (fieldKey === 'label') continue;
          var arr = group[fieldKey];
          fields.push({key: fieldKey, type: arr[0], label: arr[1], opts: arr[2]});
        }
        statusGroups.push({id: key, label: group.label || labelFromKey(key), fields: fields});
      }
      if (groups.length > 0) {
        renderForm();
        populateFromGroups(statusGroups, 'st-');
        populateFromGroups();
        setBaseline();
        updateUI();
      }
    } else {
      for (var cid in data) {
        if (cid[0] === '_') continue;
        for (var sci = 0; sci < statusGroups.length; sci++) {
          if (statusGroups[sci].id !== cid) continue;
          var grp = statusGroups[sci];
          for (var fk in data[cid]) {
            for (var fi = 0; fi < grp.fields.length; fi++) {
              if (grp.fields[fi].key === fk) {
                grp.fields[fi].opts.value = data[cid][fk][2].value;
              }
            }
          }
        }
      }
      populateFromGroups(statusGroups, 'st-');
    }
  }

  /**
   * WebSocket message handler - implements the 10-case state machine.
   *
   * Echo resolution:   Cases 6-7 - match inFlight sends against server echo
   * External updates:  Cases 1,3,4,5 - handle server-pushed changes
   * In-flight defer:   Cases 8-9-10 - ignore packets while awaiting echo
   *
   * @param {MessageEvent} event - WS message with JSON data
   */
  function onWSMessage(event) {
    var msg = JSON.parse(event.data);
    if (msg.type === 'status') { processStatus(msg.data); return; }
    if (msg.type === 'error') { showError(msg.message); return; }
    if (msg.type !== 'settings' && msg._dirty === undefined) return;
    wsRetries = 0;

    var data = msg.data || msg;

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
      dirty = msg._dirty;
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
      }
      updateAV(data);
      setBaseline();
      updateUI();
      configForm.removeAttribute('aria-busy');
      return;
    }

    var hasInFlight = false;
    for (var k in inFlight) { if (inFlight[k]) { hasInFlight = true; break; } }
    if (hasInFlight && configForm.getAttribute('aria-busy') !== 'true') return;
    if (hasInFlight) {
      dirty = msg._dirty;
      updateAV(data);
      for (var sk in inFlight) { inFlight[sk] = false; }
      for (var sk in lastSent) { lastSent[sk] = undefined; }
      for (var ci = 0; ci < groups.length; ci++) {
        var grp = groups[ci];
        if (!grp.fields) continue;
        for (var fi = 0; fi < grp.fields.length; fi++) {
          var field = grp.fields[fi];
          var key = grp.id + '.' + field.key;
          var fv = readFormValue([grp.id, field.key]);
          if (fv !== undefined && String(fv) !== String(field.opts.value)) {
            sendToServer(key, fv);
          }
        }
      }
      setBaseline();
      updateUI();
      configForm.removeAttribute('aria-busy');
      return;
    }

    dirty = msg._dirty;

    // Initial load — no groups yet, process settings directly
    if (groups.length === 0) {
      processSettings(data, msg._dirty);
      return;
    }

    var changedFields = {};
    for (var ci = 0; ci < groups.length; ci++) {
      var grp = groups[ci];
      var sGroup = data[grp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        var sField = sGroup[field.key];
        if (!sField) continue;
        var newAV = sField[2].value;
        var oldAV = field.opts.value;
        if (String(newAV) === String(oldAV)) continue;
        var fv = readFormValue([grp.id, field.key]);
        if (fv === undefined) continue;
        changedFields[grp.id + '.' + field.key] = {newAV: newAV, oldAV: oldAV, fv: fv, label: field.label};
      }
    }

    if (Object.keys(changedFields).length === 0) {
      configForm.removeAttribute('aria-busy');
      return;
    }

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

    var notifBar = document.getElementById('server-changed');
    var promptActive = notifBar && !notifBar.hidden;

    if (conflicts.length > 0) {
      if (!promptActive) showConflictPrompt(conflicts);
    } else if (externalFields.length > 0) {
      if (!promptActive) showExternalNotification(externalFields);
    } else {
      applyAV();
      syncLS();
    }
    configForm.removeAttribute('aria-busy');
  }

  /**
   * Copy Applied Values from a server settings payload into
   * the in-memory group field definitions (field.opts.value).
   * @param {Object} data - settings payload keyed by group ID
   */
  function updateAV(data) {
    for (var ci = 0; ci < groups.length; ci++) {
      var grp = groups[ci];
      var sGroup = data[grp.id];
      if (!sGroup) continue;
      if (!grp.fields) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        var sField = sGroup[field.key];
        if (!sField) continue;
        field.opts.value = sField[2].value;
      }
    }
  }

  /** Write AV from in-memory fields into the DOM form and update baseline. */
  function applyAV() {
    populateFromGroups();
    setBaseline();
    updateUI();
  }

  /**
   * Sync the lastSent tracking map with current AV values
   * (so subsequent user changes are detected as new).
   */
  function syncLS() {
    for (var ci = 0; ci < groups.length; ci++) {
      var fs = groups[ci].fields;
      if (!fs) continue;
      for (var fi = 0; fi < fs.length; fi++) {
        var key = groups[ci].id + '.' + groups[ci].fields[fi].key;
        lastSent[key] = groups[ci].fields[fi].opts.value;
      }
    }
  }

  /**
   * Send a single field value to the server over WebSocket as an `apply` action.
   * Sets lastSent and inFlight tracking.
   * @param {string} key - "grpId.fieldKey"
   * @param {*} value
   */
  function sendToServer(key, value) {
    if (!ws || ws.readyState !== 1) return;
    lastSent[key] = value;
    inFlight[key] = true;
    var parts = key.split('.');
    var grpId = parts[0];
    var fieldKey = parts[1];
    var field = findField(grpId, fieldKey);
    if (!field) return;
    var patch = {};
    patch[grpId] = {};
    patch[grpId][fieldKey] = [field.type, field.label, { value: value }];
    ws.send(JSON.stringify({action: 'apply', data: patch}));
  }

  /**
   * Fire-and-forget a user-initiated field change to the server.
   * No-ops if inFlight, or if the value matches lastSent.
   * @param {string} key - "grpId.fieldKey"
   * @param {*} newValue
   */
  function onUserInput(key, newValue) {
    if (inFlight[key]) return;
    var ls = lastSent[key];
    if (String(newValue) === String(ls)) return;
    sendToServer(key, newValue);
  }

  /**
   * Resolve a nested property path within an object.
   * @param {Object} obj
   * @param {string[]} parts - path segments, e.g. ["wifi", "ssid"]
   * @returns {*|undefined}
   */
  function resolveNested(obj, parts) {
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * Read a form field's value by compound key path.
   * Handles type coercion: radio→checked value, checkbox→boolean, number/range→float.
   * @param {string[]} parts - path segments, e.g. ["wifi", "ssid"]
   * @returns {(string|number|boolean|undefined)}
   */
  function readFormValue(parts) {
    var nameSel = '[name="' + parts.join('.') + '"]';
    var el = document.querySelector(nameSel);
    if (!el) return undefined;
    if (el.type === 'radio') {
      var checked = document.querySelector(nameSel + ':checked');
      return checked ? checked.value : undefined;
    }
    if (el.type === 'checkbox') return el.indeterminate ? null : el.checked;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  }

  /** Return a comma-separated list of labels from an array of field objects. @param {Array} fields @returns {string} */
  function fieldLabels(fields) {
    return fields.map(function (f) { return f.label; }).join(', ');
  }

  /** Show the "Server settings changed" notification bar (external update, user idle). @param {Array} fields */
  function showExternalNotification(fields) {
    var bar = document.getElementById('server-changed');
    var text = document.getElementById('notif-text');
    text.textContent = 'Server settings changed: ' + fieldLabels(fields);
    document.getElementById('notif-load').hidden = false;
    document.getElementById('notif-keep').hidden = false;
    document.getElementById('notif-keep-local').hidden = true;
    document.getElementById('notif-accept-server').hidden = true;
    bar.hidden = false;
  }

  /** Show the conflict resolution prompt when both local and server values changed. @param {Array} conflicts */
  function showConflictPrompt(conflicts) {
    var bar = document.getElementById('server-changed');
    var text = document.getElementById('notif-text');
    text.textContent = 'Conflict: ' + fieldLabels(conflicts);
    document.getElementById('notif-load').hidden = true;
    document.getElementById('notif-keep').hidden = true;
    document.getElementById('notif-keep-local').hidden = false;
    document.getElementById('notif-accept-server').hidden = false;
    bar.hidden = false;
    footer.classList.add('pending');
  }

  /** Hide the server-changed notification bar and remove pending style from footer. */
  function hideNotification() {
    document.getElementById('server-changed').hidden = true;
    footer.classList.remove('pending');
  }

  /** Reset dirty flag, set baseline, update UI - called after successful save. */
  function syncThen() {
    clearError();
    dirty = false;
    setBaseline();
    updateUI();
  }

  /** Handle the Save button click: POST pending changes to /api/settings/save. */
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

  /**
   * Derive a human-readable label from a camelCase/snake_case key.
   * "wifi_ssid" -> "Wifi Ssid", "AudioInterface" -> "Audio Interface"
   * @param {string} key
   * @returns {string}
   */
  function labelFromKey(key) {
    return key
      .replace(/[_-]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

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

  /** Append a single nav link for a group. */
  function renderLink(grp) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + grp.id;
    a.textContent = grp.label;
    li.appendChild(a);
    navList.appendChild(li);
  }

  function renderForm() {
    configForm.innerHTML = '';
    var seen = {};
    for (var si = 0; si < statusGroups.length; si++) {
      var sgrp = statusGroups[si];
      seen[sgrp.id] = true;
      renderSection(sgrp.id, sgrp.label, sgrp.fields, true, null);
    }
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = groups[gi];
      if (seen[grp.id]) {
        renderSection(grp.id, null, grp.fields, false, grp.id);
      } else {
        seen[grp.id] = true;
        renderSection(grp.id, grp.label, grp.fields, false, null);
      }
    }
    var fields = configForm.querySelectorAll('input, select, textarea');
    for (var fi = 0; fi < fields.length; fi++) {
      if (fields[fi].name) fields[fi].setAttribute('aria-invalid', fields[fi].checkValidity() ? 'false' : 'true');
    }
    var details = configForm.querySelectorAll('details');
    for (var di = 0; di < details.length; di++) {
      if (details[di].querySelector('[aria-invalid="true"]')) details[di].open = true;
    }
  }

  /**
   * Render a details/section block for a group.
   * @param {string} id - group DOM id
   * @param {string|null} label - summary text (null = append to existing details)
   * @param {Array} fields - field definitions
   * @param {boolean} disabled - whether fields are read-only
   * @param {string|null} appendToId - if set, append fields to existing details instead of creating new
   */
  function renderSection(id, label, fields, disabled, appendToId) {
    var details;
    if (appendToId) {
      details = document.getElementById(appendToId);
    } else {
      details = document.createElement('details');
      details.id = id;
      var summary = document.createElement('summary');
      summary.textContent = label;
      if (disabled) summary.className = 'secondary';
      details.appendChild(summary);
      configForm.appendChild(details);
    }
    if (!details || !fields) return;
    for (var fi = 0; fi < fields.length; fi++) {
      var fieldEl = createField(id, fields[fi], disabled ? 1 : 0);
      if (fieldEl) details.appendChild(fieldEl);
    }
  }

  /** Bind hashchange listener and open the details section matching the current URL hash. */
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

  /**
   * Bind input/change/blur/click listeners on all form fields.
   * Sets formInteracted on first interaction to gate validity checks.
   * Opens ancestor details (accordion keep-open) on invalid input.
   * Text/password/email/tel/url use blur; radio uses click; everything else uses change.
   */
  function bindChangeListeners() {
    var els = configForm.querySelectorAll('input, select, textarea');
    for (var ei = 0; ei < els.length; ei++) {
      var el = els[ei];
      var key = el.name;
      if (!key) continue;
      (function (el, key) {
        var handler = function () {
          formInteracted = true;
          var valid = el.checkValidity();
          if (valid && el.indeterminate && el.required) valid = false;
          el.setAttribute('aria-invalid', valid ? 'false' : 'true');
          if (!valid) { var d = el.closest('details'); if (d) d.open = true; updateUI(); return; }
          var val = readFormValue(key.split('.'));
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

  /** Wire up button click handlers (Save, notification bar actions). */
  function wireButtons() {
    btnSaveApply.addEventListener('click', handleSaveApply);
    document.getElementById('notif-load').addEventListener('click', function () {
      hideNotification();
      applyAV();
      syncLS();
    });
    document.getElementById('notif-keep').addEventListener('click', function () {
      hideNotification();
      for (var ci = 0; ci < groups.length; ci++) {
        var grp = groups[ci];
        for (var fi = 0; fi < grp.fields.length; fi++) {
          var field = grp.fields[fi];
          var fv = readFormValue([grp.id, field.key]);
          if (fv === undefined) continue;
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

  /**
   * Initialization: wire buttons, open WebSocket connection.
   * Bound to DOMContentLoaded.
   */
  async function init() {
    if (!configForm || !navList || !statusBar || !footer || !btnSaveApply) return;
    wireButtons();
    connectWS();
  }

  /**
   * Create a DOM element for a settings field.
   * @param {string} namePrefix - group ID (e.g. "wifi")
   * @param {Object} field - { key, type, label, opts }
   * @returns {HTMLElement|null}
   */
  function createField(namePrefix, field, isStatus) {
    if (!field || typeof field !== 'object' || !field.key) return null;
    var key = field.key;
    var type = field.type;
    var labelText = field.label;
    var opts = field.opts || {};
    var required = opts.attrs && opts.attrs.required;
    var inputTypes = ['text', 'email', 'number', 'password', 'tel', 'url', 'color'];
    var effectivePrefix = isStatus ? 'st-' + namePrefix : namePrefix;

    if (type === 'checkbox' || type === 'switch') {
      var input = document.createElement('input');
      input.type = 'checkbox';
      if (type === 'switch') input.role = 'switch';
      input.name = input.id = effectivePrefix + '.' + key;
      if (opts.value) input.checked = true;
      applyAttrs(input, opts.attrs);
      if (isStatus) input.disabled = true;
      var label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = ' ' + labelText + (required ? '*' : '');
      var container = document.createElement('div');
      container.appendChild(input);
      container.appendChild(label);
      addHelperText(container, input.id, opts.help, input);
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
          var radioId = effectivePrefix + '.' + key + '.' + opt[0];
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = effectivePrefix + '.' + key;
          radio.id = radioId;
          radio.value = opt[0];
          if (opts.value !== undefined && String(opt[0]) === String(opts.value)) {
            radio.checked = true;
          }
          if (isStatus) radio.disabled = true;
          var radioLabel = document.createElement('label');
          radioLabel.setAttribute('for', radioId);
          radioLabel.textContent = ' ' + opt[1];
          fieldset.appendChild(radio);
          fieldset.appendChild(radioLabel);
        }
      }
      var container = document.createElement('div');
      container.appendChild(fieldset);
      addHelperText(container, namePrefix + '.' + key, opts.help, null);
      return container;
    }

    var labelEl = document.createElement('label');
    labelEl.textContent = labelText + (required ? '*' : '');
    var input;
    var rangeOutput;

    if (inputTypes.indexOf(type) !== -1) {
      input = document.createElement('input');
      input.type = type;
      input.name = input.id = effectivePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
      if (isStatus) input.disabled = true;
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.name = input.id = effectivePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
      if (isStatus) input.disabled = true;
      var valueDisplay = document.createElement('output');
      valueDisplay.textContent = input.value;
      valueDisplay.style.marginLeft = '0.5em';
      input.addEventListener('input', function () {
        valueDisplay.textContent = input.value;
      });
      rangeOutput = valueDisplay;
    } else if (type === 'select') {
      input = document.createElement('select');
      input.name = input.id = effectivePrefix + '.' + key;
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
      if (isStatus) input.disabled = true;
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.name = input.id = effectivePrefix + '.' + key;
      if (opts.value !== undefined) input.value = opts.value;
      applyAttrs(input, opts.attrs);
      if (isStatus) input.disabled = true;
    } else {
      return null;
    }

    labelEl.setAttribute('for', input.id);
    var container = document.createElement('div');
    container.appendChild(labelEl);
    container.appendChild(input);
    addHelperText(container, input.id, opts.help, input);
    if (rangeOutput) {
      container.appendChild(rangeOutput);
    }
    return container;
  }

  /** Apply HTML attributes from an object to a DOM element. @param {HTMLElement} el @param {Object} attrs */
  function applyAttrs(el, attrs) {
    if (!attrs) return;
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
  }

  /**
   * Append helper text (small element) to a container, optionally with aria-describedby.
   * @param {HTMLElement} container
   * @param {string} baseId - used for the helper's id attribute
   * @param {string} text - helper text content (no-op if falsy)
   * @param {HTMLElement|null} describedEl - element to receive aria-describedby, or null
   */
  function addHelperText(container, baseId, text, describedEl) {
    if (!text) return;
    var helper = document.createElement('small');
    helper.id = baseId + '-helper';
    helper.textContent = text;
    if (describedEl) describedEl.setAttribute('aria-describedby', helper.id);
    container.appendChild(helper);
  }
  /* test-expose */if(window.__TEST_MODE){window.serialize=serialize;window.setBaseline=setBaseline;window.getPending=getPending;window.createField=createField;window.populateFromGroups=populateFromGroups;window.applyAttrs=applyAttrs;window.addHelperText=addHelperText;window.findField=findField;window.updateUI=updateUI;window.showError=showError;window.clearError=clearError;window.postJSON=postJSON;window.syncThen=syncThen;window.handleSaveApply=handleSaveApply;window.renderNav=renderNav;window.renderForm=renderForm;window.handleHash=handleHash;window.wireButtons=wireButtons;window.bindChangeListeners=bindChangeListeners;window.init=init;window.buildPatch=buildPatch;window.connectWS=connectWS;window.disconnectWS=disconnectWS;window.onWSClose=onWSClose;window.processSettings=processSettings;window.onWSMessage=onWSMessage;window.updateAV=updateAV;window.applyAV=applyAV;window.syncLS=syncLS;window.resolveNested=resolveNested;window.sendToServer=sendToServer;window.onUserInput=onUserInput;window.readFormValue=readFormValue;window.showExternalNotification=showExternalNotification;window.showConflictPrompt=showConflictPrompt;window.hideNotification=hideNotification;window.__test={};window.__test.receiveWSMessage=onWSMessage;window.__test.wsReady=function(){if(ws)ws.readyState=1};Object.defineProperty(window.__test,'groups',{get:function(){return groups},set:function(v){groups=v}});Object.defineProperty(window.__test,'dirty',{get:function(){return dirty},set:function(v){dirty=v}});Object.defineProperty(window.__test,'lastSent',{get:function(){return lastSent},set:function(v){lastSent=v}});Object.defineProperty(window.__test,'inFlight',{get:function(){return inFlight},set:function(v){inFlight=v}});Object.defineProperty(window.__test,'formInteracted',{get:function(){return formInteracted},set:function(v){formInteracted=v}});window.processStatus=processStatus;Object.defineProperty(window.__test,'statusGroups',{get:function(){return statusGroups},set:function(v){statusGroups=v}});}
})();
