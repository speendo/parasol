#include "prsl_ws.h"
#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_ws_handle.h"
#include "prsl_ws_track.h"
#include "prsl_state.h"
#include "ESPAsyncWebServer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <stdlib.h>

static prsl_store_t *g_store = NULL;
static SemaphoreHandle_t g_track_mutex = NULL;

static void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client,
                     AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (prsl_is_stopping()) return;
    if (type == WS_EVT_CONNECT) {
        if (g_track_mutex) xSemaphoreTake(g_track_mutex, portMAX_DELAY);
        bool tracked = prsl_ws_track_add(client->id());
        if (g_track_mutex) xSemaphoreGive(g_track_mutex);
        if (!tracked) {
            client->close();
            return;
        }

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
    } else if (type == WS_EVT_DISCONNECT) {
        if (g_track_mutex) xSemaphoreTake(g_track_mutex, portMAX_DELAY);
        prsl_ws_track_remove(client->id());
        if (g_track_mutex) xSemaphoreGive(g_track_mutex);
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
    if (!g_track_mutex) {
        g_track_mutex = xSemaphoreCreateMutex();
        if (!g_track_mutex) return ESP_ERR_NO_MEM;
    }
    prsl_ws_reset_tracking();
    g_store = store;
    ws->onEvent(on_event);
    return ESP_OK;
}

void prsl_ws_close_all(AsyncWebSocket *ws) {
    if (!ws) return;

    /* close() can erase the client from the live list synchronously. Walk a
     * snapshot, never the list itself. */
    uint32_t ids[PRSL_WS_TRACK_MAX];
    size_t n = 0;
    if (g_track_mutex) xSemaphoreTake(g_track_mutex, portMAX_DELAY);
    n = prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX);
    if (g_track_mutex) xSemaphoreGive(g_track_mutex);

    for (size_t i = 0; i < n; i++) ws->close(ids[i]);
    ws->cleanupClients();
}

void prsl_ws_reset_tracking(void) {
    if (g_track_mutex) xSemaphoreTake(g_track_mutex, portMAX_DELAY);
    prsl_ws_track_reset();
    if (g_track_mutex) xSemaphoreGive(g_track_mutex);
}
