# Client ack-correlation design

**Status:** design, awaiting approval (target 0.9.0). Supersedes the "Deferred —
client echo-correlation gap" section of
`2026-09-02-architectural-decisions-design.md`, and replaces the ten-case
state machine in `2026-06-18-unified-settings-design.md` as the authoritative
description of the browser's settings state machine.

**Version:** 0.9.0. Wire change. `i` is **required on every apply**: a message
without a numeric id is a protocol error, applies nothing, and gets an error
reply. 0.9.0 firmware is not delivered over the air, so there is no cached-page
window to design around.
A new client against old firmware degrades to the timeout path.
The public API (`prsl_*`) does not change; firmware-visible behavior changes are
documented in `API_REFERENCE.md`.

**Target codebase:** `main`, with 0.8.0 merged. All `app.js` line references are
verified against `main` at the time this branch was cut.

---

## 1. The defect

The browser correlates a server push with its own `apply` by value equality
(`app.js:404`: `String(serverVal) === String(lastSent[key])`). The wire carries
no identifier, so the only signal that a change was processed is "the value I
sent came back".

That assumption fails in three single-user cases, all of them reachable with
one tab and no concurrency:

| Trigger | What the store does | What the client sees |
|---|---|---|
| **Transform** | `on_set` stores a different value (`5` → `10`, `auto` → `station`, truncation, unit conversion) | A push whose value never matches `lastSent` |
| **Accept, don't store** | `on_set` returns `ESP_OK` and writes nothing (one-shot action, normalized input) | The previous value again |
| **Rejection** | `on_set` returns an error; the server sends `{"type":"error"}` to the sender and no push at all (`src/prsl_ws.cpp:45-51`) | An error message; nothing clears `inFlight` |

Consequences, in order of severity:

1. **The field wedges.** `inFlight[key]` stays `true` forever.
2. **The whole tab freezes.** `app.js:436` drops *every* settings push while any
   field is in flight — other fields' external updates, `_meta.dirty`, the Save
   button, other tabs' edits.
3. **The user cannot recover.** `onUserInput` (`app.js:624`) early-returns for a
   field that is in flight, so re-editing and blurring does nothing. Only a
   reconnect clears it, via the force-reset at `app.js:437-458`.

The docs currently describe this as a "cosmetic sharp edge"
(`API_REFERENCE.md:434-439`). It is not: trigger 3 makes a field permanently
unusable, and trigger 2 makes the whole page stale.

---

## 2. Goals

- Every apply the device processes is **correlated** to the browser that sent
  it, whatever the store decided to keep.
- No reachable state where the browser waits indefinitely.
- Nothing about the fix requires per-client or per-field state on the device.
- Keep the client as the place where bookkeeping lives (`AGENTS.md`).
- Preserve the existing model: last-write-wins per field, `on_set` owns the
  write, HTTP save unchanged, `_meta` contract unchanged.

## 3. Non-goals

- Conflict resolution or optimistic locking. No server-side version
  preconditions, no retry loops over conflicts.
- Per-field timeout or per-field correlation options.
- Device-driven changes (a timer or firmware updating a value later). Those are
  correctly classified as external updates and keep the Load/Keep bar.
- Making the apply path atomic (staging/undo).
- Solving multi-tab semantics; they improve as a side effect but are verified
  under the existing 1.0 checklist item.

## 4. Anti-goals

- A solution that shows a Load/Keep prompt for a change the user just made.
- A solution that retries automatically in a way that can double-fire
  `on_set` side effects without bound.
- A solution that adds memory per WebSocket connection.
- A solution that makes a silent drop look like success.

## 5. Constraints

- **ESP32:** bytes on the wire and transient allocations matter. The apply path
  runs in the AsyncTCP task.
- **The settings push is a broadcast; the replies are per-client.**
  `server->textAll()` sends the full settings state to every client
  (`src/prsl_ws.cpp:54-59`). That stays: one build, one send, everyone updated.
  Only the ack (§7.2) and the sync reply (§7.3) are per-client, via
  `client->text()`. So a per-client id cannot travel in the state payload — it
  lives in those two replies instead.
