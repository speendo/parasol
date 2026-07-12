#include "pwui.h"
#include "pwui_store.h"
#include "pwui_json.h"
#include "pwui_ws.h"
#include "pwui_assets.h"
#include "ESPAsyncWebServer.h"
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>

/* ── Static state ──────────────────────────────────────────── */

static pwui_store_t g_store;
static AsyncWebServer *g_server = NULL;
static const pwui_storage_t *g_storage = NULL;
static AsyncWebSocket g_ws("/api/events");

/* ── Builder state ─────────────────────────────────────────── */

static struct {
    bool active;
    const char *comp_id;
    const char *label;
    bool is_status;
} g_current = {0};

/* ── Component registration ────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status) {
    if (!id || !label) return ESP_ERR_INVALID_ARG;
    if (g_current.active) return ESP_ERR_INVALID_STATE;

    for (int i = 0; i < g_store.count; i++) {
        if (g_store.fields[i].is_status == is_status &&
            strcmp(g_store.fields[i].comp_id, id) == 0) {
            return ESP_ERR_INVALID_STATE;
        }
    }

    g_current.active = true;
    g_current.comp_id = id;
    g_current.label = label;
    g_current.is_status = is_status;

    esp_err_t err = pwui_store_add_component(&g_store, id, label);
    if (err != ESP_OK) {
        g_current.active = false;
        return err;
    }
    return ESP_OK;
}

esp_err_t pwui_end_component(const char *id) {
    if (!id) return ESP_ERR_INVALID_ARG;
    if (!g_current.active) return ESP_ERR_INVALID_STATE;
    if (strcmp(g_current.comp_id, id) != 0) return ESP_ERR_INVALID_STATE;
    g_current.active = false;
    return ESP_OK;
}

/* ── Varargs helper ────────────────────────────────────────── */

static esp_err_t add_field_internal(pwui_type_t type, const char *comp_id,
                                     const char *key, const char *label,
                                     const char *options[][2], int option_count,
                                     va_list args) {
    if (!comp_id || !key || !label) return ESP_ERR_INVALID_ARG;
    if (!g_current.active) return ESP_ERR_INVALID_STATE;
    if (strcmp(g_current.comp_id, comp_id) != 0) return ESP_ERR_INVALID_STATE;

    pwui_field_t f = {0};
    f.comp_id = g_current.comp_id;
    f.key = key;
    f.label = label;
    f.type = type;
    f.is_status = g_current.is_status;
    f.on_apply = NULL;

    if (options && option_count > 0) {
        f.options = options;
        f.option_count = option_count;
    }

    const char *default_value = NULL;
    bool set_null = false;
    void *vp;
    while ((vp = va_arg(args, void *)) != PWUI_END) {
        if (vp == PWUI_VALUE) {
            default_value = va_arg(args, const char *);
        } else if (vp == PWUI_HELP) {
            f.help = va_arg(args, const char *);
        } else if (vp == PWUI_APPLY) {
            f.on_apply = va_arg(args, pwui_apply_cb_t);
        } else if (vp == PWUI_ATTRS) {
            f.attrs = va_arg(args, const char *);
        } else if (vp == PWUI_NULL) {
            set_null = true;
        }
    }

    esp_err_t err = pwui_store_add_field(&g_store, &f);
    if (err != ESP_OK) return err;

    if (set_null) {
        pwui_store_set_value(&g_store, comp_id, key, NULL);
    } else if (default_value || f.is_status) {
        pwui_store_set_value(&g_store, comp_id, key, default_value);
    }

    return ESP_OK;
}

esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                          const char *label, ...) {
    va_list args;
    va_start(args, label);
    esp_err_t r = add_field_internal(type, comp_id, key, label, NULL, 0, args);
    va_end(args);
    return r;
}

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                               const char *label,
                               const char *options[][2], int option_count,
                               ...) {
    va_list args;
    va_start(args, option_count);
    esp_err_t r = add_field_internal(type, comp_id, key, label, options, option_count, args);
    va_end(args);
    return r;
}

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value) {
    if (!path) return ESP_ERR_INVALID_ARG;

    char comp_id[32], key[32];
    const char *dot = strchr(path, '.');
    if (!dot) return ESP_ERR_NOT_FOUND;

    size_t clen = dot - path;
    if (clen >= 32) clen = 31;
    memcpy(comp_id, path, clen);
    comp_id[clen] = '\0';
    strncpy(key, dot + 1, sizeof(key) - 1);
    key[sizeof(key) - 1] = '\0';

    return pwui_store_set_value(&g_store, comp_id, key, value);
}

const char *pwui_get(const char *path) {
    if (!path) return NULL;

    char comp_id[32], key[32];
    const char *dot = strchr(path, '.');
    if (!dot) return NULL;

    size_t clen = dot - path;
    if (clen >= 32) clen = 31;
    memcpy(comp_id, path, clen);
    comp_id[clen] = '\0';
    strncpy(key, dot + 1, sizeof(key) - 1);
    key[sizeof(key) - 1] = '\0';

    cJSON *v = pwui_store_get_value(&g_store, comp_id, key);
    if (!v) return NULL;

    if (cJSON_IsString(v)) return cJSON_GetStringValue(v);

    static char buf[32];
    if (cJSON_IsNumber(v)) {
        snprintf(buf, sizeof(buf), "%g", cJSON_GetNumberValue(v));
        return buf;
    }
    if (cJSON_IsBool(v)) {
        snprintf(buf, sizeof(buf), "%s", cJSON_IsTrue(v) ? "true" : "false");
        return buf;
    }
    return NULL;
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void) {
    cJSON *inner = pwui_json_build_settings(&g_store);
    if (!inner) return ESP_ERR_NO_MEM;
    cJSON *msg = cJSON_CreateObject();
    cJSON_AddStringToObject(msg, "type", "settings");
    cJSON_AddBoolToObject(msg, "_dirty", pwui_store_is_dirty(&g_store));
    cJSON_AddItemToObject(msg, "data", inner);
    char *str = cJSON_PrintUnformatted(msg);
    cJSON_Delete(msg);
    if (!str) return ESP_ERR_NO_MEM;
    g_ws.textAll(str);
    free(str);
    return ESP_OK;
}

esp_err_t pwui_broadcast_status(void) {
    cJSON *inner = pwui_json_build_status(&g_store);
    if (!inner) return ESP_ERR_NO_MEM;
    cJSON *msg = cJSON_CreateObject();
    cJSON_AddStringToObject(msg, "type", "status");
    cJSON_AddItemToObject(msg, "data", inner);
    char *str = cJSON_PrintUnformatted(msg);
    cJSON_Delete(msg);
    if (!str) return ESP_ERR_NO_MEM;
    g_ws.textAll(str);
    free(str);
    return ESP_OK;
}

/* ── HTTP handlers ──────────────────────────────────────────── */

static void handle_reset(AsyncWebServerRequest *req) {
    if (!g_storage || !g_storage->on_reset) {
        req->send(500, "text/plain", "No reset handler");
        return;
    }
    cJSON *data = cJSON_CreateObject();
    esp_err_t err = g_storage->on_reset(data);
    if (err == ESP_OK) {
        pwui_store_populate(&g_store, data);
        pwui_store_clear_dirty(&g_store);
        pwui_push();
    }
    cJSON_Delete(data);
    req->send(err == ESP_OK ? 200 : 500, "application/json",
              err == ESP_OK ? "{\"ok\":true}" : "{\"ok\":false}");
}

/* ── Static file serving ───────────────────────────────────── */

static void handle_static(const pwui_asset_t *asset, AsyncWebServerRequest *req) {
    AsyncWebServerResponse *resp = req->beginResponse(200, asset->mime,
        asset->data, asset->len);
    resp->addHeader("Content-Encoding", "gzip");
    req->send(resp);
}

