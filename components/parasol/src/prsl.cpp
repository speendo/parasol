#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_ws.h"
#include "prsl_assets.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

/* ── Global state ───────────────────────────────────────────── */

static prsl_store_t g_store;
static AsyncWebServer *g_server = NULL;
static AsyncWebSocket g_ws("/api/events");
static prsl_save_cb_t g_on_save = NULL;
static bool g_initialized = false;

/* ── Group registration ─────────────────────────────────────── */

esp_err_t prsl_add_group(const char *group_id, const char *label) {
    if (!g_initialized) {
        esp_err_t err = prsl_store_init(&g_store);
        if (err != ESP_OK) return err;
        g_initialized = true;
    }
    return prsl_store_add_group(&g_store, group_id, label);
}

/* ── Field registration ─────────────────────────────────────── */

esp_err_t prsl_add_field(prsl_type_t type, const char *group_id, const char *key,
                         const char *label, const prsl_field_opts_t *opts) {
    if (!prsl_store_has_group(&g_store, group_id)) return ESP_ERR_NOT_FOUND;
    prsl_field_t f = {0};
    f.group_id = group_id;
    f.key = key;
    f.label = label;
    f.type = type;

    if (opts) {
        f.is_status = opts->is_status;
        f.on_get    = opts->on_get;
        f.on_set    = opts->on_set;
        f.help      = opts->help ? opts->help : "";
        f.attrs     = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return prsl_store_add_field(&g_store, &f);
}

esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id, const char *key,
                              const char *label, const char *options[][2],
                              int option_count, const prsl_field_opts_t *opts) {
    if (!prsl_store_has_group(&g_store, group_id)) return ESP_ERR_NOT_FOUND;
    prsl_field_t f = {0};
    f.group_id = group_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.options = options;
    f.option_count = option_count;

    if (opts) {
        f.is_status = opts->is_status;
        f.on_get    = opts->on_get;
        f.on_set    = opts->on_set;
        f.help      = opts->help ? opts->help : "";
        f.attrs     = opts->attrs ? opts->attrs : "";
    } else {
        f.help  = "";
        f.attrs = "";
    }

    return prsl_store_add_field(&g_store, &f);
}

/* ── Dirty check ────────────────────────────────────────────── */

void prsl_set_dirty_check(prsl_is_dirty_cb_t is_dirty) {
    prsl_store_set_dirty_hook(&g_store, is_dirty);
}

bool prsl_is_dirty(void) {
    return prsl_store_is_dirty(&g_store);
}

/* ── Lifecycle ───────────────────────────────────────────────── */

esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save) {
    if (!server) return ESP_ERR_INVALID_ARG;

    prsl_store_load_values(&g_store);

    g_server = server;
    g_on_save = on_save;

    for (size_t i = 0; i < prsl_assets_count; i++) {
        const prsl_asset_t *a = &prsl_assets[i];
        server->on(a->path, HTTP_GET, [a](AsyncWebServerRequest *req) {
            AsyncWebServerResponse *resp = req->beginResponse(200, a->mime,
                a->data, a->len);
            resp->addHeader("Content-Encoding", "gzip");
            req->send(resp);
        });
    }

    server->on("/api/settings", HTTP_GET, [](AsyncWebServerRequest *req) {
        cJSON *json = prsl_json_build_settings(&g_store);
        if (json) {
            cJSON_AddBoolToObject(json, "_dirty", prsl_store_is_dirty(&g_store));
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
                                char val_buf[64];
                                const char *val_str = prsl_json_value_str(val, val_buf, sizeof(val_buf));
                                prsl_field_t *f = prsl_store_find(&g_store, group->string, field->string);
                                if (f && f->on_set) {
                                    esp_err_t ae = f->on_set(group->string, field->string, val_str);
                                    if (ae != ESP_OK) {
                                        char err[128];
                                        snprintf(err, sizeof(err), "on_set rejected %s.%s", group->string, field->string);
                                        req->send(400, "text/plain", err);
                                        cJSON_Delete(msg);
                                        return;
                                    }
                                }
                                prsl_store_set_value(&g_store, group->string, field->string, val_str);
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
                if (g_on_save) {
                    group = body->child;
                    while (group && pair_count < MAX_PAIRS) {
                        if (cJSON_IsObject(group) && group->string[0] != '_') {
                            cJSON *field = group->child;
                            while (field && pair_count < MAX_PAIRS) {
                                if (cJSON_IsArray(field) && cJSON_GetArraySize(field) >= 3) {
                                    cJSON *opts = cJSON_GetArrayItem(field, 2);
                                    cJSON *val = cJSON_GetObjectItem(opts, "value");
                                    if (val) {
                                        cJSON *sv = prsl_store_get_value(&g_store, group->string, field->string);
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
                if (pair_count > 0 && g_on_save) {
                    g_on_save(pairs, pair_count);
                }
                prsl_store_check_dirty(&g_store);
            }
            cJSON_Delete(msg);
            req->send(200, "text/plain", "OK");
        });

    return ESP_OK;
}

esp_err_t prsl_start(void) {
    if (!g_server) return ESP_ERR_INVALID_STATE;

    prsl_ws_init(&g_ws, &g_store);
    g_server->addHandler(&g_ws);

    g_server->begin();
    return ESP_OK;
}

esp_err_t prsl_reset(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;
    prsl_store_reset_values(&g_store);
    return prsl_push();
}

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t prsl_set(const char *path, const char *value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_INVALID_ARG;
    size_t clen = dot - path;
    if (clen >= PRSL_MAX_PATH) return ESP_ERR_INVALID_ARG;
    memcpy(group_id, path, clen);
    group_id[clen] = '\0';
    strncpy(key, dot + 1, PRSL_MAX_PATH - 1);
    key[PRSL_MAX_PATH - 1] = '\0';
    return prsl_store_set_value(&g_store, group_id, key, value);
}

const char *prsl_get(const char *path) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    const char *dot = strchr(path, '.');
    if (!dot) return NULL;
    size_t clen = dot - path;
    if (clen >= PRSL_MAX_PATH) return NULL;
    memcpy(group_id, path, clen);
    group_id[clen] = '\0';
    strncpy(key, dot + 1, PRSL_MAX_PATH - 1);
    key[PRSL_MAX_PATH - 1] = '\0';
    cJSON *v = prsl_store_get_value(&g_store, group_id, key);
    if (!v || !cJSON_IsString(v)) return NULL;
    return cJSON_GetStringValue(v);
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t prsl_push(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");
    cJSON_AddBoolToObject(root, "_dirty", prsl_store_is_dirty(&g_store));
    cJSON *data = prsl_json_build_settings(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    return ESP_OK;
}

esp_err_t prsl_broadcast_status(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "status");
    cJSON *data = prsl_json_build_status(&g_store);
    cJSON_AddItemToObject(root, "data", data);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    return ESP_OK;
}