- **`_meta` is device-global.** 0.8.0 established that every settings payload
  carries the same `_meta` for every client (`docs/BACKLOG.md`). A per-client
  id must not go there; a device-wide version could, but is out of scope (§12).
- **The WebSocket library can drop a message on a live socket.**
  `AsyncWebSocketClient::_queueMessage` silently discards when the per-client
  queue is full — 32 messages on ESP32, 8 elsewhere
  (`AsyncWebSocket.cpp:393-419`). `text()` returns `bool`, and
  `setCloseClientOnQueueFull(true)` turns the discard into a disconnect
  (`AsyncWebSocket.h:254`).

---

## 6. Approaches considered

### A — tag the settings push

Client sends `{"action":"apply","i":7,...}`; the server echoes `i` on the
broadcast: `{"type":"settings","i":7,"_meta":{...},"data":{...}}`. No new message
type, no duplicated values, no extra payload build, ~6 bytes per message.

**Rejected** because the push is broadcast and the client *drops* pushes while
any field is in flight (`app.js:436`). With two batches outstanding, batch 7's
push is discarded while batch 8 is pending — destroying the answer it carries.
Fixing that means converting the tab-wide guard into per-key gating, which is
surgery on the state machine and a much larger risk surface. `i` in a broadcast
also means every other client receives someone else's id.

### B — a dedicated ack carrying the decided values *(chosen)*

Server replies to the sender only:
`{"type":"ack","i":7,"d":{"wifi.ssid":"station"},"e":{"gpio.pin":"rejected"}}`,
then broadcasts as today. The client settles batch 7 from the ack alone.

**Chosen** because the ack is self-contained: it bypasses the in-flight guard
entirely, resolves while another batch is still pending, and carries the
authoritative value read back from the store. It adds one small cJSON build and
one extra write per apply — negligible beside the full-state broadcast already
sent on every successful apply.

### C — ack echoing the received values (value correlation)

The design originally suggested as the "leading candidate" in the 2026-09-02
spec. **Rejected:** it clears `inFlight` reliably, but the decided value then
arrives in the ordinary push and reads as an external update, producing a
Load/Keep prompt for a change the user just made. It is also ambiguous when the
same value is sent twice.

### D — server-side version (global monotonic counter) in `_meta`

Considered from the review discussion. A device-wide sequence number is
compatible with `_meta`'s global contract and would let a client detect a missed
push.

**Deferred, not rejected.** It answers "the world moved", not "what does my key
hold now" — so it cannot replace the ack. Its one distinct benefit (staleness
detection when the guard drops a push) is not needed once nothing stays in
flight. It also requires every mutation point (apply, save, reset, upload end)
to bump the counter correctly, which is a silent-failure-prone invariant.
Revisit only if the guard keeps dropping pushes in practice.

---

## 7. The wire contract

### 7.1 Client → server: `action: "apply"`

```json
{"action":"apply","i":7,"data":{"wifi":{"ssid":["text","SSID",{"value":"station"}]}}}
```

- `i` is a positive integer chosen by the client, **required on every apply**.
  It is meaningful only for the connection that sent it; it is not a version and
  not device-global.
- The server checks only that `i` is a number. It never stores it and never uses
  it as a precondition for applying a value.
- Batches are per message. Today the client sends one field per apply; the
  protocol allows more and the ack settles all keys in the message.

### 7.2 Server → sender: `type: "ack"`

```json
{"type":"ack","i":7,"d":{"wifi.ssid":"station"},"e":{"gpio.pin":"rejected"}}
```

- **Exactly one ack** for every apply, including no-ops, unknown keys, file
  fields, and all-rejected batches. There is no uncorrelated apply.
- **A missing or non-numeric `i` is a protocol error.** The batch is not
  applied, nothing is broadcast, and the sender gets `type:"error"`. No ack is
  possible, because there is nothing to correlate to.