/* ── Init ───────────────────────────────────────────────────── */

esp_err_t pwui_init(AsyncWebServer *server, const pwui_storage_t *storage) {
    if (!server || !storage) return ESP_ERR_INVALID_ARG;
    if (!storage->on_load || !storage->on_save) return ESP_ERR_INVALID_ARG;

    if (g_current.active) return ESP_ERR_INVALID_STATE;

    g_server = server;
    g_storage = storage;

    esp_err_t err = pwui_store_init(&g_store);
    if (err != ESP_OK) return err;

    cJSON *data = cJSON_CreateObject();
    err = storage->on_load(data);
    if (err != ESP_OK) {
        cJSON_Delete(data);
        return err;
    }
    pwui_store_populate(&g_store, data);
    cJSON_Delete(data);

    /* Register static file routes */
    for (size_t i = 0; i < pwui_assets_count; i++) {
        const pwui_asset_t *a = &pwui_assets[i];
        server->on(a->path, HTTP_GET, [a](AsyncWebServerRequest *req) {
            AsyncWebServerResponse *resp = req->beginResponse(200, a->mime,
                a->data, a->len);
            resp->addHeader("Content-Encoding", "gzip");
            req->send(resp);
        });
    }

    /* Register HTTP routes */
    server->on("/api/settings/save", HTTP_POST,
        [](AsyncWebServerRequest *req) {}, NULL,
        [storage](AsyncWebServerRequest *req, uint8_t *data, size_t len,
                  size_t index, size_t total) {
            /* Per-request body buffer allocated on first chunk, freed at end.
               Format: [size_t body_len][char body_buf[]] in a single malloc. */
            char *body_buf;
            size_t *body_len_ptr;

            if (index == 0) {
                if (total > 4096) {
                    req->send(413, "text/plain", "Payload too large");
                    return;
                }
                req->_tempObject = malloc(sizeof(size_t) + total + 1);
                if (!req->_tempObject) {
                    req->send(500, "text/plain", "Out of memory");
                    return;
                }
                body_len_ptr = (size_t *)req->_tempObject;
                *body_len_ptr = 0;
            } else {
                if (!req->_tempObject) return; /* Error on first chunk already sent */
                body_len_ptr = (size_t *)req->_tempObject;
            }
            body_buf = (char *)(body_len_ptr + 1);

            if (*body_len_ptr + len >= total + 1) {
                req->_tempObject = NULL;
                free(body_len_ptr);
                req->send(400, "text/plain", "Body size mismatch");
                return;
            }
            memcpy(body_buf + *body_len_ptr, data, len);
            *body_len_ptr += len;
            body_buf[*body_len_ptr] = '\0';

            if (index + len < total) return;

            cJSON *body = cJSON_Parse(body_buf);
            free(body_len_ptr);
            req->_tempObject = NULL;

            if (!body || !cJSON_IsObject(body)) {
                if (body) cJSON_Delete(body);
                req->send(400, "text/plain", "Invalid JSON");
                return;
            }

            cJSON *to_save = cJSON_Duplicate(body, 1);
            cJSON_Delete(body);

            pwui_store_populate(&g_store, to_save);
            esp_err_t err = storage->on_save(to_save);
            cJSON_Delete(to_save);

            if (err == ESP_OK) {
                pwui_store_clear_dirty(&g_store);
                req->send(200, "application/json", "{}");
            } else {
                req->send(500, "application/json", "{}");
            }
        });

    server->on("/api/settings/reset", HTTP_POST, handle_reset);

    /* Register WebSocket */
    server->addHandler(&g_ws);
    pwui_ws_init(&g_ws, &g_store);

    return ESP_OK;
}

esp_err_t pwui_start(void) {
    if (!g_server) return ESP_ERR_INVALID_STATE;
    g_server->begin();
    return ESP_OK;
}
