import json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, PlainTextResponse

app = FastAPI()

BASE = Path(__file__).resolve().parent.parent

# Schema definition — mirrors the Phase 4 settings format
# Each top-level key is a component group. Each group has field definitions:
# {field_key: [type, label, opts]}
SETTINGS = {
    "wifi": {
        "ssid": ["text", "SSID", {"attrs": {"maxlength": 32, "placeholder": "MyNetwork"}, "value": "", "tooltip": "WiFi network name"}],
        "password": ["password", "Password", {"attrs": {"maxlength": 64, "placeholder": "Enter password"}, "value": "", "tooltip": "WiFi password"}],
        "mode": ["select", "Mode", {"options": [["station", "Station"], ["ap", "Access Point"]], "value": "station", "tooltip": "WiFi operating mode"}],
        "hidden": ["switch", "Hidden SSID", {"value": False, "tooltip": "Hide network from scans"}],
        "channel": ["range", "Channel", {"attrs": {"min": 1, "max": 13, "step": 1}, "value": 6, "tooltip": "WiFi channel number"}],
    },
    "gpio": {
        "pin": ["number", "Pin Number", {"attrs": {"min": 0, "max": 39, "placeholder": "0"}, "value": 2, "tooltip": "GPIO pin number"}],
        "direction": ["select", "Direction", {"options": [["input", "Input"], ["output", "Output"]], "value": "output", "tooltip": "Pin direction"}],
        "pull": ["radio", "Pull Resistor", {"options": [["none", "None"], ["up", "Pull Up"], ["down", "Pull Down"]], "value": "none", "tooltip": "Internal pull resistor"}],
        "initial": ["select", "Initial State", {"options": [["low", "Low"], ["high", "High"]], "value": "low", "tooltip": "Initial output state"}],
    },
}

nvs_store: dict[str, object] = {}
applied_store: dict[str, object] = {}


@app.on_event("startup")
async def startup():
    for comp_id, fields in SETTINGS.items():
        for key, field_def in fields.items():
            opts = field_def[2]
            val = opts.get("value", "")
            store_key = comp_id + "." + key
            nvs_store[store_key] = val
            applied_store[store_key] = val


@app.get("/api/settings")
async def get_settings():
    result = {"_dirty": nvs_store != applied_store}
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
