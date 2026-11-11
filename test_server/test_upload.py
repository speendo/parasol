import threading
import time

import pytest
from fastapi.testclient import TestClient

from test_server.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_uploads_before_each():
    client.post("/api/test/reset-uploads")
    client.get("/api/settings/reset")
    yield


def test_settings_payload_has_uploading():
    data = client.get("/api/settings").json()
    assert data["_meta"]["uploading"] is False


def test_settings_wire_shape():
    data = client.get("/api/settings").json()
    assert data["_meta"] == {
        "dirty": False,
        "show_reset": True,
        "show_reboot": True,
        "uploading": False,
    }
    assert "wifi" in data and "audio" in data and "config" in data
    clip = data["audio"]["clip"]
    assert isinstance(clip, list) and len(clip) == 3
    assert clip[0] == "file"
    assert clip[2]["value"] == "none"
    assert clip[2]["accept"] == ".mp3,audio/*"
    assert clip[2]["max_size"] == 1024 * 1024
    cfile = data["config"]["file"]
    assert cfile[0] == "file"
    assert cfile[2]["max_size"] == 8 * 1024


def test_preflight_audio_clip_valid():
    r = client.post("/api/upload/audio/clip",
                    json={"name": "beep.mp3", "size": 1024, "type": "audio/mpeg"})
    assert r.status_code == 200


def test_preflight_too_large():
    r = client.post("/api/upload/audio/clip",
                    json={"name": "beep.mp3", "size": 1024 * 1024 + 1, "type": "audio/mpeg"})
    assert r.status_code == 413


def test_preflight_wrong_type():
    r = client.post("/api/upload/audio/clip",
                    json={"name": "x.txt", "size": 10, "type": "text/plain"})
    assert r.status_code == 415


def test_preflight_unknown_key():
    r = client.post("/api/upload/audio/nope",
                    json={"name": "x.mp3", "size": 10, "type": "audio/mpeg"})
    assert r.status_code == 404