- `d` — decided values, flat `"group.key"` → value, **read back from the store
  after applying**, not taken from what `on_set` intended. Contains an entry
  for every requested key that exists in the store, including keys whose
  `on_set` wrote nothing (they resolve to the current stored value). Keys that
  do not exist are omitted. Omission means "no value to report"; the client
  leaves the applied value unchanged.
- `e` — per-key failures, flat key → short reason string. 0.9.0 always emits
  `"rejected"`. Present at most once per batch: both the WS apply path and Save
  abort on the first rejection (§8.3), so at most one key can fail and the keys
  after it are never attempted.
- The ack is written **before** the broadcast. Order is not relied on by the
  client, but this ordering costs nothing and reduces visible churn.
- An ack is sent even when nothing was applied, which is what removes the
  remaining silent paths. If `i` is present but `data` is malformed, the client
  gets the ack **and** a `type:"error"`. Unparsable input cannot be correlated,
  so it gets `type:"error"` only.

### 7.3 Client → server: `action: "sync"`

```json
{"action":"sync","i":9}
```

- Requests a full settings payload. The reply is the standard `type:"settings"`
  message sent **to the requester only**, carrying the same `i`:

  ```json
  {"type":"settings","i":9,"_meta":{...},"data":{...}}
  ```

- Ordinary broadcasts carry no `i`, so the reply is recognized exactly rather
  than by "the next push after I asked". This matters: the user can start a new
  batch before the reply arrives, and an unmarked reply would either be dropped
  by the in-flight guard or misclassified as a conflict.
- The sync id is drawn from the same per-connection counter as batch ids, so the
  two spaces never collide.
- Used by the recovery ladder (§9.5). It is a recovery primitive, not a polling
  mechanism.

### 7.4 Server → all: `type: "settings"` — unchanged

Ordinary broadcasts add no fields. `_meta` keeps its 0.8.0 shape and its
device-global invariant. The values in the push are the same values the ack
carried, so a client that already settled a batch finds no changes when the push
arrives. The one exception is the request-scoped sync reply, which carries the
requester's `i` (§7.3).

The state push stays a single `textAll()`: other clients need the new values, and
the sender ignores it because the ack already settled its keys. Only the ack and
the sync reply are built and sent per client.

The HTTP save path (`POST /api/settings/save`) is unchanged. It has an HTTP
status, so it needs no correlation id, and §8.3 keeps its abort-on-first
semantics.

---

## 8. Server changes

### 8.1 A host-testable handler

All message handling lives in `src/prsl_ws.cpp`, which includes
`ESPAsyncWebServer.h`, and the native harness compiles only `prsl_store.c`,
`prsl_json.c`, and `prsl_body.c`. Left there, none of the ack/sync logic would
be host-testable, and the mandatory-ack rule — the core of this design — would
only be exercised end to end.

Extract the pure part into a new unit (`src/prsl_ws_handle.c` + `.h`) with no
web-server include:

```c
typedef struct {
    char *to_sender;  /* ack or sync reply for the requester; NULL = none */
    char *to_all;     /* settings broadcast; NULL = none */
    char *error;      /* uncorrelated error text; NULL = none */
} prsl_ws_reply_t;

int prsl_ws_handle(const char *json, size_t len, prsl_store_t *store,
                   prsl_ws_reply_t *out);
```

`prsl_ws.cpp` becomes glue: call it, send `to_sender`, then `error`, then
`to_all`, and free all three. The exact struct is the builder's call; the seam
is not.

### 8.2 Ack construction

Inside the handler:

1. Parse; read `i`. If it is absent or not a number, return an error string and
   apply nothing (protocol error, §7.2).
2. Apply the batch (8.3), capturing the first rejection, if any.
3. Build the ack: `d` from `prsl_store_find()` + `cJSON_Duplicate(f->value, 1)`
   (the existing per-field serialization, `src/prsl_json.c:60-64`), `e` from that
   rejection, `i` echoed.
