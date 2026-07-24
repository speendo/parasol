#pragma once
#include "ESPAsyncWebServer.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t prsl_ws_init(AsyncWebSocket *ws, prsl_store_t *store);

#ifdef __cplusplus
}
#endif