def test_put_missing_content_length():
    def gen():
        yield b"data"

    r = client.request("PUT", "/api/upload/config/file", content=gen(),
                       headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 411


def test_put_wrong_content_type():
    r = client.put("/api/upload/config/file", content=b"{}",
                   headers={"Content-Type": "text/plain"},
                   params={"name": "config.json", "type": "application/json"})
    assert r.status_code == 415


def test_put_config_file_immediate():
    body = b'{"a":1}'
    r = client.put("/api/upload/config/file", content=body,
                   headers={"Content-Type": "application/octet-stream"},
                   params={"name": "config.json", "type": "application/json"})
    assert r.status_code == 200
    data = client.get("/api/settings").json()
    assert data["config"]["file"][2]["value"] == "config.json"
    g = client.get("/api/test/uploads/config/file")
    assert g.status_code == 200
    assert g.content == body


def test_second_put_while_uploading():
    client.post("/api/test/uploading", json={"uploading": True})
    r = client.put("/api/upload/config/file", content=b"{}",
                   headers={"Content-Type": "application/octet-stream"},
                   params={"name": "config.json", "type": "application/json"})
    assert r.status_code == 409


def test_save_reset_reboot_guard_while_uploading():
    client.post("/api/test/uploading", json={"uploading": True})
    assert client.post("/api/settings/save", json={}).status_code == 409
    assert client.get("/api/settings/reset").status_code == 409
    assert client.post("/api/system/reboot").status_code == 409


def test_save_skips_file_field():
    client.post("/api/settings/save",
                json={"audio": {"clip": ["file", "Clip", {"value": "hacked.mp3"}]}})
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "none"


def test_apply_skips_file_field():
    client.post("/api/settings/apply",
                json={"audio": {"clip": ["file", "Clip", {"value": "hacked.mp3"}]}})
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "none"


def test_ws_apply_skips_file_field():
    with client.websocket_connect("/api/events") as ws:
        ws.receive_json()  # status push
        ws.receive_json()  # settings push
        ws.send_json({"action": "apply",
                      "data": {"audio": {"clip": ["file", "Clip", {"value": "hacked.mp3"}]}}})
        ws.receive_json()  # broadcast
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "none"


def test_audio_clip_deferred_flow():
    body = b"ID3 fake mp3"
    r = client.put("/api/upload/audio/clip", content=body,
                   headers={"Content-Type": "application/octet-stream"},
                   params={"name": "beep.mp3", "type": "audio/mpeg"})
    assert r.status_code == 200
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "beep.mp3 (pending)"
    assert data["_meta"]["dirty"] is True
    # Not committed until Save.
    assert client.get("/api/test/uploads/audio/clip").status_code == 404

    client.post("/api/settings/save", json={})
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "clip.mp3"
    assert data["_meta"]["dirty"] is False
    g = client.get("/api/test/uploads/audio/clip")
    assert g.status_code == 200
    assert g.content == body

    # A committed file keeps its label across reset.
    client.get("/api/settings/reset")
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "clip.mp3"


def test_reset_discards_pending_upload():
    r = client.put("/api/upload/audio/clip", content=b"ID3",
                   headers={"Content-Type": "application/octet-stream"},
                   params={"name": "beep.mp3", "type": "audio/mpeg"})
    assert r.status_code == 200
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "beep.mp3 (pending)"

    client.get("/api/settings/reset")
    data = client.get("/api/settings").json()
    assert data["audio"]["clip"][2]["value"] == "none"
    assert data["_meta"]["dirty"] is False
    assert client.get("/api/test/uploads/audio/clip").status_code == 404


def test_uploading_transitions_around_put():
    client.post("/api/test/upload-delay", json={"ms": 500})
    result = {}

    def do_put():
        result["resp"] = client.put(
            "/api/upload/config/file", content=b"{}",
            headers={"Content-Type": "application/octet-stream"},
            params={"name": "config.json", "type": "application/json"})

    t = threading.Thread(target=do_put)
    t.start()
    observed = False
    for _ in range(200):
        if client.get("/api/test/upload-state").json()["uploading"]:
            observed = True
            break
        time.sleep(0.005)
    t.join()
    assert observed is True
    assert result["resp"].status_code == 200
    assert client.get("/api/test/upload-state").json()["uploading"] is False


def test_upload_timeout_flips_uploading():
    client.post("/api/test/upload-timeout", json={"ms": 300})
    seen_true = False
    seen_false = False
    for _ in range(200):
        u = client.get("/api/test/upload-state").json()["uploading"]
        if u:
            seen_true = True
        elif seen_true:
            seen_false = True
            break
        time.sleep(0.01)
    assert seen_true is True
    assert seen_false is True


def test_reset_uploads_clears_state():
    # Commit an immediate file, defer a clip, then arm the lock.
    client.put("/api/upload/config/file", content=b"{}",
               headers={"Content-Type": "application/octet-stream"},
               params={"name": "config.json", "type": "application/json"})
    client.put("/api/upload/audio/clip", content=b"ID3",
               headers={"Content-Type": "application/octet-stream"},
               params={"name": "beep.mp3", "type": "audio/mpeg"})
    client.post("/api/test/uploading", json={"uploading": True})

    assert client.get("/api/test/uploads/config/file").status_code == 200

    r = client.post("/api/test/reset-uploads")
    assert r.status_code == 200

    state = client.get("/api/test/upload-state").json()
    assert state["uploading"] is False
    assert state["put_count"] == 0
    assert state["aborted"] == []
    assert client.get("/api/test/uploads/config/file").status_code == 404
    assert client.get("/api/test/uploads/audio/clip").status_code == 404
    data = client.get("/api/settings").json()
    assert data["_meta"]["uploading"] is False
    assert data["_meta"]["dirty"] is False