4. Return it as `to_sender`. If `client->text()` returns `false`, the frame was
   not queued; log it. `setCloseClientOnQueueFull(true)` (8.5) closes the
   connection in that case, so the client recovers by reconnecting.
5. Decided values are read back **after** the apply loop, never from what
   `on_set` intended.

The no-op case still sends the ack, and therefore needs no broadcast.

**Rejections and `type:"error"`:** a correlated rejection is reported only in
the ack's `e`; no second message. The client composes the visible text from the
field labels it already has (`"Rejected: Pin Number"`). Batch-level failures
where a batch exists but nothing can be applied (e.g. `data` is not an object)
send the ack **and** a `type:"error"` message. Unparsable input has no readable
`i`, so it sends `type:"error"` alone. The save path's
`"on_set rejected g.k"` string and its non-2xx response are unchanged
(`tests/native/test_save_body.c:75`).

### 8.3 Rejection stays abort-on-first

`prsl_apply_body` stops at the first rejection (`src/prsl_body.c:17`). That is
unchanged in 0.9.0, for the WS apply path and for Save alike. A batch is
therefore prefix-applied: fields before the bad one were written, fields after
it were never attempted, and `e` names at most one key.

This is safe with a dense `d` (§7.2): the keys after the rejection are reported
with their current stored values, so the client adopts those values and does not
mistake "never attempted" for "applied as sent". Because the browser sends one
field per apply, a mixed batch cannot originate here anyway.

Continuing past a rejection to report every failing key is a real improvement,
but it is independent of the wire change and moves to the backlog (§12).

Also fix the `no on_set` branch (`src/prsl_body.c:52-59`) so the ack reports what
the store actually holds, rather than assuming the write succeeded.

### 8.4 `action: "sync"`

Build `prsl_build_settings_payload(g_store)`, add the requester's `i` to the
root object, and return it as `to_sender`. Because it is request-scoped, the
glue uses `client->text()`; never `textAll`.

### 8.5 Queue policy

On `WS_EVT_CONNECT`, call `client->setCloseClientOnQueueFull(true)`
(`AsyncWebSocket.h:254` — the exact name, not `setCloseWhenFull`). A client that
cannot keep up is disconnected and reconnects (the page already does this with
backoff, `app.js:250-264`) instead of silently losing messages. 32 queued
messages on ESP32 is roughly 96 seconds of unread 3-second status broadcasts, so
this fires only for a genuinely stalled reader.

### 8.6 Reentrancy and locking

The apply path does not take the store mutex today, while `prsl_push` does
(`src/prsl.cpp:797`). Each field write is individually locked, so the ack's `d`
is consistent per field but is not a snapshot across fields; a concurrent write
can land between them. The following push repairs it. This is pre-existing and
is tracked with the `prsl_stop()` quiescing item; 0.9.0 does not widen it, does
not fix it, and must not rely on the ack being an atomic snapshot.

---

## 9. Client changes

### 9.1 New state

```js
var nextId = 1;        // per connection; reset on connect
var pending = {};      // id -> {keys:[], sent:{key:value}, retried:bool, timer}
var recovering = {};   // key -> {sent:value, retried:bool}
var syncId = 0;        // id of the outstanding sync; 0 = none
var syncTimer = null;
```

`i` is a plain incrementing number. Do not mask it to 8 or 16 bits — wrap would
break "a higher ack settles lower batches". Batch ids and the sync id come from
the same counter, so they never collide.

### 9.2 Sending

`sendToServer(key, value)` assigns `i = nextId++`, records
`pending[i] = {keys:[key], sent:{...}, retried:false}`, starts the batch timer
(`ack_timeout_ms`), and sends. The recovery ladder passes `retried = true` when
it re-sends (§9.5). `lastSent`/`inFlight` behavior is unchanged.

### 9.3 On ack — settles the batch, not the value

