#include "pwui_ws.h"
#include "pwui_json.h"
#include <string.h>

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;

    ws->onEvent([store](AsyncWebSocket *server, AsyncWebSocketClient *client,
                         AwsEventType type, void *arg, uint8_t *data, size_t len) {
        switch (type) {
        case WS_EVT_CONNECT: {
            /* Send status: {"type":"status","data":{...}} */
            cJSON *status_inner = pwui_json_build_status(store);
            if (status_inner) {
                cJSON *status_msg = cJSON_CreateObject();
                cJSON_AddStringToObject(status_msg, "type", "status");
                cJSON_AddItemToObject(status_msg, "data", status_inner);
                char *sstr = cJSON_PrintUnformatted(status_msg);
                client->text(sstr);
                free(sstr);
                cJSON_Delete(status_msg);
            }

            /* Send settings: {"type":"settings","_dirty":...,"data":{...}} */
            cJSON *settings_inner = pwui_json_build_settings(store);
            if (settings_inner) {
                cJSON *settings_msg = cJSON_CreateObject();
                cJSON_AddStringToObject(settings_msg, "type", "settings");
                cJSON_AddBoolToObject(settings_msg, "_dirty", pwui_store_is_dirty(store));
                cJSON_AddItemToObject(settings_msg, "data", settings_inner);
                char *sstr = cJSON_PrintUnformatted(settings_msg);
                client->text(sstr);
                free(sstr);
                cJSON_Delete(settings_msg);
            }
            break;
        }
        case WS_EVT_DATA: {
            AwsFrameInfo *info = (AwsFrameInfo *)arg;
            if (info->final && info->opcode == WS_TEXT) {
                char *msg = (char *)malloc(len + 1);
                if (!msg) break;
                memcpy(msg, data, len);
                msg[len] = '\0';

                cJSON *parsed = cJSON_Parse(msg);
                if (parsed) {
                    cJSON *action = cJSON_GetObjectItem(parsed, "action");
                    if (action && cJSON_IsString(action) &&
                        strcmp(cJSON_GetStringValue(action), "apply") == 0) {

                        char comps[16][32], keys[16][32], values[16][256];
                        int n = pwui_json_parse_apply(store, msg, comps, keys, values, 16);

                        for (int i = 0; i < n; i++) {
                            pwui_store_set_value(store, comps[i], keys[i], values[i]);

                            pwui_field_t *f = pwui_store_find(store, comps[i], keys[i]);
                            if (f && f->on_apply) {
                                f->on_apply(comps[i], keys[i], values[i]);
                            }
                        }

                        cJSON *inner = pwui_json_build_settings(store);
                        if (inner) {
                            cJSON *msg_out = cJSON_CreateObject();
                            cJSON_AddStringToObject(msg_out, "type", "settings");
                            cJSON_AddBoolToObject(msg_out, "_dirty", pwui_store_is_dirty(store));
                            cJSON_AddItemToObject(msg_out, "data", inner);
                            char *out_str = cJSON_PrintUnformatted(msg_out);
                            server->textAll(out_str);
                            free(out_str);
                            cJSON_Delete(msg_out);
                        }
                    }
                    cJSON_Delete(parsed);
                }
                free(msg);
            }
            break;
        }
        case WS_EVT_DISCONNECT:
        case WS_EVT_ERROR:
        case WS_EVT_PING:
        case WS_EVT_PONG:
            break;
        }
    });

    return ESP_OK;
}
