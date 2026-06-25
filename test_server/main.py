import json
import time
import asyncio
from pathlib import Path
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse

app = FastAPI()

BASE = Path(__file__).resolve().parent.parent

# Schema definition — mirrors the Phase 4 settings format
# Each top-level key is a component group. Each group has field definitions:
# {field_key: [type, label, opts]}
SETTINGS = {
    "wifi": {
        "ssid": ["text", "SSID", {"attrs": {"maxlength": 32, "placeholder": "MyNetwork", "required": True}, "value": "MyNetwork", "tooltip": "WiFi network name"}],
        "password": ["password", "Password", {"attrs": {"maxlength": 64, "placeholder": "Enter password", "required": True}, "value": "password", "tooltip": "WiFi password"}],
        "mode": ["select", "Mode", {"options": [["station", "Station"], ["ap", "Access Point"]], "value": "station", "tooltip": "WiFi operating mode"}],
        "hidden": ["switch", "Hidden SSID", {"value": False, "tooltip": "Hide network from scans"}],
        "channel": ["range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "value": 6, "tooltip": "WiFi channel number"}],
    },
    "gpio": {
        "pin": ["number", "Pin Number", {"attrs": {"min": 0, "max": 39, "placeholder": "0"}, "value": 2, "tooltip": "GPIO pin number"}],
        "direction": ["select", "Direction", {"options": [["input", "Input"], ["output", "Output"]], "value": "output", "tooltip": "Pin direction"}],
        "pull": ["radio", "Pull Resistor", {"options": [["none", "None"], ["up", "Pull Up"], ["down", "Pull Down"]], "value": "none", "tooltip": "Internal pull resistor"}],
        "enabled": ["switch", "GPIO Enabled", {"value": True, "tooltip": "Enable this GPIO pin"}],
        "inverted": ["switch", "Inverted", {"value": False, "tooltip": "Invert GPIO signal level"}],
        "initial": ["select", "Initial State", {"options": [["low", "Low"], ["high", "High"]], "value": "low", "tooltip": "Initial output state"}],
    },
    "mqtt": {
        "broker":      ["text", "Broker URL",   {"attrs": {"required": True, "pattern": r"^(mqtts?|tcp|ssl|ws|wss)://[a-zA-Z0-9_\-]+(:\d{1,5})?$", "placeholder": "mqtt://broker.local:1883"}, "value": "mqtt://broker-local:1883", "tooltip": "MQTT broker connection URL"}],
        "client_id":   ["text", "Client ID",    {"attrs": {"required": True, "minlength": 3, "maxlength": 64, "pattern": r"^[a-zA-Z0-9_\-]+$"}, "value": "esp32-001", "tooltip": "Unique MQTT client identifier"}],
        "topic_prefix":["text", "Topic Prefix",  {"attrs": {"maxlength": 128, "pattern": r"^[a-zA-Z0-9_\/.#+\-]*$", "placeholder": "home/esp32"}, "value": "home/esp32", "tooltip": "Prefix for publish/subscribe topics"}],
        "keepalive":   ["number", "Keepalive (s)", {"attrs": {"min": 1, "max": 65535, "step": 5}, "value": 56, "tooltip": "MQTT keepalive interval in seconds"}],
        "qos":         ["select", "QoS Level",  {"options": [["0", "0 — At most once"], ["1", "1 — At least once"], ["2", "2 — Exactly once"]], "value": "1", "tooltip": "Quality of Service level"}],
        "retain":      ["switch", "Retain",     {"value": False, "tooltip": "Retain last message on broker"}],
    },
    "notifications": {
        "host":         ["text", "SMTP Host",       {"attrs": {"required": True, "minlength": 5, "pattern": r"^[a-zA-Z0-9]([a-zA-Z0-9_\-]*[a-zA-Z0-9])?$", "placeholder": "smtp.gmail.com"}, "value": "smtp-example-com", "tooltip": "SMTP server hostname"}],
        "port":         ["number", "SMTP Port",     {"attrs": {"min": 1, "max": 65535}, "value": 587, "tooltip": "SMTP server port"}],
        "sender":       ["email", "Sender Email",   {"attrs": {"required": True, "placeholder": "esp32@example.com"}, "value": "esp32@example.com", "tooltip": "From address for alerts"}],
        "recipient":    ["email", "Recipient Email",{"attrs": {"required": True, "placeholder": "admin@example.com"}, "value": "admin@example.com", "tooltip": "Alert destination address"}],
        "min_interval": ["range", "Min Interval (s)", {"attrs": {"min": 30, "max": 3600, "step": 30}, "value": 300, "tooltip": "Minimum time between alert emails"}],
        "enabled":      ["switch", "Alerts Enabled", {"value": False, "tooltip": "Enable email notifications"}],
    },
}

STATUS = {
    "system": {
        "uptime":     ["text", "Uptime",     {"value": None}],
        "fw_version": ["select", "Firmware", {"options": [["2.0.0","2.0.0"],["2.1.0","2.1.0"],["2.2.0-beta","2.2.0-beta"]], "value": "2.1.0"}],
        "led":        ["switch", "LED",      {"value": True, "tooltip": "System LED indicator"}],
    },
    "network": {
        "mode":       ["radio", "Mode",      {"options": [["auto","Auto"],["manual","Manual"],["safe","Safe"]], "value": "auto", "tooltip": "Network operation mode"}],
        "signal":     ["range", "Signal",    {"attrs": {"min": 0, "max": 100, "step": 1}, "value": None, "tooltip": "Signal strength %"}],
        "connection": ["select", "Connection",{"options": [["connected","Connected"],["disconnected","Disconnected"],["error","Error"]], "value": "connected"}],
    },
    "sensors": {
        "temperature": ["number", "Temperature", {"value": None, "tooltip": "Celsius"}],
    },
}

nvs_store: dict[str, object] = {}
applied_store: dict[str, object] = {}
status_store: dict[str, object] = {}
start_time = time.time()
connected: set[WebSocket] = set()


@app.on_event("startup")
async def startup():
    for comp_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = comp_id + "." + key
            nvs_store[store_key] = val
            applied_store[store_key] = val
    for comp_id, fields in STATUS.items():
        for key, field_def in fields.items():
            opts = field_def[2]
            val = opts.get("value")
            if val is not None:
                store_key = comp_id + "." + key
                status_store[store_key] = val
    asyncio.ensure_future(status_broadcaster())


def build_settings():
    result = {}
    result["_dirty"] = nvs_store != applied_store
    for comp_id, fields in SETTINGS.items():
        group = {}
        for key, field_def in fields.items():
            ftype, flabel, fopts = field_def
            opts = dict(fopts)
            store_key = comp_id + "." + key
            if store_key in applied_store:
                opts["value"] = applied_store[store_key]
            group[key] = [ftype, flabel, opts]
        result[comp_id] = group
    return result


def build_status():
    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)
    days = hours // 24
    seconds = int(elapsed % 60)
    uptime_str = f"{days}d {hours % 24}h {minutes % 60}m {seconds}s"

    result = {}
    for comp_id, fields in STATUS.items():
        group = {}
        for key, field_def in fields.items():
            ftype, flabel, fopts = field_def
            opts = dict(fopts)
            if key == "uptime":
                opts["value"] = uptime_str
            elif key == "signal":
                opts["value"] = str(50 + int(elapsed * 5) % 50)
            elif key == "temperature":
                opts["value"] = str(round(23.5 + (int(elapsed) % 10) * 0.1, 1))
            else:
                store_key = comp_id + "." + key
                opts["value"] = status_store.get(store_key, opts.get("value", ""))
            group[key] = [ftype, flabel, opts]
        result[comp_id] = group
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


