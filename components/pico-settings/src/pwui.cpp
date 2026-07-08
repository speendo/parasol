#include "pwui.h"
#include "pwui_store.h"
#include "pwui_json.h"
#include "pwui_ws.h"
#include "pwui_assets.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

/* ── Global state ───────────────────────────────────────────── */

static pwui_store_t g_store;
static AsyncWebServer *g_server = NULL;
static AsyncWebSocket g_ws("/api/events");
static pwui_commit_cb_t g_on_commit = NULL;
static bool g_initialized = false;
static bool g_current_is_status = false;

/* ── Lifecycle ───────────────────────────────────────────────── */

esp_err_t pwui_init(AsyncWebServer *server, pwui_commit_cb_t on_commit) {
    if (!server) return ESP_ERR_INVALID_ARG;

    pwui_store_load_values(&g_store);

    g_server = server;
    g_on_commit = on_commit;

    for (size_t i = 0; i < pwui_assets_count; i++) {
        const pwui_asset_t *a = &pwui_assets[i];
        server->on(a->path, HTTP_GET, [a](AsyncWebServerRequest *req) {
            AsyncWebServerResponse *resp = req->beginResponse(200, a->mime,
                a->data, a->len);
            resp->addHeader("Content-Encoding", "gzip");
            req->send(resp);
        });
    }

    server->on("/api/settings", HTTP_GET, [](AsyncWebServerRequest *req) {
        cJSON *json = pwui_json_build_settings(&g_store);
        if (json) {
            cJSON_AddBoolToObject(json, "_dirty", pwui_store_is_dirty(&g_store));
            char *str = cJSON_PrintUnformatted(json);
            cJSON_Delete(json);
            if (str) {
                req->send(200, "application/json", str);
                free(str);
                return;
            }
        }
        req->send(500, "text/plain", "Serialization error");
    });

    server->on("/api/settings/save", HTTP_POST,
        [](AsyncWebServerRequest *req) {}, NULL,
        [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
           size_t index, size_t total) {
            cJSON *msg = cJSON_ParseWithLength((const char *)data, total);
            if (!msg) {
                req->send(400, "text/plain", "Invalid JSON");
                return;
            }
            cJSON *body = cJSON_GetObjectItem(msg, "data");
            if (body) {
                cJSON *group = body->child;
                while (group) {
                    if (cJSON_IsObject(group) && group->string[0] != '_') {
                        cJSON *field = group->child;
                        while (field) {
                            if (cJSON_IsArray(field) && cJSON_GetArraySize(field) >= 3) {
                                cJSON *opts = cJSON_GetArrayItem(field, 2);
                                cJSON *val = cJSON_GetObjectItem(opts, "value");
                                const char *val_str = val ? cJSON_GetStringValue(val) : NULL;
                                char num_buf[64] = {0};
                                if (!val_str && val && cJSON_IsNumber(val)) {
                                    snprintf(num_buf, sizeof(num_buf), "%g", cJSON_GetNumberValue(val));
                                    val_str = num_buf;
                                }
                                pwui_field_t *f = pwui_store_find(&g_store, group->string, field->string);
                                if (f && f->on_apply) {
                                    esp_err_t ae = f->on_apply(group->string, field->string, val_str);
                                    if (ae != ESP_OK) {
                                        char err[128];
                                        snprintf(err, sizeof(err), "on_apply rejected %s.%s", group->string, field->string);
                                        req->send(400, "text/plain", err);
                                        cJSON_Delete(msg);
                                        return;
                                    }
                                }
                                pwui_store_set_value(&g_store, group->string, field->string, val_str);
                            }
                            field = field->next;
                        }
                    }
                    group = group->next;
                }

                enum { MAX_PAIRS = 64 };
                const char *pairs[MAX_PAIRS][2];
                char paths[MAX_PAIRS][128];
                int pair_count = 0;
                if (g_on_commit) {
                    group = body->child;
                    while (group && pair_count < MAX_PAIRS) {
                        if (cJSON_IsObject(group) && group->string[0] != '_') {
                            cJSON *field = group->child;
                            while (field && pair_count < MAX_PAIRS) {
                                if (cJSON_IsArray(field) && cJSON_GetArraySize(field) >= 3) {
                                    cJSON *opts = cJSON_GetArrayItem(field, 2);
                                    cJSON *val = cJSON_GetObjectItem(opts, "value");
                                    if (val) {
                                        cJSON *sv = pwui_store_get_value(&g_store, group->string, field->string);
                                        if (sv && cJSON_IsString(sv)) {
                                            snprintf(paths[pair_count], sizeof(paths[0]), "%s.%s", group->string, field->string);
                                            pairs[pair_count][0] = paths[pair_count];
                                            pairs[pair_count][1] = cJSON_GetStringValue(sv);
                                            pair_count++;
                                        }
                                    }
                                }
                                field = field->next;
                            }
                        }
                        group = group->next;
                    }
                }
                if (pair_count > 0 && g_on_commit) {
                    g_on_commit(pairs, pair_count);
                }
                pwui_store_clear_dirty(&g_store);
            }
            cJSON_Delete(msg);
            req->send(200, "text/plain", "OK");
        });

    g_initialized = true;
    return ESP_OK;
}

