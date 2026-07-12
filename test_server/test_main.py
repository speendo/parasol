from fastapi.testclient import TestClient
from test_server.main import app
import pytest

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_before_each():
    client.get("/api/settings/reset")
    yield


def test_get_settings_returns_nested_json():
    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert "_dirty" in data
    assert "wifi" in data
    assert "gpio" in data
    # wifi.ssid should be [type, label, opts]
    ssid = data["wifi"]["ssid"]
    assert isinstance(ssid, list)
    assert len(ssid) == 3
    assert ssid[0] == "text"
    assert "value" in ssid[2]
    # gpio.pin should be [type, label, opts]
    pin = data["gpio"]["pin"]
    assert pin[0] == "number"
    assert "value" in pin[2]


def test_get_settings_returns_current_values():
    # Change a value via POST /api/settings/apply
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    response = client.get("/api/settings")
    data = response.json()
    assert data["wifi"]["ssid"][2]["value"] == "MyNet"


def test_settings_save_persists_to_nvs():
    response = client.post("/api/settings/save", json={"wifi": {"ssid": ["text", "SSID", {"value": "SavedNet"}]}})
    assert response.status_code == 200
    # Verify via GET
    data = client.get("/api/settings").json()
    assert data["wifi"]["ssid"][2]["value"] == "SavedNet"


def test_settings_apply_updates_applied_only():
    # Set via save (goes to both nvs and applied)
    client.post("/api/settings/save", json={"gpio": {"pin": ["number", "Pin", {"value": 5}]}})
    # Apply a different value (goes to applied only)
    response = client.post("/api/settings/apply", json={"gpio": {"pin": ["number", "Pin", {"value": 10}]}})
    assert response.status_code == 200
    # GET should return the applied value
    data = client.get("/api/settings").json()
    assert data["gpio"]["pin"][2]["value"] == 10


def test_settings_save_rejects_invalid_json():
    response = client.post("/api/settings/save", content=b"not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_settings_apply_rejects_invalid_json():
    response = client.post("/api/settings/apply", content=b"bad", headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_old_endpoints_return_404():
    assert client.get("/manifest.json").status_code == 404
    assert client.get("/groups/wifi.json").status_code == 404
    assert client.post("/api/save", json={}).status_code == 404
    assert client.post("/api/apply", json={}).status_code == 404


def test_dirty_false_initially():
    data = client.get("/api/settings").json()
    assert data["_dirty"] is False


def test_dirty_true_after_apply():
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is True


def test_dirty_false_after_save():
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is True
    client.post("/api/settings/save", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is False


def test_dirty_false_after_reset():
    client.post("/api/settings/apply", json={"wifi": {"ssid": ["text", "SSID", {"value": "MyNet"}]}})
    data = client.get("/api/settings").json()
    assert data["_dirty"] is True
    client.get("/api/settings/reset")
    data = client.get("/api/settings").json()
    assert data["_dirty"] is False


def test_ws_connect_receives_settings():
    with client.websocket_connect("/api/events") as ws:
        data = ws.receive_json()
        assert "_dirty" in data
        assert "wifi" in data
        assert "gpio" in data


def test_ws_apply_updates_applied():
    with client.websocket_connect("/api/events") as ws:
        ws.receive_json()  # initial push
        ws.send_json({"action": "apply", "data": {"wifi": {"ssid": ["text", "SSID", {"value": "WSTest"}]}}})
        pushed = ws.receive_json()
        assert pushed["wifi"]["ssid"][2]["value"] == "WSTest"


def test_ws_apply_makes_dirty():
    with client.websocket_connect("/api/events") as ws:
        ws.receive_json()  # initial push
        ws.send_json({"action": "apply", "data": {"wifi": {"ssid": ["text", "SSID", {"value": "DirtyMaker"}]}}})
        pushed = ws.receive_json()
        assert pushed["_dirty"] is True


def test_external_change_broadcasts_to_all_clients():
    with client.websocket_connect("/api/events") as ws1, \
         client.websocket_connect("/api/events") as ws2:
        ws1.receive_json()
        ws2.receive_json()
        client.post("/api/settings/external-change", json={"wifi": {"ssid": ["text", "SSID", {"value": "ExtChange"}]}})
        data1 = ws1.receive_json()
        data2 = ws2.receive_json()
        assert data1["wifi"]["ssid"][2]["value"] == "ExtChange"
        assert data2["wifi"]["ssid"][2]["value"] == "ExtChange"
