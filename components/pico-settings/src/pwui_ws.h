#pragma once
#include "ESPAsyncWebServer.h"
#include "pwui_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store);

#ifdef __cplusplus
}
#endif
