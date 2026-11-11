import json
import time
import asyncio
import threading
from pathlib import Path
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response

app = FastAPI()

BASE = Path(__file__).resolve().parent.parent
FIXTURES = BASE / "test-deps" / "fixtures"

# Build-time template values (mirrors parasol_config.json)
PARASOL_TITLE = "PARASOL"
PARASOL_LOGO = "/logo.png"
PARASOL_FAVICON = "/favicon.ico"

# Schema definition — mirrors the Phase 4 settings format
# Each top-level key is a group. Each group has field definitions:
# {field_key: [type, label, opts]}
SETTINGS = {
    "wifi": {
        "label": "Wi-Fi",
        "ssid": ["text", "SSID", {"attrs": {"maxlength": 32, "placeholder": "MyNetwork", "required": True}, "value": "MyNetwork", "help": "WiFi network name — required, 1–32 characters"}],
        "password": ["password", "Password", {"attrs": {"maxlength": 64, "placeholder": "Enter password", "required": True}, "value": "", "help": "WiFi password — required, up to 64 characters"}],
        "mode": ["select", "Mode", {"options": [["station", "Station"], ["ap", "Access Point"]], "value": "station", "help": "WiFi operating mode: Station or Access Point"}],
        "hidden": ["switch", "Hidden SSID", {"value": False, "help": "Hide network from scans"}],
        "channel": ["range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "value": 6, "help": "WiFi channel 1–13"}],
    },
    "gpio": {
        "pin": ["number", "Pin Number", {"attrs": {"min": 0, "max": 39, "placeholder": "0"}, "value": 2, "help": "GPIO pin number 0–39"}],
        "direction": ["select", "Direction", {"options": [["input", "Input"], ["output", "Output"]], "value": "output", "help": "Pin direction: Input or Output"}],
        "pull": ["radio", "Pull Resistor", {"options": [["none", "None"], ["up", "Pull Up"], ["down", "Pull Down"]], "value": "none", "help": "Internal pull resistor: None, Pull Up, or Pull Down"}],
        "enabled": ["checkbox", "GPIO Enabled", {"value": True, "help": "Enable this GPIO pin"}],
        "inverted": ["checkbox", "Inverted", {"value": False, "help": "Invert GPIO signal level"}],
        "led_color": ["color", "LED Color", {"value": "#ff9500", "help": "RGB LED color"}],
        "initial": ["select", "Initial State", {"options": [["low", "Low"], ["high", "High"]], "value": "low", "help": "Initial output state: Low or High"}],
    },
    "mqtt": {
        "broker":      ["text", "Broker URL",   {"attrs": {"required": True, "pattern": r"^(mqtts?|tcp|ssl|ws|wss)://[a-zA-Z0-9_\-]+(:\d{1,5})?$", "placeholder": "mqtt://broker.local:1883"}, "value": "mqtt://broker-local:1883", "help": "MQTT broker URL — required, start with protocol://host"}],
        "client_id":   ["text", "Client ID",    {"attrs": {"required": True, "minlength": 3, "maxlength": 64, "pattern": r"^[a-zA-Z0-9_\-]+$"}, "value": "esp32-001", "help": "Unique client ID — required, 3–64 chars, alphanumeric, _ or -"}],
        "topic_prefix":["text", "Topic Prefix",  {"attrs": {"maxlength": 128, "pattern": r"^[a-zA-Z0-9_\/.#+\-]*$", "placeholder": "home/esp32"}, "value": "home/esp32", "help": "MQTT topic prefix — up to 128 chars, letters, numbers, / . # + -"}],
        "keepalive":   ["number", "Keepalive (s)", {"attrs": {"min": 1, "max": 65535, "step": 5}, "value": 56, "help": "Keepalive interval in seconds — 1–65535, steps of 5"}],
        "qos":         ["select", "QoS Level",  {"options": [["0", "0 — At most once"], ["1", "1 — At least once"], ["2", "2 — Exactly once"]], "value": "1", "help": "Quality of Service — 0: at most once, 1: at least once, 2: exactly once"}],
        "retain":      ["switch", "Retain",     {"value": False, "help": "Retain last message on broker"}],
    },
    "notifications": {
        "host":         ["text", "SMTP Host",       {"attrs": {"required": True, "minlength": 5, "pattern": r"^[a-zA-Z0-9]([a-zA-Z0-9_\-]*[a-zA-Z0-9])?$", "placeholder": "smtp.gmail.com"}, "value": "smtp-example-com", "help": "SMTP server hostname — required, 5+ characters"}],
        "port":         ["number", "SMTP Port",     {"attrs": {"min": 1, "max": 65535}, "value": 587, "help": "SMTP server port — 1–65535"}],
        "sender":       ["email", "Sender Email",   {"attrs": {"required": True, "placeholder": "esp32@example.com"}, "value": "esp32@example.com", "help": "From address for alerts — required, valid email"}],
        "recipient":    ["email", "Recipient Email",{"attrs": {"required": True, "placeholder": "admin@example.com"}, "value": "admin@example.com", "help": "Alert destination address — required, valid email"}],
        "min_interval": ["range", "Min Interval (s)", {"attrs": {"min": 30, "max": 3600, "step": 30}, "value": 300, "help": "Minimum time between alerts — 30–3600s, steps of 30"}],
        "enabled":      ["switch", "Alerts Enabled", {"value": False, "help": "Enable email notifications"}],
        "confirm":      ["checkbox", "Confirm Alerts", {"value": None, "help": "Explicitly enable or disable alerts"}],
    },
    "audio": {
        "label": "Audio",
        "clip": ["file", "Clip", {
            "value": "none", "accept": ".mp3,audio/*",
            "max_size": 1024 * 1024, "help": "MP3, up to 1 MiB",
        }],
    },
    "config": {
        "label": "Config",
        "file": ["file", "Config file", {
            "value": "none", "accept": ".json,application/json",
            "max_size": 8 * 1024, "help": "JSON config, up to 8 KiB",
        }],
    },
}

STATUS = {
    "system": {
        "uptime":     ["text", "Uptime",     {"value": None}],
        "fw_version": ["select", "Firmware", {"options": [["2.0.0","2.0.0"],["2.1.0","2.1.0"],["2.2.0-beta","2.2.0-beta"]], "value": "2.1.0"}],
        "led":        ["switch", "LED",      {"value": True, "help": "System LED indicator"}],
    },
    "network": {
        "mode":       ["radio", "Mode",      {"options": [["auto","Auto"],["manual","Manual"],["safe","Safe"]], "value": "auto", "help": "Network operation mode"}],
        "signal":     ["range", "Signal",    {"attrs": {"min": 0, "max": 100, "step": 1}, "value": None, "help": "Signal strength %"}],
        "connection": ["select", "Connection",{"options": [["connected","Connected"],["disconnected","Disconnected"],["error","Error"]], "value": "connected"}],
    },
    "sensors": {
        "temperature": ["number", "Temperature", {"value": None, "help": "Celsius"}],
    },
}

nvs_store: dict[str, object] = {}
applied_store: dict[str, object] = {}
status_store: dict[str, object] = {}
start_time = time.time()
connected: set[WebSocket] = set()
_dirty: bool = False

# ── Upload state (mirrors the device's PRSL_FILE upload contract) ──────────
UPLOAD_DIR = BASE / "test-results" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# group.key -> committed bytes path
FINAL_PATHS = {
    "audio.clip": UPLOAD_DIR / "audio" / "clip",
    "config.file": UPLOAD_DIR / "config" / "file",
}
for p in FINAL_PATHS.values():
    p.parent.mkdir(parents=True, exist_ok=True)
COMMITTED = {k: (p if p.exists() else None) for k, p in FINAL_PATHS.items()}

# Fixed on-disk label once a file field has committed bytes (mirrors the
# device's on_get returning the stored filename).
COMMITTED_LABELS = {"audio.clip": "clip.mp3", "config.file": "config.json"}

_uploading = False
_upload_put_count = 0
_upload_aborted = set()
_pending = {}  # group.key -> temp Path
_upload_delay_ms = 0
_upload_timeout_ms = 0


@app.on_event("startup")
async def startup():
    for group_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            if key == "label":
                continue
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = group_id + "." + key
            nvs_store[store_key] = val
            applied_store[store_key] = val
    for group_id, fields in STATUS.items():
        for key, field_def in fields.items():
            if key == "label":
                continue
            opts = field_def[2]
            val = opts.get("value")
            if val is not None:
                store_key = group_id + "." + key
                status_store[store_key] = val
    asyncio.ensure_future(status_broadcaster())


def build_settings():
    result = {}
    for group_id, fields in SETTINGS.items():
        group = {}
        for key, field_def in fields.items():
            if key == "label":
                continue
            ftype, flabel, fopts = field_def
            opts = dict(fopts)
            store_key = group_id + "." + key
            if store_key in applied_store:
                opts["value"] = applied_store[store_key]
            group[key] = [ftype, flabel, opts]
        result[group_id] = group
    return result


def build_status():
    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)
    days = hours // 24
    seconds = int(elapsed % 60)
    uptime_str = f"{days}d {hours % 24}h {minutes % 60}m {seconds}s"

    result = {}
    for group_id, fields in STATUS.items():
        group = {}
        for key, field_def in fields.items():
            if key == "label":
                continue
            ftype, flabel, fopts = field_def
            opts = dict(fopts)
            if key == "uptime":
                opts["value"] = uptime_str
            elif key == "signal":
                opts["value"] = str(50 + int(elapsed * 5) % 50)
            elif key == "temperature":
                opts["value"] = str(round(23.5 + (int(elapsed) % 10) * 0.1, 1))
            else:
                store_key = group_id + "." + key
                opts["value"] = status_store.get(store_key, opts.get("value", ""))
            group[key] = [ftype, flabel, opts]
        result[group_id] = group
    return result


