#include "prsl_ws.h"
#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_ws_handle.h"
#include "ESPAsyncWebServer.h"
#include "esp_log.h"
#include <stdlib.h>

static prsl_store_t *g_store = NULL;

static void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client,
                     AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        client->setCloseClientOnQueueFull(true);

        xSemaphoreTakeRecursive(g_store->mutex, portMAX_DELAY);

        cJSON *status = cJSON_CreateObject();
        cJSON_AddStringToObject(status, "type", "status");
        cJSON_AddItemToObject(status, "data", prsl_json_build_status(g_store));
        char *s = cJSON_PrintUnformatted(status);
        cJSON_Delete(status);
        if (s) { client->text(s); free(s); }

        cJSON *settings = prsl_build_settings_payload(g_store);
        char *s2 = cJSON_PrintUnformatted(settings);
        cJSON_Delete(settings);
        if (s2) { client->text(s2); free(s2); }

        xSemaphoreGiveRecursive(g_store->mutex);
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo *)arg;
        if (info->final && info->index == 0 && info->len == len
            && info->opcode == WS_TEXT && len > 0) {
            prsl_ws_reply_t out = {0};
            prsl_ws_handle((const char *)data, len, g_store, &out);
            if (out.to_sender) {
                if (!client->text(out.to_sender))
                    ESP_LOGW("prsl_ws", "reply not queued; closing on overflow");
                free(out.to_sender);
            }
            if (out.error) { client->text(out.error); free(out.error); }
            if (out.to_all) { server->textAll(out.to_all); free(out.to_all); }
        }
    }
}

esp_err_t prsl_ws_init(AsyncWebSocket *ws, prsl_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;
    g_store = store;
    ws->onEvent(on_event);
    return ESP_OK;
}