esp_err_t pwui_start(void) {
    if (!g_server) return ESP_ERR_INVALID_STATE;

    pwui_ws_init(&g_ws, &g_store);
    g_server->addHandler(&g_ws);

    g_server->begin();
    return ESP_OK;
}

esp_err_t pwui_reset(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;
    pwui_store_reset_values(&g_store);
    return pwui_push();
}

/* ── Component registration ─────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status) {
    if (!g_initialized) {
        esp_err_t err = pwui_store_init(&g_store);
        if (err != ESP_OK) return err;
        g_initialized = true;
    }
    g_current_is_status = is_status;
    return pwui_store_add_component(&g_store, id, label);
}

esp_err_t pwui_end_component(const char *id) {
    (void)id;
    return ESP_OK;
}

/* ── Field registration ─────────────────────────────────────── */

esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, const pwui_field_opts_t *opts) {
    pwui_field_t f = {0};
    f.comp_id = comp_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.is_status = g_current_is_status;

    if (opts) {
        f.on_load  = opts->on_load;
        f.on_apply = opts->on_apply;
        f.help     = opts->help ? opts->help : "";
        f.attrs    = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return pwui_store_add_field(&g_store, &f);
}

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label, const char *options[][2],
                              int option_count, const pwui_field_opts_t *opts) {
    pwui_field_t f = {0};
    f.comp_id = comp_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.is_status = g_current_is_status;
    f.options = options;
    f.option_count = option_count;

    if (opts) {
        f.on_load  = opts->on_load;
        f.on_apply = opts->on_apply;
        f.help     = opts->help ? opts->help : "";
        f.attrs    = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return pwui_store_add_field(&g_store, &f);
}

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value) {
    char comp_id[PWUI_MAX_PATH] = {0};
    char key[PWUI_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_INVALID_ARG;
    size_t clen = dot - path;
    if (clen >= PWUI_MAX_PATH) return ESP_ERR_INVALID_ARG;
    memcpy(comp_id, path, clen);
    comp_id[clen] = '\0';
    strncpy(key, dot + 1, PWUI_MAX_PATH - 1);
    key[PWUI_MAX_PATH - 1] = '\0';
    return pwui_store_set_value(&g_store, comp_id, key, value);
}

const char *pwui_get(const char *path) {
    char comp_id[PWUI_MAX_PATH] = {0};
    char key[PWUI_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return NULL;
    size_t clen = dot - path;
    if (clen >= PWUI_MAX_PATH) return NULL;
    memcpy(comp_id, path, clen);
    comp_id[clen] = '\0';
    strncpy(key, dot + 1, PWUI_MAX_PATH - 1);
    key[PWUI_MAX_PATH - 1] = '\0';
    cJSON *v = pwui_store_get_value(&g_store, comp_id, key);
    if (!v || !cJSON_IsString(v)) return NULL;
    return cJSON_GetStringValue(v);
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");
    cJSON_AddBoolToObject(root, "_dirty", pwui_store_is_dirty(&g_store));
    cJSON *data = pwui_json_build_settings(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    return ESP_OK;
}

esp_err_t pwui_broadcast_status(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "status");
    cJSON *data = pwui_json_build_status(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    return ESP_OK;
}