def settings_message():
    # 0.8.0 starts the _meta box; legacy aliases stay for one release.
    # _show_reset is device semantics (callback presence), so True.
    meta = {
        "dirty": _dirty,
        "show_reset": True,
        "show_reboot": True,
        "uploading": _uploading,
    }
    return {
        "type": "settings",
        "_meta": meta,
        "_dirty": meta["dirty"],
        "_show_reset": meta["show_reset"],
        "_show_reboot": meta["show_reboot"],
        "data": build_settings(),
    }


async def broadcast_settings():
    payload = settings_message()
    for client in list(connected):
        try:
            await client.send_json(payload)
        except Exception:
            connected.discard(client)


async def status_broadcaster():
    while True:
        await asyncio.sleep(3)
        try:
            payload = build_status()
        except Exception:
            continue
        for client in list(connected):
            try:
                await client.send_json({"type": "status", "data": payload})
            except Exception:
                connected.discard(client)



@app.post("/api/settings/save")
async def api_settings_save(request: Request):
    if _uploading:
        return PlainTextResponse("Upload in progress", status_code=409)
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for group_id, fields in data.items():
        if group_id.startswith("_"):
            continue
        schema = SETTINGS.get(group_id)
        if not schema:
            continue
        for key, field_def in fields.items():
            if not isinstance(field_def, list) or len(field_def) < 3:
                continue
            s_entry = schema.get(key)
            if s_entry is not None and s_entry[0] == "file":
                continue  # PRSL_FILE: labels only change via the upload path
            opts = field_def[2]
            if "value" in opts:
                store_key = group_id + "." + key
                nvs_store[store_key] = opts["value"]
                applied_store[store_key] = opts["value"]
    global _dirty
    # Promote deferred uploads to their committed path before clearing dirty.
    for store_key, tmp in list(_pending.items()):
        final = FINAL_PATHS[store_key]
        try:
            final.write_bytes(tmp.read_bytes())
        except OSError:
            pass
        COMMITTED[store_key] = final
        try:
            tmp.unlink()
        except OSError:
            pass
        label = COMMITTED_LABELS.get(store_key)
        if label is not None:
            nvs_store[store_key] = label
            applied_store[store_key] = label
    _pending.clear()
    _dirty = False
    await broadcast_settings()
    return {}



