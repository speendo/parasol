#pragma once
#include "ESPAsyncWebServer.h"
#include "pwui_store.h"

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store);
