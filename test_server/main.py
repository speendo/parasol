import json
import time
import asyncio
from pathlib import Path
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse

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
    result["_dirty"] = nvs_store != applied_store
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
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for group_id, fields in data.items():
        if group_id.startswith("_"):
            continue
        for key, field_def in fields.items():
            if not isinstance(field_def, list) or len(field_def) < 3:
                continue
            opts = field_def[2]
            if "value" in opts:
                store_key = group_id + "." + key
                nvs_store[store_key] = opts["value"]
                applied_store[store_key] = opts["value"]
    return {}



@app.websocket("/api/events")
async def events_ws(ws: WebSocket):
    await ws.accept()
    connected.add(ws)
    try:
        await ws.send_json({"type": "status", "data": build_status()})
        await ws.send_json({"type": "settings", "_dirty": nvs_store != applied_store, "data": build_settings()})
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
                        store_key = group_key + "." + field_key
                        applied_store[store_key] = field_arr[2]["value"]
                payload = build_settings()
                for client in list(connected):
                    try:
                        await client.send_json({"type": "settings", "_dirty": nvs_store != applied_store, "data": payload})
                    except Exception:
                        connected.discard(client)
    except WebSocketDisconnect:
        pass
    finally:
        connected.discard(ws)


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
    payload = build_settings()
    for client in list(connected):
        try:
            await client.send_json({"type": "settings", "_dirty": nvs_store != applied_store, "data": payload})
        except Exception:
            connected.discard(client)
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
            store_key = group_key + "." + field_key
            applied_store[store_key] = field_arr[2].get("value", "")
    return {}


@app.api_route("/api/settings/reset", methods=["GET", "POST"])
async def api_settings_reset():
    nvs_store.clear()
    applied_store.clear()
    for group_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            if key == "label":
                continue
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = group_id + "." + key
            nvs_store[store_key] = val
            applied_store[store_key] = val
    return {}


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