@app.websocket("/api/events")
async def events_ws(ws: WebSocket):
    await ws.accept()
    connected.add(ws)
    global _dirty
    try:
        await ws.send_json({"type": "status", "data": build_status()})
        await ws.send_json(settings_message())
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            if msg.get("action") == "apply":
                for group_key, fields in msg.get("data", {}).items():
                    for field_key, field_arr in fields.items():
                        schema_entry = SETTINGS.get(group_key, {}).get(field_key)
                        if schema_entry is None:
                            continue
                        _, _, opts = schema_entry
                        if schema_entry[0] == "file":
                            continue  # PRSL_FILE: labels only change via upload
                        store_key = group_key + "." + field_key
                        applied_store[store_key] = field_arr[2]["value"]
                _dirty = any(applied_store.get(k) != nvs_store.get(k) for k in applied_store)
                await broadcast_settings()
    except WebSocketDisconnect:
        pass
    finally:
        connected.discard(ws)


@app.post("/api/system/reboot")
async def api_system_reboot():
    if _uploading:
        return PlainTextResponse("Upload in progress", status_code=409)
    for client in list(connected):
        try:
            await client.close()
        except Exception:
            pass
    connected.clear()
    return {"ok": True}


@app.post("/api/settings/external-change")
async def external_change(body: dict):
    """Simulate an external config change (for e2e testing of server-push)."""
    for group_key, fields in body.items():
        if group_key not in SETTINGS:
            continue
        for field_key, field_arr in fields.items():
            store_key = group_key + "." + field_key
            if store_key in applied_store:
                nvs_store[store_key] = field_arr[2]["value"]
                applied_store[store_key] = field_arr[2]["value"]
    await broadcast_settings()
    return {"ok": True}