```
onAck(msg):
  id = msg.i
  // Acks are ordered on a live connection, so a gap means the server did not
  // answer — not that the missing one is still coming.
  for every pending k < id: settleLower(k)
  settle(id, msg)

settleLower(k):
  // No decided values for these; nothing was written if the server skipped them,
  // and the broadcast that follows carries anything that was.
  clear timer; delete pending[k]
  for each key: inFlight[key] = false; lastSent[key] = AV

settle(id, msg):
  batch = pending[id]; if (!batch) return      // unknown, duplicate, too late
  clear timer; delete pending[id]
  for each key in batch.keys:
    inFlight[key] = false
    if (msg.e && msg.e[key]) {                 // rejected
      lastSent[key] = AV                       // AV did not change
      writeBack(key, batch.sent[key], AV)      // revert if untouched
      reportRejected(key)
    } else if (msg.d && key in msg.d) {        // applied, possibly transformed
      AV = msg.d[key]
      lastSent[key] = AV
      writeBack(key, batch.sent[key], AV)
    } else {                                   // omitted: no value to report
      lastSent[key] = AV
    }
  setBaseline(); updateUI()
  flushQueued()                                // existing Case-7 re-send
  maybeSync()
```

`lastSent[key] = AV` on every settled key is not cosmetic. If it kept the value
we sent, a transform would leave `lastSent` behind the widget and the next blur
would re-send the decided value — an extra apply, and a loop for any transform
that is not a fixed point. On rejection it is what makes the field retryable:
retyping the rejected value now differs from `lastSent` and sends again.

`writeBack(key, sent, decided)` writes `decided` into the widget **only if the
widget still holds `sent`** — i.e. the user has not typed since the send. If the
user has typed, the widget is left alone and the existing queued-input flush
sends the newer value. Either way `AV` and `lastSent` become `decided`.

This is silent acceptance, deliberately: transform and discard both resolve to
the store's value with no prompt. The user's only signal is the value changing.
Help text and HTML validation are the dev-side tools to prevent surprise.

### 9.4 Recovery is fed by any authoritative value set

The recovery ladder does not care *how* it learns the store's contents. It needs
one function fed by two sources:

- the reply to `sync`, identified by `i === syncId`;
- an ordinary `type:"settings"` push.

This matters because of ordering. In the transform-plus-lost-ack case, the
broadcast produced by the original apply is queued behind the ack that was lost,
so it arrives *after* the timeout, with nothing in flight. If only the sync reply
were exempt from classification, that push would be treated as an external
update: `av != oldAV`, `fv == sent`, so the user gets a Load/Keep prompt for a
change they just made — the anti-goal in §4.

So the exemption belongs to the keys, not to the message:

```
onSettings(msg):
  apply _meta                      // before the guard
  isReply = msg.i && msg.i === syncId
  if (isReply) { syncId = 0; clearTimeout(syncTimer) }
  else if (any batch pending) return          // existing drop, unchanged
  for each key not in flight: AV = msg.data[key]   // in-flight keys keep theirs
  for each key in recovering: resolveRecovering(key, AV)
  normal change detection for the rest

resolveRecovering(key, AV):
  lastSent[key] = AV               // may now equal `sent`, or may differ
  if widget no longer holds recovering[key].sent: delete; return
  if String(AV) === String(recovering[key].sent): delete; return
  if (!recovering[key].retried):
    recovering[key].retried = true; delete
    sendToServer(key, recovering[key].sent, true)  // it did not land; one retry
  else:
    writeBack(key, recovering[key].sent, AV)       // transformed or dropped
    delete

// after the loop
maybeSync()
```

Two details:

- `lastSent[key] = AV` for the same reason as on ack. A timeout set it to the
  pre-recovery applied value, so without this a key whose change *did* land would
  compare unequal to `lastSent` and be re-sent on the next blur.
- Keys with a batch in flight are skipped. The sync reply is exempt from the
  global drop (it must be, or a new edit during recovery would swallow it), but
  it is still older than that batch, so its values are ignored for those keys.