@app.get("/api/settings")
async def get_settings():
    return build_settings()


@app.post("/api/settings/save")
async def api_settings_save(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for comp_id, fields in data.items():
        if comp_id.startswith("_"):
            continue
        for key, field_def in fields.items():
            if not isinstance(field_def, list) or len(field_def) < 3:
                continue
            opts = field_def[2]
            if "value" in opts:
                store_key = comp_id + "." + key
                nvs_store[store_key] = opts["value"]
                applied_store[store_key] = opts["value"]
    return {}


@app.post("/api/settings/apply")
async def api_settings_apply(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for comp_id, fields in data.items():
        if comp_id.startswith("_"):
            continue
        for key, field_def in fields.items():
            if not isinstance(field_def, list) or len(field_def) < 3:
                continue
            opts = field_def[2]
            if "value" in opts:
                store_key = comp_id + "." + key
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


@app.api_route("/manifest.json", methods=["GET", "POST"])
async def old_manifest():
    return PlainTextResponse("Not Found", status_code=404)


@app.api_route("/components/{name:path}", methods=["GET", "POST"])
async def old_component(name: str):
    return PlainTextResponse("Not Found", status_code=404)


@app.api_route("/api/save", methods=["GET", "POST"])
async def old_save():
    return PlainTextResponse("Not Found", status_code=404)


@app.api_route("/api/apply", methods=["GET", "POST"])
async def old_apply():
    return PlainTextResponse("Not Found", status_code=404)


@app.api_route("/api/settings/reset", methods=["GET", "POST"])
async def api_settings_reset():
    nvs_store.clear()
    applied_store.clear()
    for comp_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = comp_id + "." + key
            nvs_store[store_key] = val
            applied_store[store_key] = val
    return {}


@app.get("/")
async def get_root():
    return FileResponse(str(BASE / "index.html"))


@app.get("/{name:path}")
async def get_static(name: str):
    p = BASE / name
    if p.is_file():
        return FileResponse(str(p))
    return PlainTextResponse("Not Found", status_code=404)