@app.post("/api/settings/set-dirty")
async def api_set_dirty(body: dict):
    global _dirty
    _dirty = body.get("dirty", True)
    return {"ok": True}


@app.post("/api/settings/external-status-change")
async def external_status_change(body: dict):
    """Simulate an external status update (for e2e testing)."""
    for group_key, fields in body.items():
        if group_key not in STATUS:
            continue
        for field_key, field_arr in fields.items():
            store_key = group_key + "." + field_key
            status_store[store_key] = field_arr[2]["value"]
    payload = build_status()
    for client in list(connected):
        try:
            await client.send_json({"type": "status", "data": payload})
        except Exception:
            connected.discard(client)
    return {"ok": True}


@app.post("/api/settings/apply")
async def api_settings_apply(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    for group_key, fields in data.items():
        schema_entry = SETTINGS.get(group_key)
        if not schema_entry:
            continue
        for field_key, field_arr in fields.items():
            if not isinstance(field_arr, list) or len(field_arr) < 3:
                continue
            s_entry = schema_entry.get(field_key)
            if s_entry is not None and s_entry[0] == "file":
                continue  # PRSL_FILE: labels only change via the upload path
            store_key = group_key + "." + field_key
            applied_store[store_key] = field_arr[2].get("value", "")
    global _dirty
    _dirty = True
    return {}


@app.api_route("/api/settings/reset", methods=["GET", "POST"])
async def api_settings_reset():
    global _dirty
    if _uploading:
        return PlainTextResponse("Upload in progress", status_code=409)
    nvs_store.clear()
    applied_store.clear()
    # Discard any deferred (pending) uploads.
    for p in _pending.values():
        try:
            p.unlink()
        except OSError:
            pass
    _pending.clear()
    for group_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            if key == "label":
                continue
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = group_id + "." + key
            if field_def[0] == "file":
                # A committed file keeps its label; otherwise restore "none".
                if COMMITTED.get(store_key) is not None:
                    val = COMMITTED_LABELS.get(store_key, "none")
                else:
                    val = "none"
            nvs_store[store_key] = val
            applied_store[store_key] = val
    _dirty = False
    await broadcast_settings()
    return {}


# ── Upload validation (mirrors prsl_upload.c rules) ─────────────────────────

def _valid_name(name):
    if not name:
        return False
    if len(name) >= 128:
        return False
    if name in (".", ".."):
        return False
    for ch in name:
        if ch == "/" or ch == "\\":
            return False
        o = ord(ch)
        if o < 0x20 or o == 0x7F:
            return False
    return True


def _entry_match(entry, name, mime):
    if not entry:
        return False
    if entry[0] == ".":
        return name.lower().endswith(entry.lower())
    if entry == "*/*":
        return True
    if not mime:
        return False
    if "/" not in entry:
        return False
    if entry.endswith("*"):
        prefix = entry[:-2]  # drop trailing '*' and '/'
        if not prefix:
            return False
        return mime.lower().startswith(prefix.lower()) and len(mime) > len(prefix) and mime[len(prefix)] == "/"
    return mime.lower() == entry.lower()


def _accept_match(accept, name, mime):
    if not accept:
        return True
    if not name:
        return False
    for entry in accept.split(","):
        if _entry_match(entry.strip(), name, mime):
            return True
    return False


def _validate_upload(field_def, name, mime, size):
    ftype, _, opts = field_def
    accept = opts.get("accept", "")
    max_size = opts.get("max_size", 0)
    if ftype != "file":
        return (False, 400, "Invalid field")
    if not _valid_name(name):
        return (False, 400, "Invalid name")
    if size == 0:
        return (False, 400, "Empty file")
    if max_size and size > max_size:
        return (False, 413, "File too large")
    if not _accept_match(accept, name, mime):
        return (False, 415, "File type not allowed")
    return (True, 200, "OK")


@app.post("/api/upload/{group}/{key}")
async def api_upload_preflight(group: str, key: str, request: Request):
    field_def = SETTINGS.get(group, {}).get(key)
    if field_def is None or field_def[0] != "file":
        return PlainTextResponse("Unknown field", status_code=404)
    if _uploading:
        return PlainTextResponse("Upload in progress", status_code=409)
    try:
        meta = await request.json()
    except Exception:
        return PlainTextResponse("Invalid metadata", status_code=400)
    if not isinstance(meta, dict):
        return PlainTextResponse("Invalid metadata", status_code=400)
    name = meta.get("name")
    size = meta.get("size")
    mime = meta.get("type")
    if not isinstance(name, str):
        return PlainTextResponse("Invalid metadata", status_code=400)
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0 or size >= 4294967296:
        return PlainTextResponse("Invalid metadata", status_code=400)
    if mime is not None:
        if not isinstance(mime, str):
            return PlainTextResponse("Invalid metadata", status_code=400)
        if mime == "":
            mime = None
    ok, status, msg = _validate_upload(field_def, name, mime, size)
    if not ok:
        return PlainTextResponse(msg, status_code=status)
    return PlainTextResponse("OK", status_code=200)


@app.put("/api/upload/{group}/{key}")
async def api_upload_put(group: str, key: str, request: Request,
                         name: str = "upload", type: str = ""):
    global _uploading, _upload_put_count, _dirty
    store_key = group + "." + key

    if "content-length" not in request.headers:
        return PlainTextResponse("Content-Length required", status_code=411)
    if request.headers.get("content-type", "") != "application/octet-stream":
        return PlainTextResponse("Expected application/octet-stream", status_code=415)

    field_def = SETTINGS.get(group, {}).get(key)
    if field_def is None or field_def[0] != "file":
        return PlainTextResponse("Unknown field", status_code=404)

    if _uploading:
        return PlainTextResponse("Upload in progress", status_code=409)

    mime = type if type else None
    try:
        size = int(request.headers["content-length"])
    except (KeyError, ValueError):
        return PlainTextResponse("Content-Length required", status_code=411)
    ok, status, msg = _validate_upload(field_def, name, mime, size)
    if not ok:
        return PlainTextResponse(msg, status_code=status)

    _uploading = True
    _upload_put_count += 1
    _upload_aborted.discard(store_key)
    await broadcast_settings()

    try:
        if _upload_delay_ms:
            await asyncio.sleep(_upload_delay_ms / 1000)
        body = await request.body()
        if await request.is_disconnected():
            _upload_aborted.add(store_key)
            return PlainTextResponse("Upload aborted", status_code=499)
    except Exception:
        _upload_aborted.add(store_key)
        return PlainTextResponse("Upload failed", status_code=499)
    finally:
        _uploading = False
        await broadcast_settings()

    if store_key == "config.file":
        # Immediate commit.
        final = FINAL_PATHS[store_key]
        final.write_bytes(body)
        COMMITTED[store_key] = final
        nvs_store[store_key] = name
        applied_store[store_key] = name
    else:
        # Deferred: hold a temp until Save promotes it.
        tmp = UPLOAD_DIR / group / (key + ".tmp")
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(body)
        _pending[store_key] = tmp
        applied_store[store_key] = name + " (pending)"
        _dirty = True
    await broadcast_settings()
    return PlainTextResponse("OK", status_code=200)


@app.post("/api/test/reset-uploads")
async def api_test_reset_uploads():
    global _uploading, _upload_put_count, _upload_aborted, _pending, _upload_delay_ms, _upload_timeout_ms, _dirty
    _uploading = False
    _upload_put_count = 0
    _upload_aborted = set()
    for p in _pending.values():
        try:
            p.unlink()
        except OSError:
            pass
    _pending = {}
    _upload_delay_ms = 0
    _upload_timeout_ms = 0
    _dirty = False
    for p in UPLOAD_DIR.glob("**/*"):
        if p.is_file():
            p.unlink()
    for k in FINAL_PATHS:
        COMMITTED[k] = None
    await broadcast_settings()
    return {"ok": True}


@app.post("/api/test/uploading")
async def api_test_uploading(body: dict):
    global _uploading
    _uploading = bool(body.get("uploading", False))
    await broadcast_settings()
    return {"ok": True}


@app.post("/api/test/upload-delay")
async def api_test_upload_delay(body: dict):
    global _upload_delay_ms
    _upload_delay_ms = int(body.get("ms", 0))
    return {"ok": True}


@app.post("/api/test/upload-timeout")
async def api_test_upload_timeout(body: dict):
    global _uploading
    ms = int(body.get("ms", 500))
    # The flag flips back on a background thread: a raw asyncio.ensure_future
    # task never resumes under the sync TestClient portal, so a plain timer
    # thread is the deterministic way to make the flag observable true-then-false.
    _uploading = True
    await broadcast_settings()

    def _flip():
        global _uploading
        time.sleep(ms / 1000)
        _uploading = False

    threading.Thread(target=_flip, daemon=True).start()
    return {"ok": True}


@app.get("/api/test/upload-state")
async def api_test_upload_state():
    return {
        "uploading": _uploading,
        "put_count": _upload_put_count,
        "aborted": sorted(_upload_aborted),
    }


@app.get("/api/test/uploads/{group}/{key}")
async def api_test_get_upload(group: str, key: str):
    p = COMMITTED.get(group + "." + key)
    if not p or not p.exists():
        return PlainTextResponse("Not Found", status_code=404)
    return Response(content=p.read_bytes(), media_type="application/octet-stream")


@app.get("/api/settings")
async def api_get_settings():
    payload = build_settings()
    payload["_meta"] = {
        "dirty": _dirty,
        "show_reset": True,
        "show_reboot": True,
        "uploading": _uploading,
    }
    # Legacy aliases, removed in 1.0.0.
    payload["_dirty"] = _dirty
    payload["_show_reset"] = True
    payload["_show_reboot"] = True
    return payload


@app.get("/")
async def get_root():
    html = (BASE / "index.html").read_text()
    html = html.replace("{{TITLE}}", PARASOL_TITLE)
    html = html.replace("{{LOGO}}", PARASOL_LOGO)
    html = html.replace("{{FAVICON}}", PARASOL_FAVICON)
    return HTMLResponse(html)


@app.get("/{name:path}")
async def get_static(name: str):
    for dir in [BASE, FIXTURES]:
        p = dir / name
        if p.is_file():
            return FileResponse(str(p))
    return PlainTextResponse("Not Found", status_code=404)