Acks and sync replies bypass the guard at `app.js:436`; ordinary pushes keep the
current drop-while-in-flight behavior, which is safe because a push is full
state and the ack has already settled the client's own keys. Batches no longer
block each other: batch 7 settles while batch 8 is still pending.

Additional hardening: apply `_meta` (dirty, show_reset, show_reboot, uploading)
**before** the guard, so a pending batch cannot stall the Save button.

### 9.5 Timeout, sync, and a single bounded resend

Per-batch timer, `ack_timeout_ms` (default 5000, §10):

```
onTimeout(id):
  batch = pending[id]; if (!batch) return       // already settled
  clear timer; delete pending[id]
  for key in batch.keys:
    inFlight[key] = false
    lastSent[key] = AV
    // `retried` rides on the batch so it survives the resend: on the retry's
    // timeout this key must NOT become resendable again.
    recovering[key] = {sent: batch.sent[key], retried: batch.retried}
  maybeSync()

maybeSync():
  if (syncId) return                            // one sync at a time
  if (pending not empty) return                 // defer until it drains
  if (recovering is empty) return
  syncId = nextId++
  syncTimer = setTimeout(onSyncTimeout, ack_timeout_ms)
  ws.send('{"action":"sync","i":' + syncId + '}')

onSyncTimeout():
  // The reply never came. Terminal: leave the typed values unsent.
  syncId = 0; recovering = {}
```

`maybeSync()` is called from every settle path — ack, timeout, and any
authoritative value set (sync reply or ordinary push) — so a sync deferred
because another batch was pending still fires once that batch settles, by ack or
by its own timeout.

The bounds, per user edit:

- **At most one resend per key.** `retried` is the loop breaker and it travels
  with the batch, not the `recovering` entry: the resend deletes that entry, so
  the flag has to ride on the new pending batch to come back on the retry's
  timeout. That is why `sendToServer` takes it. One resend means **two sends in
  total** — the original and the retry — never three.
- **At most one sync outstanding**, and an unanswered sync is terminal.
- **At most one read per send.** A key can enter `recovering` at most twice
  (after the original send, then after its single retry), and each entry resolves
  from at most one authoritative value set. The first read decides whether to
  resend; the second finds out whether the resend landed. That second read is not
  a second chance to resend — it is the only way to learn the retry's outcome,
  because the retry's own broadcast is emitted while the batch is still in
  flight and is dropped by the guard:

  ```
  edit → send #1 → timeout → read → "not landed" → resend (send #2)
       → timeout → read → "not landed" → adopt store value, stop
  ```

  Either read may be satisfied by an ordinary push instead of the sync reply
  (§9.4), so the ladder often finishes without a `sync` at all.

There is deliberately no `syncTries` counter. An earlier draft capped it at 2 as
belt and braces; `retried` plus the sync timeout already make the ladder finite,
and a third state variable only adds a way to get it wrong.

Resending is gated on the sync: the store must disagree with what was sent. That
is evidence, not a guess.

**Why one retry rather than blind retry.** A timeout cannot distinguish "never
arrived" from "applied, reply lost". The sync removes most of that ambiguity: if
the store holds the sent value, it landed and no resend is needed. It does mean
`on_set` can be called twice for one value, which is already true on every
reconnect — documented as a firmware rule.

### 9.6 Reconnect

On close/connect: clear all batch timers, reset `nextId = 1`, and clear
`pending`, `recovering`, `syncId`, and `syncTimer`. Identifiers
mean nothing across connections, so a new connection's `i = 1` must not be
mistaken for an old ticket. The existing reconnect reconciliation
(`app.js:437-458`) stays as-is for the initial load case.

### 9.7 Revisions to the ten-case table

The 2026-06-18 table describes echo resolution by value (Cases 6-7) and
"ignore packets while in flight" (Cases 8-10). With acks:

