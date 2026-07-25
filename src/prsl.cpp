#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_ws.h"
#include "prsl_assets.h"
#include "prsl_body.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>

/* ── Global state ───────────────────────────────────────────── */

static prsl_store_t g_store;
static AsyncWebServer *g_server = NULL;
static AsyncWebSocket g_ws("/api/events");
static prsl_save_cb_t g_on_save = NULL;
static prsl_reset_cb_t g_on_reset = NULL;
static prsl_reboot_cb_t g_on_reboot = NULL;
static bool g_initialized = false;
static char g_get_buf[PRSL_MAX_PATH];

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
    return prsl_add_field_opts(type, group_id, key, label, NULL, 0, opts);
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

/* ── Dirty ─────────────────────────────────────────────────── */

void prsl_set_dirty(bool dirty) {
    prsl_store_set_dirty(&g_store, dirty);
}

bool prsl_is_dirty(void) {
    return prsl_store_is_dirty(&g_store);
}

/* ── Lifecycle ───────────────────────────────────────────────── */

esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save,
                    prsl_reset_cb_t on_reset, prsl_reboot_cb_t on_reboot) {
    if (!server) return ESP_ERR_INVALID_ARG;

    prsl_store_load_values(&g_store);

    g_server = server;
    g_on_save = on_save;
    g_on_reset = on_reset;
    g_on_reboot = on_reboot;

    for (size_t i = 0; i < prsl_assets_count; i++) {
        const prsl_asset_t *a = &prsl_assets[i];
        server->on(a->path, HTTP_GET, [a](AsyncWebServerRequest *req) {
            AsyncWebServerResponse *resp = req->beginResponse(200, a->mime,
                a->data, a->len);
            resp->addHeader("Content-Encoding", "gzip");
            req->send(resp);
        });
    }

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
            if (!body) {
                cJSON_Delete(msg);
                req->send(400, "text/plain", "Missing data");
                return;
            }

            /* Lock AV store for the entire transaction */
            xSemaphoreTakeRecursive(g_store.mutex, portMAX_DELAY);

            prsl_rejection_t rej;
            prsl_apply_body(body, &g_store, &rej);

            if (rej.group_id) {
                char err[128];
                snprintf(err, sizeof(err), "on_set rejected %s.%s", rej.group_id, rej.key);
                xSemaphoreGiveRecursive(g_store.mutex);
                cJSON_Delete(msg);
                req->send(400, "text/plain", err);
                return;
            }
            cJSON_Delete(msg);

            /* Call on_save */
            esp_err_t save_result = ESP_OK;
            if (g_on_save) {
                save_result = g_on_save();
            }

            /* Clear or keep dirty, push, respond */
            if (save_result == ESP_OK) {
                prsl_store_clear_dirty(&g_store);
                prsl_push();
                xSemaphoreGiveRecursive(g_store.mutex);
                req->send(200, "text/plain", "OK");
            } else {
                xSemaphoreGiveRecursive(g_store.mutex);
                req->send(500, "text/plain", "Save failed");
            }
        });

    server->on("/api/settings/reset", HTTP_POST,
        [](AsyncWebServerRequest *req) {
            if (!g_on_reset) {
                req->send(404, "text/plain", "Not Found");
                return;
            }
            esp_err_t result = g_on_reset();
            if (result == ESP_OK) {
                prsl_push();
                req->send(200, "text/plain", "OK");
            } else {
                req->send(500, "text/plain", "Reset failed");
            }
        });

    server->on("/api/system/reboot", HTTP_POST,
        [](AsyncWebServerRequest *req) {
            if (!g_on_reboot) {
                req->send(404, "text/plain", "Not Found");
                return;
            }
            esp_err_t result = g_on_reboot();
            if (result == ESP_OK) {
                req->send(200, "text/plain", "OK");
            } else {
                req->send(500, "text/plain", "Reboot failed");
            }
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

static esp_err_t parse_dot_path(const char *path, char *group_id, char *key) {
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_INVALID_ARG;
    size_t glen = dot - path;
    if (glen >= PRSL_MAX_PATH) return ESP_ERR_INVALID_ARG;
    memcpy(group_id, path, glen);
    group_id[glen] = '\0';
    strncpy(key, dot + 1, PRSL_MAX_PATH - 1);
    key[PRSL_MAX_PATH - 1] = '\0';
    return ESP_OK;
}

esp_err_t prsl_set_str(const char *path, const char *value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_set_json(&g_store, group_id, key, value ? cJSON_CreateString(value) : cJSON_CreateNull());
}

esp_err_t prsl_set_int(const char *path, int value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_set_json(&g_store, group_id, key, cJSON_CreateNumber(value));
}

esp_err_t prsl_set_float(const char *path, float value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_set_json(&g_store, group_id, key, cJSON_CreateNumber(value));
}

esp_err_t prsl_set_bool(const char *path, bool value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_set_json(&g_store, group_id, key, cJSON_CreateBool(value));
}

esp_err_t prsl_set_null(const char *path) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_set_json(&g_store, group_id, key, cJSON_CreateNull());
}

const char *prsl_get(const char *path) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return NULL;

    xSemaphoreTakeRecursive(g_store.mutex, portMAX_DELAY);

    const char *result = NULL;
    for (int i = 0; i < g_store.count; i++) {
        if (strcmp(g_store.fields[i].group_id, group_id) == 0 &&
            strcmp(g_store.fields[i].key, key) == 0) {
            cJSON *v = g_store.fields[i].value;
            if (v && cJSON_IsString(v)) {
                result = cJSON_GetStringValue(v);
                strncpy(g_get_buf, result, PRSL_MAX_PATH - 1);
                g_get_buf[PRSL_MAX_PATH - 1] = '\0';
            }
            break;
        }
    }

    xSemaphoreGiveRecursive(g_store.mutex);
    return result ? g_get_buf : NULL;
}

/* ── Has reset ────────────────────────────────────────────────── */

bool prsl_has_reset(void) {
    return g_on_reset != NULL;
}

bool prsl_has_reboot(void) {
    return g_on_reboot != NULL;
}

/* ── Shared settings payload builder ─────────────────────────── */

cJSON *prsl_build_settings_payload(const prsl_store_t *store) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");
    cJSON_AddBoolToObject(root, "_dirty", prsl_store_is_dirty(store));
    cJSON_AddBoolToObject(root, "_show_reset", prsl_has_reset());
    cJSON_AddBoolToObject(root, "_show_reboot", prsl_has_reboot());
    cJSON_AddItemToObject(root, "data", prsl_json_build_settings(store));
    return root;
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t prsl_push(void) {
    xSemaphoreTakeRecursive(g_store.mutex, portMAX_DELAY);
    cJSON *root = prsl_build_settings_payload(&g_store);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        g_ws.textAll(str);
        free(str);
    }
    xSemaphoreGiveRecursive(g_store.mutex);
    return ESP_OK;
}

esp_err_t prsl_broadcast_status(void) {
    xSemaphoreTakeRecursive(g_store.mutex, portMAX_DELAY);
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
    xSemaphoreGiveRecursive(g_store.mutex);
    return ESP_OK;
}
