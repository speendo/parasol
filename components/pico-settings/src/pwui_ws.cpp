#include "pwui_ws.h"
#include "pwui_store.h"
#include "pwui_json.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

static pwui_store_t *g_store = NULL;

static void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client,
                     AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        cJSON *status = cJSON_CreateObject();
        cJSON_AddStringToObject(status, "type", "status");
        cJSON_AddItemToObject(status, "data", pwui_json_build_status(g_store));
        char *s = cJSON_PrintUnformatted(status);
        cJSON_Delete(status);
        if (s) { client->text(s); free(s); }

        cJSON *settings = cJSON_CreateObject();
        cJSON_AddStringToObject(settings, "type", "settings");
        cJSON_AddBoolToObject(settings, "_dirty", pwui_store_is_dirty(g_store));
        cJSON_AddItemToObject(settings, "data", pwui_json_build_settings(g_store));
        char *s2 = cJSON_PrintUnformatted(settings);
        cJSON_Delete(settings);
        if (s2) { client->text(s2); free(s2); }
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo *)arg;
        if (info->final && info->index == 0 && info->len == len
            && info->opcode == WS_TEXT) {
            data[len] = '\0';

            cJSON *msg = cJSON_Parse((const char *)data);
            if (!msg) return;

            cJSON *action = cJSON_GetObjectItem(msg, "action");
            if (action && cJSON_IsString(action) && strcmp(action->valuestring, "apply") == 0) {
                cJSON *body = cJSON_GetObjectItem(msg, "data");
                if (!body || !cJSON_IsObject(body)) { cJSON_Delete(msg); return; }

                cJSON *group = body->child;
                while (group) {
                    if (!cJSON_IsObject(group) || group->string[0] == '_') {
                        group = group->next; continue;
                    }
                    cJSON *field = group->child;
                    while (field) {
                        if (!cJSON_IsArray(field) || cJSON_GetArraySize(field) < 3) {
                            field = field->next; continue;
                        }
                        cJSON *opts = cJSON_GetArrayItem(field, 2);
                        cJSON *val = NULL;
                        const char *val_str = NULL;
                        if (cJSON_IsObject(opts)) val = cJSON_GetObjectItem(opts, "value");
                        char num_buf[64] = {0};
                        if (val && cJSON_IsString(val)) {
                            val_str = val->valuestring;
                        } else if (val && cJSON_IsNumber(val)) {
                            snprintf(num_buf, sizeof(num_buf), "%g", cJSON_GetNumberValue(val));
                            val_str = num_buf;
                        }

                        pwui_field_t *f = pwui_store_find(g_store, group->string, field->string);
                        if (f && f->on_apply) {
                            esp_err_t ae = f->on_apply(group->string, field->string, val_str);
                            if (ae != ESP_OK) {
                                char err[128];
                                snprintf(err, sizeof(err), "{\"type\":\"error\",\"message\":\"on_apply rejected %s.%s\"}",
                                         group->string, field->string);
                                client->text(err);
                            } else {
                                pwui_store_set_value(g_store, group->string, field->string, val_str);
                                cJSON *resp = cJSON_CreateObject();
                                cJSON_AddStringToObject(resp, "type", "settings");
                                cJSON_AddItemToObject(resp, "data", pwui_json_build_settings(g_store));
                                char *out = cJSON_PrintUnformatted(resp);
                                cJSON_Delete(resp);
                                if (out) { server->textAll(out); free(out); }
                            }
                        } else if (f) {
                            pwui_store_set_value(g_store, group->string, field->string, val_str);
                        }
                        field = field->next;
                    }
                    group = group->next;
                }
            }
            cJSON_Delete(msg);
        }
    }
}

esp_err_t pwui_ws_init(AsyncWebSocket *ws, pwui_store_t *store) {
    if (!ws || !store) return ESP_ERR_INVALID_ARG;
    g_store = store;
    ws->onEvent(on_event);
    return ESP_OK;
}
