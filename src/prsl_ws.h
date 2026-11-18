#pragma once
#include "ESPAsyncWebServer.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t prsl_ws_init(AsyncWebSocket *ws, prsl_store_t *store);

/* Close every tracked client. Takes an id snapshot first because the server's
 * client list may erase an element from inside close(). */
void prsl_ws_close_all(AsyncWebSocket *ws);

/* Drop all tracked ids. Call after the WebSocket handler is removed. */
void prsl_ws_reset_tracking(void);

#ifdef __cplusplus
}
#endif
