import json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, PlainTextResponse

app = FastAPI()

BASE = Path(__file__).resolve().parent.parent

nvs_store: dict[str, str | int | bool] = {}
applied_store: dict[str, str | int | bool] = {}


@app.on_event("startup")
async def startup():
    manifest_path = BASE / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for comp in manifest:
        fields_path = BASE / comp["file"]
        fields = json.loads(fields_path.read_text())
        for f in fields:
            key = f"{comp['id']}.{f[0]}"
            opts = f[3] if len(f) > 3 else {}
            default = opts.get("default", "")
            nvs_store[key] = default
            applied_store[key] = default


@app.get("/")
async def get_root():
    return FileResponse(str(BASE / "index.html"))


@app.get("/manifest.json")
async def get_manifest():
    return FileResponse(str(BASE / "manifest.json"))


@app.get("/components/{name}")
async def get_component(name: str):
    p = BASE / "components" / name
    if p.is_file() and p.suffix in (".json",):
        return FileResponse(str(p))
    return PlainTextResponse("Not Found", status_code=404)


@app.post("/api/save")
async def api_save(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for key, value in data.items():
        nvs_store[key] = value
        applied_store[key] = value
    return {"ok": True}


@app.post("/api/apply")
async def api_apply(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid JSON", status_code=400)
    if not isinstance(data, dict):
        return PlainTextResponse("Body must be a JSON object", status_code=400)
    for key, value in data.items():
        applied_store[key] = value
    return {"ok": True}


@app.get("/{name:path}")
async def get_static(name: str):
    p = BASE / name
    if p.is_file():
        return FileResponse(str(p))
    return PlainTextResponse("Not Found", status_code=404)
