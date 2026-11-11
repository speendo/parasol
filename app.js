var parasol = (function () {
  'use strict';

  var navList = document.getElementById('nav-list');
  var configForm = document.getElementById('config-form');
  var statusBar = document.getElementById('status-bar');
  var footer = document.querySelector('footer');
  var btnSaveApply = document.getElementById('btn-save-apply');
  var btnReset = document.getElementById('btn-reset');

  var navActions = document.getElementById('nav-actions');
  var navActionsList = navActions ? navActions.querySelector('ul') : null;
  var navSep = navActions ? document.getElementById('nav-sep') : null;
  var navCollapsed = false;
  var navClickWired = false;

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
  var showReset = false;
  var showReboot = false;
  var pendingConflicts = [];
  var resetInProgress = false;
  var rebooting = false;
  var localUploading = false;
  var serverUploading = false;
  var activeUpload = null;

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
        if (field.type === 'file') continue;
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
        } else if (field.type === 'file') {
          var cur = document.getElementById(pfx + grp.id + '.' + field.key + '-current');
          if (cur) setFileLabel(cur, fopts.value);
        } else {
          el.value = fopts.value !== undefined ? fopts.value : '';
        }
      }
    }
  }

  /** True while a local or server-side upload is active. */
  function isLocked() { return localUploading || serverUploading; }

  /**
   * Determine whether the Save button should be visible.
   * Gated by formInteracted — validity only checked after first user interaction.
   */
  function updateUI() {
    var locked = isLocked();
    var formOk = formInteracted ? configForm.checkValidity() : true;
    var alwaysShow = document.querySelector('meta[name="parasol-always-show-save"]');
    alwaysShow = alwaysShow && alwaysShow.content === '1';
    var showBtn = !locked && (dirty || alwaysShow) && formOk;
    btnSaveApply.hidden = !showBtn;
    btnSaveApply.disabled = !showBtn;
    btnReset.hidden = !(!locked && showReset && (dirty || alwaysShow));
    btnReset.disabled = locked;
    var nr = document.getElementById('nav-reboot');
    if (nr) {
      nr.setAttribute('aria-disabled', locked ? 'true' : 'false');
      nr.style.pointerEvents = locked ? 'none' : '';
    }
    var rc = document.getElementById('reboot-confirm');
    if (rc) rc.disabled = locked;
    for (var k in fileFields) {
      var e = fileFields[k];
      e.input.disabled = locked;
      e.btn.disabled = locked || !e.valid;
      e.cancel.hidden = !(activeUpload && activeUpload.key === k);
      if (serverUploading && !localUploading && e.msg.textContent === '') e.msg.textContent = 'Another upload is in progress.';
      else if (!locked && e.msg.textContent === 'Another upload is in progress.') e.msg.textContent = '';
    }
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
      if (field && field.type !== 'file') data[grpId][fieldKey] = [field.type, field.label, { value: changes[name] }];
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

  /** Open a WebSocket connection to /api/events. Sets aria-busy on the form. */
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
    if (rebooting) return;
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
  function parseFields(group) {
    var fields = [];
    for (var fieldKey in group) {
      if (fieldKey === 'label') continue;
      var arr = group[fieldKey];
      fields.push({key: fieldKey, type: arr[0], label: arr[1], opts: arr[2]});
    }
    return fields;
  }

  function processSettings(data, dirtyFlag) {
    dirty = dirtyFlag === true;
    var grps = [];
    for (var key in data) {
      if (key[0] === '_') continue;
      var group = data[key];
      var fields = parseFields(group);
      grps.push({id: key, label: group.label || labelFromKey(key), fields: fields});
    }
    groups = grps;
    renderNav();
    renderForm();
    bindChangeListeners();
    populateFromGroups();
    revalidateAll();
    setBaseline();
    configForm.removeAttribute('aria-busy');
    clearError();
    if (resetInProgress) resetInProgress = false;
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
        var fields = parseFields(group);
        statusGroups.push({id: key, label: group.label || labelFromKey(key), fields: fields});
      }
      if (groups.length > 0) {
        renderForm();
        populateFromGroups(statusGroups, 'st-');
        populateFromGroups();
        revalidateAll();
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
  /** Read a metadata flag from `_meta` first, falling back to a legacy key. */
  function metaVal(msg, name, legacy) {
    var m = msg._meta;
    if (m && typeof m === 'object' && m[name] !== undefined) return m[name];
    return msg[legacy];
  }
  function updateMetaFlags(msg) {
    var sr = metaVal(msg, 'show_reset', '_show_reset');
    var sb = metaVal(msg, 'show_reboot', '_show_reboot');
    var up = metaVal(msg, 'uploading', '_uploading');
    if (sr !== undefined) showReset = sr === true;
    if (sb !== undefined) showReboot = sb === true;
    if (up !== undefined) serverUploading = up === true;
  }
  function onWSMessage(event) {
    var msg = JSON.parse(event.data);
    if (msg.type === 'status') { processStatus(msg.data); return; }
    if (msg.type === 'error') { showError(msg.message); return; }
    if (msg.type !== 'settings' && msg._dirty === undefined) return;
    wsRetries = 0;

    var data = msg.data || msg;
    var dirtyFlag = metaVal(msg, 'dirty', '_dirty') === true;

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
      dirty = dirtyFlag;
      updateMetaFlags(msg);
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
      dirty = dirtyFlag;
      updateMetaFlags(msg);
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

    dirty = dirtyFlag;
    updateMetaFlags(msg);
    updateUI();

    // Initial load — no groups yet, process settings directly
    if (groups.length === 0) {
      processSettings(data, dirtyFlag);
      return;
    }

    syncFileLabels(data);

    var changedFields = {};
    for (var ci = 0; ci < groups.length; ci++) {
      var grp = groups[ci];
      var sGroup = data[grp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        if (field.type === 'file') continue;
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

    if (resetInProgress) {
      applyAV();
      syncLS();
      resetInProgress = false;
    } else if (conflicts.length > 0) {
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
   * Update file field AVs and their "Current" labels from a server settings
   * payload, without treating them as editable form changes.
   * @param {Object} data - settings payload keyed by group ID
   */
  function syncFileLabels(data) {
    for (var ci = 0; ci < groups.length; ci++) {
      var grp = groups[ci];
      if (!grp.fields) continue;
      var sGroup = data[grp.id];
      if (!sGroup) continue;
      for (var fi = 0; fi < grp.fields.length; fi++) {
        var field = grp.fields[fi];
        if (field.type !== 'file') continue;
        var sField = sGroup[field.key];
        if (!sField) continue;
        field.opts.value = sField[2].value;
        var key = grp.id + '.' + field.key;
        var el = fileFields[key] && fileFields[key].current;
        if (!el) el = document.getElementById(key + '-current');
        if (el) setFileLabel(el, field.opts.value);
      }
    }
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
        if (fs[fi].type === 'file') continue;
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
    var f = findField(parts[0], parts[1]);
    if (f && f.type === 'file') return undefined;
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
    pendingConflicts = conflicts;
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
    btnSaveApply.setAttribute('aria-busy', 'true');
    postJSON('/api/settings/save', body).then(function (ok) {
      btnSaveApply.removeAttribute('aria-busy');
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
    if (navCollapsed) {
      moveSectionsToNavList();
      navList.hidden = false;
      navCollapsed = false;
    }
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
    sectionCount = navList.children.length;
    syncDeviceMenu();
    wireNavClick();
    wireNavResize();
    updateFit();
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

  function buildRebootItem() {
    var li = document.createElement('li');
    li.className = 'nav-action';
    var a = document.createElement('a');
    a.href = '#';
    a.id = 'nav-reboot';
    a.textContent = 'Reboot';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (isLocked()) return;
      if (navActions) navActions.open = false;
      var dd = document.getElementById('reboot-dialog');
      if (dd) dd.showModal();
    });
    li.appendChild(a);
    return li;
  }

  function syncDeviceMenu() {
    if (!navActions || !navActionsList) return;
    var existing = document.getElementById('nav-reboot');
    if (showReboot && !existing) {
      navActionsList.appendChild(buildRebootItem());
    } else if (!showReboot && existing) {
      existing.parentNode.parentNode.removeChild(existing.parentNode);
    }
    var hasReboot = !!document.getElementById('nav-reboot');
    navActions.hidden = !(navCollapsed || hasReboot);
    if (navSep) navSep.hidden = !(navCollapsed && hasReboot);
  }

  function wireNavClick() {
    if (navClickWired) return;
    navClickWired = true;
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link && link.hash) {
        var el = document.getElementById(link.hash.slice(1));
        if (el && el.tagName === 'DETAILS') el.open = true;
        if (navActions) navActions.open = false;
      }
    });
  }

  var GAP = 10;
  var sectionCount = 0;

  function moveSectionsToNavList() {
    var node = navActionsList.firstChild;
    while (node && node !== navSep) {
      var nx = node.nextSibling;
      navList.appendChild(node);
      node = nx;
    }
  }

  function moveSectionsToMenu() {
    var node = navList.firstChild;
    while (node) {
      var nx = node.nextSibling;
      navActionsList.insertBefore(node, navSep);
      node = nx;
    }
  }

  function applyNavMode(collapsed) {
    navCollapsed = collapsed;
    if (collapsed) moveSectionsToMenu();
    else moveSectionsToNavList();
    var hasReboot = !!document.getElementById('nav-reboot');
    navList.hidden = collapsed;
    if (navActions) navActions.hidden = !(collapsed || hasReboot);
    if (navSep) navSep.hidden = !(collapsed && hasReboot && sectionCount > 0);
  }

  function updateFit() {
    if (!navActionsList || !navActions || !navSep) return;
    if (!document.documentElement.clientWidth) return; // no layout (jsdom)
    if (navCollapsed) {
      moveSectionsToNavList();
      navList.hidden = false;
    }
    var boundary;
    if (navActions.hidden) {
      var navEl = document.querySelector('header nav');
      if (!navEl) { navList.hidden = false; return; }
      boundary = navEl.getBoundingClientRect().right - GAP;
    } else {
      boundary = navActions.getBoundingClientRect().left - GAP;
    }
    var right = navList.getBoundingClientRect().right;
    var fits = sectionCount === 0 || right <= boundary + 0.5;
    applyNavMode(!fits);
  }

  function wireNavResize() {
    if (wireNavResize._done) return;
    wireNavResize._done = true;
    var timer = null;
    window.addEventListener('resize', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(updateFit, 150);
    });
    window.addEventListener('load', updateFit);
  }

  function revalidateAll() {
    var fields = configForm.querySelectorAll('input, select, textarea');
    for (var fi = 0; fi < fields.length; fi++) {
      if (fields[fi].name) fields[fi].setAttribute('aria-invalid', fields[fi].checkValidity() ? 'false' : 'true');
    }
    var details = configForm.querySelectorAll('details');
    for (var di = 0; di < details.length; di++) {
      if (details[di].querySelector('[aria-invalid="true"]')) details[di].open = true;
    }
  }

  function renderForm() {
    fileFields = {};
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
      if (el.type === 'file') continue;
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

  /** Wire up button click handlers (Save, Reset, notification bar actions). */
  function wireButtons() {
    btnSaveApply.addEventListener('click', handleSaveApply);
    btnReset.addEventListener('click', function () {
      if (resetInProgress) return;
      resetInProgress = true;
      configForm.setAttribute('aria-busy', 'true');
      postJSON('/api/settings/reset', {}).then(function (ok) {
        if (!ok) {
          resetInProgress = false;
          configForm.removeAttribute('aria-busy');
        }
      });
    });
    var rebootConfirm = document.getElementById('reboot-confirm');
    if (rebootConfirm) {
      rebootConfirm.addEventListener('click', function () {
        if (isLocked()) return;
        document.getElementById('reboot-dialog').close();
        rebooting = true;
        postJSON('/api/system/reboot', {}).then(function () {
          statusBar.textContent = 'Rebooting...';
        });
      });
    }
    var rebootCancel = document.getElementById('reboot-cancel');
    if (rebootCancel) {
      rebootCancel.addEventListener('click', function () {
        document.getElementById('reboot-dialog').close();
      });
    }
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
          sendToServer(grp.id + '.' + field.key, fv);
        }
      }
      updateUI();
    });
    document.getElementById('notif-keep-local').addEventListener('click', function () {
      hideNotification();
      for (var ci = 0; ci < pendingConflicts.length; ci++) {
        var c = pendingConflicts[ci];
        var val = readFormValue(c.key.split('.'));
        if (val !== undefined) sendToServer(c.key, val);
      }
      pendingConflicts = [];
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
    if (!configForm || !navList || !statusBar || !footer || !btnSaveApply || !btnReset) return;
    wireButtons();
    connectWS();
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  /** Warn before unloading while an upload is active; otherwise close the socket. */
  function onBeforeUnload(e) {
    if (localUploading || serverUploading) {
      e.preventDefault();
      e.returnValue = '';
      return;
    }
    disconnectWS();
  }

  var fileFields = {};

  /** Set the read-only current-file line for a file field. */
  function setFileLabel(el, value) {
    el.textContent = value ? 'Current: ' + value : 'No file';
  }

  /** Return true when a file's name or MIME type matches an accept list. */
  function acceptsFile(file, accept) {
    if (!accept || accept === '*/*') return true;
    var name = file.name.toLowerCase();
    var mime = (file.type || '').toLowerCase();
    var parts = accept.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+|\s+$/g, '').toLowerCase();
      if (!p) continue;
      if (p.charAt(0) === '.') {
        if (name.length >= p.length && name.slice(name.length - p.length) === p) return true;
      } else if (p.indexOf('/') >= 0) {
        if (p === '*/*') return true;
        if (mime && (mime === p || (p.slice(-2) === '/*' && mime.indexOf(p.slice(0, -1)) === 0))) return true;
      }
    }
    return false;
  }

  /** Return an inline error for a selected file, or '' when it passes the local checks. */
  function checkFile(file, opts) {
    if (!file.size) return 'Empty file';
    if (opts.max_size && file.size > opts.max_size) return 'File too large';
    if (!acceptsFile(file, opts.accept)) return 'File type not allowed';
    return '';
  }

  /** Read input.files[0] and update a file field's validity, message, and Upload button. */
  function fileSelected(id) {
    var f = fileFields[id];
    if (!f) return;
    var file = f.input.files && f.input.files[0];
    if (!file) {
      f.file = null;
      f.valid = false;
      f.msg.textContent = '';
      f.btn.disabled = true;
      return;
    }
    var err = checkFile(file, f.field.opts || {});
    f.file = file;
    f.valid = err === '';
    f.msg.textContent = err;
    f.btn.disabled = !f.valid;
  }

  /** Build the file input, Upload button, current label, progress, Cancel, and status line. */
  function createFileField(namePrefix, field, isStatus) {
    var key = field.key;
    var opts = field.opts || {};
    var id = (isStatus ? 'st-' + namePrefix : namePrefix) + '.' + key;
    var required = opts.attrs && opts.attrs.required;
    var container = document.createElement('div');

    var label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = field.label + (required ? '*' : '');
    container.appendChild(label);

    var row = document.createElement('div');
    row.setAttribute('role', 'group');
    var input = document.createElement('input');
    input.type = 'file';
    input.name = input.id = id;
    if (opts.accept) input.setAttribute('accept', opts.accept);
    applyAttrs(input, opts.attrs);
    if (isStatus) input.disabled = true;
    row.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id + '-upload';
    btn.textContent = 'Upload';
    btn.disabled = true;
    row.appendChild(btn);
    container.appendChild(row);

    var current = document.createElement('small');
    current.id = id + '-current';
    current.className = 'file-status';
    setFileLabel(current, opts.value);
    container.appendChild(current);

    addHelperText(container, id, opts.help, input);

    var progress = document.createElement('progress');
    progress.id = id + '-progress';
    progress.max = 100;
    progress.value = 0;
    progress.hidden = true;
    container.appendChild(progress);

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = id + '-cancel';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.hidden = true;
    container.appendChild(cancel);

    var msg = document.createElement('small');
    msg.id = id + '-msg';
    msg.className = 'file-msg';
    msg.setAttribute('role', 'status');
    container.appendChild(msg);

    fileFields[id] = {
      input: input, btn: btn, progress: progress, cancel: cancel,
      msg: msg, current: current, file: null, valid: false,
      field: field, group: namePrefix, key: key,
    };
    input.addEventListener('change', function () { fileSelected(id); });
    btn.addEventListener('click', function () { startUpload(id); });
    cancel.addEventListener('click', function () { cancelUpload(); });
    return container;
  }

  /** Build the upload endpoint path for a file field, URL-encoding group and key. */
  function uploadURL(f) {
    return '/api/upload/' + encodeURIComponent(f.group) + '/' + encodeURIComponent(f.key);
  }

  /** Finish an upload: clear the lock, hide progress/Cancel, show a message. */
  function finishUpload(f, msg) {
    localUploading = false;
    if (f) {
      f.progress.hidden = true;
      f.cancel.hidden = true;
      f.msg.textContent = msg;
    }
    activeUpload = null;
    updateUI();
  }

  /** Stream the file with XHR so upload.onprogress is available. */
  function putFile(f, url, file, au) {
    if (au.cancelled) return;
    var xhr = au.xhr = new XMLHttpRequest();
    xhr.open('PUT', url + '?name=' + encodeURIComponent(file.name) + '&type=' + encodeURIComponent(file.type));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) f.progress.value = Math.round(e.loaded / e.total * 100);
    };
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        finishUpload(f, 'Uploaded');
      } else {
        finishUpload(f, xhr.responseText || 'HTTP ' + xhr.status);
      }
    };
    xhr.onerror = function () {
      finishUpload(f, f.progress.value >= 100 ? 'Device restarting...' : 'Upload failed');
    };
    xhr.onabort = function () { finishUpload(f, 'Upload cancelled'); };
    xhr.send(file);
  }

  /** POST the preflight metadata, then PUT the raw file on success. */
  function startUpload(key) {
    var f = fileFields[key];
    if (!f || !f.valid || localUploading || serverUploading) return;
    localUploading = true;
    updateUI();
    f.progress.hidden = false;
    f.progress.value = 0;
    f.cancel.hidden = false;
    f.msg.textContent = '';
    var file = f.file;
    var url = uploadURL(f);
    var au = activeUpload = { key: key, xhr: null, cancelled: false };
    au.ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var req = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type })
    };
    if (au.ac) req.signal = au.ac.signal;
    fetch(url, req).then(function (res) {
      if (au.cancelled) return;
      if (res.ok) return putFile(f, url, file, au);
      return res.text().then(function (t) { finishUpload(f, t || 'HTTP ' + res.status); });
    }).catch(function () {
      if (!au.cancelled) finishUpload(f, 'Upload failed');
    });
  }

  /** Abort the active upload (preflight or PUT) and report it as cancelled. */
  function cancelUpload() {
    var au = activeUpload;
    if (!au) return;
    au.cancelled = true;
    if (au.ac) au.ac.abort();
    if (au.xhr) { au.xhr.abort(); return; }
    finishUpload(fileFields[au.key], 'Upload cancelled');
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

    if (type === 'file') return createFileField(namePrefix, field, isStatus);

    if (type === 'checkbox' || type === 'switch') {
      var input = document.createElement('input');
      input.type = 'checkbox';
      if (type === 'switch') input.role = 'switch';
      input.name = input.id = effectivePrefix + '.' + key;
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
      applyAttrs(input, opts.attrs);
      if (isStatus) input.disabled = true;
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.name = input.id = effectivePrefix + '.' + key;
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
          input.appendChild(option);
        }
      }
      applyAttrs(input, opts.attrs);
      if (isStatus) input.disabled = true;
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.name = input.id = effectivePrefix + '.' + key;
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

  /* test hooks — set up window.__test for unit test access (stripped in production build) */
  if (typeof __DEV__ === 'undefined' || __DEV__) {
    window.__test = {};
    Object.defineProperty(window.__test, 'groups', { get: function () { return groups; }, set: function (v) { groups = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'dirty', { get: function () { return dirty; }, set: function (v) { dirty = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'inFlight', { get: function () { return inFlight; }, set: function (v) { inFlight = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'lastSent', { get: function () { return lastSent; }, set: function (v) { lastSent = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'formInteracted', { get: function () { return formInteracted; }, set: function (v) { formInteracted = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'showReset', { get: function () { return showReset; }, set: function (v) { showReset = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'showReboot', { get: function () { return showReboot; }, set: function (v) { showReboot = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'resetInProgress', { get: function () { return resetInProgress; }, set: function (v) { resetInProgress = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'rebooting', { get: function () { return rebooting; }, set: function (v) { rebooting = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'statusGroups', { get: function () { return statusGroups; }, set: function (v) { statusGroups = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'receiveWSMessage', { get: function () { return onWSMessage; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'wsReady', { get: function () { return function () { if (ws) ws.readyState = 1; }; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'setNavMode', { value: function (v) { applyNavMode(!!v); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'acceptsFile', { value: acceptsFile, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'checkFile', { value: checkFile, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'localUploading', { get: function () { return localUploading; }, set: function (v) { localUploading = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'serverUploading', { get: function () { return serverUploading; }, set: function (v) { serverUploading = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'fileFields', { get: function () { return fileFields; }, set: function (v) { fileFields = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'onBeforeUnload', { value: onBeforeUnload, enumerable: true, configurable: true });
    Object.defineProperty(window.__test, 'startUpload', { value: startUpload, enumerable: true, configurable: true });
  }

  return {
    init: init,
    serialize: serialize,
    setBaseline: setBaseline,
    getPending: getPending,
    createField: createField,
    populateFromGroups: populateFromGroups,
    applyAttrs: applyAttrs,
    addHelperText: addHelperText,
    findField: findField,
    updateUI: updateUI,
    showError: showError,
    clearError: clearError,
    postJSON: postJSON,
    syncThen: syncThen,
    handleSaveApply: handleSaveApply,
    renderNav: renderNav,
    renderForm: renderForm,
    revalidateAll: revalidateAll,
    handleHash: handleHash,
    wireButtons: wireButtons,
    bindChangeListeners: bindChangeListeners,
    buildPatch: buildPatch,
    connectWS: connectWS,
    disconnectWS: disconnectWS,
    onWSClose: onWSClose,
    processSettings: processSettings,
    onWSMessage: onWSMessage,
    updateAV: updateAV,
    applyAV: applyAV,
    syncLS: syncLS,
    resolveNested: resolveNested,
    sendToServer: sendToServer,
    onUserInput: onUserInput,
    readFormValue: readFormValue,
    showExternalNotification: showExternalNotification,
    showConflictPrompt: showConflictPrompt,
    hideNotification: hideNotification,
    processStatus: processStatus,
  };
})();