| Old case | 0.9.0 behavior |
|---|---|
| 6 Echo Received | Replaced by **Ack Received** (§9.3). No value comparison. |
| 7 Echo + queued input | Same outcome, driven by the ack: after settling, if the widget differs from `lastSent`, the existing queued-input path re-sends. |
| 8-10 Ignore while in flight | Unchanged for pushes. Acks bypass the guard, so batches no longer block each other. |
| — | **New: Ack with a different value.** Silent acceptance; write back if untouched. |
| — | **New: Ack with an error.** Revert that key, show the message, keep it retryable. |
| — | **New: Batch timeout.** §9.5 recovery ladder. |

The `FV`/`LS`/`AV`/`inFlight` definitions are unchanged.

---

## 10. Configuration

Add to `parasol_config.json`:

```json
{ "ack_timeout_ms": 5000 }
```

Flow: `scripts/generate_assets.py` substitutes it into
`<meta name="parasol-ack-timeout" content="{{ACK_TIMEOUT_MS}}">`, and `app.js`
reads it exactly like `always-show-save` (`app.js:141`). Default 5000 ms; a
missing or non-numeric tag falls back to 5000 in `app.js`.

Exposed because `on_set` is allowed to block (a Wi-Fi scan, an SD write), and a
blocking callback delays the ack. It is the same rationale as the upload
`idle_timeout_ms`. **Not** exposed: the retry count (one, by protocol policy) and
per-field timeouts (they would travel in every field's `opts` forever for a rare
need).

A too-small timeout degrades visibly: the late ack is unknown, the late push
arrives with nothing in flight, and the user's own change reads as an external
update (Load/Keep). Documented so the symptom is recognizable.

---

## 11. Testing

### 11.1 Unit (`tests/unit/app.test.js`, vitest + jsdom)

- Ack settles: clears `inFlight`, sets AV and `lastSent`, deletes `pending`.
- Transform (`d != sent`): widget rewritten when untouched; no notification; the
  widget is not re-sent on the next blur (`lastSent` is the decided value).
- Transform while the user has typed: widget untouched, typed value queued.
- Same-value (`d == sent`): no widget write, no notification.
- Key absent from `d` (unknown key): AV unchanged, no notification.
- Reject (`e`): key reverted to AV, error shown, field retryable on next blur —
  including retyping the exact rejected value.
- Higher ack settles lower batches; a gap leaves no pending entry.
- Unknown/duplicate id ignored.
- Ack bypasses the guard: settles while another batch is pending.
- `_meta` applied while a batch is pending.
- A settings push without `i` is not treated as a sync reply.
- A settings push with `i != syncId` keeps normal external/conflict handling.
- **A broadcast while a key is `recovering` resolves it (transform case) with no
  Load/Keep prompt.**
- **A broadcast that arrives while a batch is pending does not settle that
  batch's keys.**
- Timeout: `inFlight` cleared, `lastSent` reset to AV, field can be sent again.
- Timeout → sync sent only when `pending` is empty.
- Deferred sync fires when the last pending batch settles by ack.
- Read reply: landed → no resend and `lastSent` catches up; not landed → exactly
  one resend; after retry → adopt and stop; user typed meanwhile → no resend.
- A timed-out retry keeps `retried = true` (no unbounded resend).
- Sync timeout → terminal: `recovering` cleared, typed values left unsent.
- Reconnect resets ids, pending, recovering, timers.
- `ack_timeout_ms` read from the meta tag, with the fallback.

### 11.2 Native (`tests/native`)

Possible only because of the extraction in §8.1. Feed JSON to `prsl_ws_handle()`
and inspect the three reply strings.

- WS apply and Save both abort on the first rejection
  (`test_save_body.c` unchanged).
- A rejected batch still acks, with `e` naming exactly one key, and the keys after
  it reported in `d` with their unchanged store values.
- Ack `d` reflects the store after `on_set`, including a transform and a
  no-write accept.
