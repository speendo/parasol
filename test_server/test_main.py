from fastapi.testclient import TestClient
from test_server.main import app

client = TestClient(app)

def test_serves_index():
    response = client.get("/")
    assert response.status_code == 200
    assert b"ESP32 Config" in response.content

def test_serves_manifest():
    response = client.get("/manifest.json")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "id" in data[0]
    assert "file" in data[0]

def test_serves_all_components():
    for name in ["wifi.json", "gpio.json"]:
        response = client.get(f"/components/{name}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert len(data[0]) >= 3  # [key, type, label, opts?]

def test_serves_app_js():
    response = client.get("/app.js")
    assert response.status_code == 200
    assert b"serialize" in response.content

def test_404_for_unknown():
    response = client.get("/nonexistent.txt")
    assert response.status_code == 404


def test_save_updates_nvs():
    response = client.post("/api/save", json={"wifi.ssid": "TestNet"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_save_rejects_invalid_json():
    response = client.post("/api/save", content=b"not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_save_returns_ok_json():
    response = client.post("/api/save", json={"wifi.ssid": "MyNetwork"})
    data = response.json()
    assert data == {"ok": True}
