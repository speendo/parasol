#include "prsl_ws.h"
#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_body.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

static prsl_store_t *g_store = NULL;

static void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client,
                     AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
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
            cJSON *msg = cJSON_ParseWithLength((const char *)data, len);
            if (!msg) return;

            cJSON *action = cJSON_GetObjectItem(msg, "action");
            if (action && cJSON_IsString(action) && strcmp(action->valuestring, "apply") == 0) {
                cJSON *body = cJSON_GetObjectItem(msg, "data");
                if (!body || !cJSON_IsObject(body)) { cJSON_Delete(msg); return; }

                prsl_rejection_t rej;
                int applied = prsl_apply_body(body, g_store, &rej);

                if (rej.group_id) {
                    char err[128];
                    snprintf(err, sizeof(err),
                             "{\"type\":\"error\",\"message\":\"on_set rejected %s.%s\"}",
                             rej.group_id, rej.key);
                    client->text(err);
                }

                /* Batch: broadcast once after processing all fields */
                if (applied > 0) {
                    cJSON *resp = prsl_build_settings_payload(g_store);
                    char *out = cJSON_PrintUnformatted(resp);
                    cJSON_Delete(resp);
                    if (out) { server->textAll(out); free(out); }
                }
            }
            cJSON_Delete(msg);
        }
    }
}

esp_err_t prsl_ws_init(AsyncWebSocket *ws, prsl_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;
    g_store = store;
    ws->onEvent(on_event);
    return ESP_OK;
}