- `d` includes a key whose `on_set` wrote nothing (resolves to the old value).
- Omits unknown keys.
- An apply without `i`, or with a non-numeric one, is a protocol error: nothing
  applied, nothing broadcast, `error` set, `to_sender` empty.
- A no-op batch still produces an ack.
- A correlated rejection produces `e` and **no** `to_sender` error message.
- A non-object `data` with a valid `i` produces both an ack and an error.
- `sync` returns a settings payload carrying the requester's `i`, with
  `to_all` empty.

### 11.3 E2E + test server

`test_server/main.py` must mirror the contract or the suite proves nothing:
echo `i`, send the ack with `d`/`e`, implement `action:"sync"` to one client, and
keep abort-on-first. Add fixture fields that transform, discard, and reject.
Close the existing `_show_reset` fidelity item in the same pass.

Playwright: transform shows the decided value with no prompt; reject leaves the
field retryable; the page stays responsive after a transform (other fields and
the Save button still update).

### 11.4 Budget

Measure `app.min.js` min+gzip delta. Target ≤ +1.0 KB gzip; review at +1.5 KB.
Regenerate `app.min.js` and `prsl_assets.c`; the CI drift check must pass.

---

## 12. Docs, versioning, and follow-ups

| File | Change |
|---|---|
| `WS_PROTOCOL.md` | `i` on apply, `type:"ack"`, `action:"sync"`, mandatory-ack rule, per-connection ids, recovery ladder, queue policy. Link the state machine here instead of the June spec. |
| `API_REFERENCE.md` | Replace the sharp-edge block (:434-439) with the new guarantee. Add: `on_set` must be idempotent; store values the widget can display; WS apply and Save both abort on the first rejection. |
| `2026-06-18-unified-settings-design.md` | Two-line "superseded in 0.9.0" header pointing here. Kept for history. |
| `2026-09-02-architectural-decisions-design.md` | One line on the deferred section: resolved in 0.9.0, pointer here. |
| `README.md`, `CHANGELOG.md`, `library.json` | Sharp-edge wording removed, 0.9.0 entry, version bump. |
| `docs/BACKLOG.md` | **Tick** the echo-correlation item as done with the version and a pointer to this spec; add the follow-ups below as new open items. Keep the entry — it is release history. |
| `AGENTS.md` | Note that pre-1.0 semver puts breaking wire/API changes in the minor bucket. (Done.) |

**Definition of done for the backlog:** the item under "1.0 contract and release"
reads `[x] **Client echo-correlation gap** — fixed in 0.9.0 (ack correlation;
see 2026-11-11-client-ack-correlation-design.md)`, and the `0.9.0` step in the
release sequence notes that it shipped.

Deferred follow-ups to record in the backlog:

- **Continue past a rejection on the WS apply path.** Today the first rejection
  aborts the batch and leaves the tail fields unattempted. Reporting every
  failing key instead is a good fix, but it is independent of the wire change
  and does not block 0.9.0 (dense `d` already keeps the tail coherent).
- A "server adjusted this" notice (client-derived from `d` vs `sent`; no wire
  change). Deliberately not in 0.9.0 — silent acceptance chosen.
- A fire-and-forget action field type, so one-shot actions stop wearing a value
  field's clothes.
- `_meta.v` device-wide version, only if the guard proves to drop pushes.
- Per-field timeout, only if someone asks.
- Server-side last-processed-ticket memory — would make automatic resend
  provably safe; rejected for 0.9.0 to keep the device stateless.

---

## 13. Left to the builder

- Where the single rejected key is captured (the existing `prsl_rejection_t` is
  enough) and how it is copied into `e`.
- Whether the ack is built field by field during the apply loop or in a second
  pass over the batch.
- Where `writeBack` lives and how it maps a decided value onto each widget type
  (select/radio need the option lookup; checkbox needs the indeterminate case).
- Test-server fixture design for transform/discard/reject.
- Whether `ack_timeout_ms` also gets a debug log line when it fires.
- The wording of the "Rejected: <label>" status-bar message — the client has
  labels, the server only has keys.
