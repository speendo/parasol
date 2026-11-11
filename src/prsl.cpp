#include "prsl.h"
#include "prsl_store.h"
#include "prsl_json.h"
#include "prsl_ws.h"
#include "prsl_assets.h"
#include "prsl_body.h"
#include "prsl_upload.h"
#include "ESPAsyncWebServer.h"
#include <string.h>
#include <stdio.h>
#include <limits.h>

/* ── Global state ───────────────────────────────────────────── */

static prsl_store_t g_store;
static AsyncWebServer *g_server = NULL;
static AsyncWebSocket *g_ws = NULL;
static prsl_save_cb_t g_on_save = NULL;
static prsl_reset_cb_t g_on_reset = NULL;
static prsl_reboot_cb_t g_on_reboot = NULL;
static bool g_initialized = false;
static char g_get_buf[PRSL_MAX_PATH];

/* ── Upload state ───────────────────────────────────────────── */

static prsl_upload_state_t g_upload;
static uint32_t g_uploading_flag;      /* 4-byte atomic, 0/1 */
static uint32_t g_upload_generation;   /* bumped on every begin/stop */
static SemaphoreHandle_t g_upload_mutex;
static volatile bool g_upload_stopping;
static char g_preflight[256];
static size_t g_preflight_len;
static bool g_preflight_overflow;

static void upload_flag_set(bool v) {
    __atomic_store_n(&g_uploading_flag, v ? 1u : 0u, __ATOMIC_RELEASE);
}

bool prsl_is_uploading(void) {
    return __atomic_load_n(&g_uploading_flag, __ATOMIC_ACQUIRE) != 0;
}

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

esp_err_t prsl_add_file_field(const char *group_id, const char *key,
                              const char *label, const prsl_file_opts_t *opts) {
    return prsl_store_add_file_field(&g_store, group_id, key, label, opts);
}

/* ── Dirty ─────────────────────────────────────────────────── */

void prsl_set_dirty(bool dirty) {
    prsl_store_set_dirty(&g_store, dirty);
}

bool prsl_is_dirty(void) {
    return prsl_store_is_dirty(&g_store);
}

/* ── Upload helpers ─────────────────────────────────────────── */

static bool upload_parse_path(const char *url, char *group, char *key) {
    static const char prefix[] = "/api/upload/";
    const size_t plen = sizeof(prefix) - 1;
    const char *rest, *slash, *keypart;
    size_t glen, klen;

    if (strncmp(url, prefix, plen) != 0) return false;
    rest = url + plen;
    if (!rest[0]) return false;              /* empty group */
    slash = strchr(rest, '/');
    if (!slash) return false;                /* no key segment */
    glen = (size_t)(slash - rest);
    if (glen == 0 || glen >= PRSL_MAX_PATH) return false;
    keypart = slash + 1;
    if (!keypart[0]) return false;           /* empty key */
    if (strchr(keypart, '/')) return false;  /* extra '/' */
    klen = strlen(keypart);
    if (klen >= PRSL_MAX_PATH) return false;

    memcpy(group, rest, glen);
    group[glen] = '\0';
    strcpy(key, keypart);
    return true;
}

static void upload_send(AsyncWebServerRequest *req, int status, const char *msg) {
    req->send(status, "text/plain", msg);
}

static int upload_clamp_status(int status) {
    if (status < 400) return 400;
    if (status > 599) return 599;
    return status;
}

static int upload_final_status(const prsl_upload_state_t *st) {
    return st->status ? upload_clamp_status(st->status) : st->default_status;
}

static void upload_on_disconnect(uint32_t gen) {
    if (g_upload_mutex) xSemaphoreTakeRecursive(g_upload_mutex, portMAX_DELAY);
    if (gen != g_upload_generation || g_upload_stopping) {
        if (g_upload_mutex) xSemaphoreGiveRecursive(g_upload_mutex);
        return;
    }
    bool was = prsl_upload_is_active(&g_upload);
    prsl_upload_abort(&g_upload);
    if (was) { upload_flag_set(false); prsl_push(); }
    if (g_upload_mutex) xSemaphoreGiveRecursive(g_upload_mutex);
}

static void on_upload_body(AsyncWebServerRequest *req, uint8_t *data,
                           size_t len, size_t index, size_t total) {
    xSemaphoreTakeRecursive(g_upload_mutex, portMAX_DELAY);
    if (g_upload_stopping) {
        xSemaphoreGiveRecursive(g_upload_mutex);
        return;
    }

    if (index == 0) {
        if (prsl_is_uploading()) {
            req->setAttribute("prsl_upload_status", (long)409);
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }
        memset(&g_upload, 0, sizeof(g_upload));
        req->setAttribute("prsl_upload_body", true);

        char group[PRSL_MAX_PATH];
        char key[PRSL_MAX_PATH];
        if (!upload_parse_path(req->url().c_str(), group, key)) {
            g_upload.default_status = 404;
            snprintf(g_upload.err, sizeof(g_upload.err), "Unknown field");
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        String te = req->header("Transfer-Encoding");
        te.toLowerCase();
        if (te.indexOf("chunked") >= 0) {
            g_upload.default_status = 411;
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        if (!req->hasHeader("Content-Length")) {
            g_upload.default_status = 411;
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        if (req->contentType() != "application/octet-stream") {
            g_upload.default_status = 415;
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        prsl_field_t *f = prsl_store_find(&g_store, group, key);
        if (!f || f->type != PRSL_FILE) {
            g_upload.default_status = 404;
            snprintf(g_upload.err, sizeof(g_upload.err), "Unknown field");
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        const char *name = "upload";
        const AsyncWebParameter *pn = req->getParam("name");
        if (pn && pn->value().length()) name = pn->value().c_str();
        const char *mime = NULL;
        const AsyncWebParameter *pt = req->getParam("type");
        if (pt && pt->value().length()) mime = pt->value().c_str();

        char err[PRSL_UPLOAD_ERR_MAX];
        int status = 0;
        if (prsl_upload_validate(f, name, mime, total, err, sizeof(err), &status) != ESP_OK) {
            g_upload.default_status = status;
            snprintf(g_upload.err, sizeof(g_upload.err), "%s", err);
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        /* Set the flag and push before begin so _meta.uploading is true
         * during the developer's META callback. */
        upload_flag_set(true);
        prsl_push();

        if (prsl_upload_begin(&g_upload, f, name, mime, total) != ESP_OK) {
            /* begin recorded status/err/default_status into g_upload. */
            upload_flag_set(false);
            prsl_push();
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }

        uint32_t gen = ++g_upload_generation;
        req->onDisconnect([gen]() { upload_on_disconnect(gen); });

        uint32_t idle = f->idle_timeout_ms ? f->idle_timeout_ms : 30000;
        req->client()->setRxTimeout((idle + 999) / 1000);
    } else {
        if (req->hasAttribute("prsl_upload_status")) {
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }
        if (!prsl_upload_is_active(&g_upload)) {
            xSemaphoreGiveRecursive(g_upload_mutex);
            return;
        }
    }

    /* Deliver this callback's bytes; clear the flag if the upload just
     * transitioned active -> inactive (rejected, aborted, or finished). */
    bool was_active = prsl_upload_is_active(&g_upload);
    prsl_upload_chunk(&g_upload, data, len, index);
    if (index + len == total && prsl_upload_is_active(&g_upload)) {
        prsl_upload_end(&g_upload);
    }
    if (was_active && !prsl_upload_is_active(&g_upload)) {
        upload_flag_set(false);
        prsl_push();
    }

    xSemaphoreGiveRecursive(g_upload_mutex);
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

    if (!g_upload_mutex) {
        g_upload_mutex = xSemaphoreCreateRecursiveMutex();
        if (!g_upload_mutex) return ESP_ERR_NO_MEM;
    }
    g_upload_stopping = false;
    memset(&g_upload, 0, sizeof(g_upload));
    g_upload_generation++;
    upload_flag_set(false);

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
        [](AsyncWebServerRequest *req) {
            if (prsl_is_uploading()) {
                req->send(409, "text/plain", "Upload in progress");
                return;
            }
        }, NULL,
        [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
           size_t index, size_t total) {
            /* During an upload, skip allocation and the apply/send path; the
             * final handler above reports 409 without buffering a large body.
             * If an upload began after an earlier chunk allocated _tempObject,
             * free it so the buffer isn't leaked. */
            if (prsl_is_uploading()) {
                if (req->_tempObject) {
                    free(req->_tempObject);
                    req->_tempObject = NULL;
                }
                return;
            }

            if (index == 0) {
                req->_tempObject = malloc(total + 1);
                if (!req->_tempObject) {
                    req->send(500, "text/plain", "Out of memory");
                    return;
                }
                ((char *)req->_tempObject)[0] = '\0';
            }
            char *buf = (char *)req->_tempObject;
            if (buf) {
                memcpy(buf + index, data, len);
                buf[index + len] = '\0';
            }
            if (index + len < total) return;

            xSemaphoreTakeRecursive(g_store.mutex, portMAX_DELAY);

            char err[128];
            prsl_save_status_t st = buf ? prsl_apply_save_body(buf, total, &g_store, err, sizeof(err))
                                        : PRSL_SAVE_INVALID_JSON;
            free(buf);
            req->_tempObject = NULL;
            if (st != PRSL_SAVE_APPLIED) {
                xSemaphoreGiveRecursive(g_store.mutex);
                req->send(400, "text/plain", err);
                return;
            }

            esp_err_t save_result = ESP_OK;
            if (g_on_save) {
                save_result = g_on_save();
            }

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
            if (prsl_is_uploading()) {
                req->send(409, "text/plain", "Upload in progress");
                return;
            }
            if (!g_on_reset) {
                req->send(404, "text/plain", "Not Found");
                return;
            }
            esp_err_t result = g_on_reset();
            if (result == ESP_OK) {
                prsl_store_clear_dirty(&g_store);
                prsl_push();
                req->send(200, "text/plain", "OK");
            } else {
                req->send(500, "text/plain", "Reset failed");
            }
        });

    server->on("/api/system/reboot", HTTP_POST,
        [](AsyncWebServerRequest *req) {
            if (prsl_is_uploading()) {
                req->send(409, "text/plain", "Upload in progress");
                return;
            }
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

    /* ── Upload preflight (POST) and stream (PUT) ─────────────── */

    server->on("/api/upload", HTTP_POST,
        [](AsyncWebServerRequest *req) {
            char group[PRSL_MAX_PATH];
            char key[PRSL_MAX_PATH];

            if (!upload_parse_path(req->url().c_str(), group, key)) {
                upload_send(req, 404, "Unknown field");
                return;
            }
            prsl_field_t *f = prsl_store_find(&g_store, group, key);
            if (!f || f->type != PRSL_FILE) {
                upload_send(req, 404, "Unknown field");
                return;
            }
            if (prsl_is_uploading()) {
                upload_send(req, 409, "Upload in progress");
                return;
            }
            if (g_preflight_overflow) {
                upload_send(req, 400, "Request too large");
                return;
            }

            cJSON *meta = cJSON_ParseWithLength(g_preflight, g_preflight_len);
            if (!meta) {
                upload_send(req, 400, "Invalid metadata");
                return;
            }
            cJSON *jname = cJSON_GetObjectItem(meta, "name");
            cJSON *jsize = cJSON_GetObjectItem(meta, "size");
            cJSON *jtype = cJSON_GetObjectItem(meta, "type");

            bool bad = !(jname && cJSON_IsString(jname));
            double sz = (jsize && cJSON_IsNumber(jsize)) ? jsize->valuedouble : 0;
            /* Positive, integral, and representable in size_t (no UB cast). */
            if (!(sz > 0 && sz < 4294967296.0 && sz == (double)(size_t)sz)) bad = true;

            char mime[PRSL_UPLOAD_MIME_MAX];
            mime[0] = '\0';
            const char *mimep = NULL;
            if (jtype && cJSON_IsString(jtype) && jtype->valuestring[0]) {
                snprintf(mime, sizeof(mime), "%s", jtype->valuestring);
                mimep = mime;
            } else if (jtype) {
                bad = true;  /* type present but not a string */
            }

            if (bad) {
                cJSON_Delete(meta);
                upload_send(req, 400, "Invalid metadata");
                return;
            }

            char err[PRSL_UPLOAD_ERR_MAX];
            int status = 0;
            esp_err_t r = prsl_upload_validate(f, jname->valuestring, mimep,
                                               (size_t)sz, err, sizeof(err), &status);
            cJSON_Delete(meta);
            if (r != ESP_OK) {
                upload_send(req, status, err);
                return;
            }
            upload_send(req, 200, "OK");
        },
        NULL,
        [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
           size_t index, size_t total) {
            (void)total;
            if (index == 0) {
                g_preflight_len = 0;
                g_preflight_overflow = false;
            }
            if (g_preflight_len + len >= sizeof(g_preflight)) {
                g_preflight_overflow = true;
                return;
            }
            memcpy(g_preflight + g_preflight_len, data, len);
            g_preflight_len += len;
            g_preflight[g_preflight_len] = '\0';
        });

    server->on("/api/upload", HTTP_PUT,
        [](AsyncWebServerRequest *req) {
            xSemaphoreTakeRecursive(g_upload_mutex, portMAX_DELAY);
            if (g_upload_stopping) {
                xSemaphoreGiveRecursive(g_upload_mutex);
                req->send(503, "text/plain", "Stopping");
                return;
            }

            if (req->hasAttribute("prsl_upload_status")) {
                long st = req->getAttribute("prsl_upload_status", 0L);
                xSemaphoreGiveRecursive(g_upload_mutex);
                upload_send(req, (int)st, "Upload in progress");
                return;
            }

            if (!req->hasAttribute("prsl_upload_body")) {
                /* The request never reached a body callback. */
                if (prsl_is_uploading()) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 409, "Upload in progress");
                    return;
                }
                memset(&g_upload, 0, sizeof(g_upload));

                String te = req->header("Transfer-Encoding");
                te.toLowerCase();
                if (te.indexOf("chunked") >= 0) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 411, "Content-Length required");
                    return;
                }
                if (!req->hasHeader("Content-Length")) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 411, "Content-Length required");
                    return;
                }
                if (req->contentLength() == 0) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 400, "Empty file");
                    return;
                }
                if (req->contentType() != "application/octet-stream") {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 415, "Expected application/octet-stream");
                    return;
                }

                char group[PRSL_MAX_PATH];
                char key[PRSL_MAX_PATH];
                if (!upload_parse_path(req->url().c_str(), group, key)) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 404, "Unknown field");
                    return;
                }
                prsl_field_t *f = prsl_store_find(&g_store, group, key);
                if (!f || f->type != PRSL_FILE) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 404, "Unknown field");
                    return;
                }
                if (prsl_is_uploading()) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, 409, "Upload in progress");
                    return;
                }

                const char *name = "upload";
                const AsyncWebParameter *pn = req->getParam("name");
                if (pn && pn->value().length()) name = pn->value().c_str();
                const char *mime = NULL;
                const AsyncWebParameter *pt = req->getParam("type");
                if (pt && pt->value().length()) mime = pt->value().c_str();

                char err[PRSL_UPLOAD_ERR_MAX];
                int status = 0;
                esp_err_t r = prsl_upload_validate(f, name, mime,
                                   req->contentLength(), err, sizeof(err), &status);
                if (r != ESP_OK) {
                    xSemaphoreGiveRecursive(g_upload_mutex);
                    upload_send(req, status, err);
                    return;
                }
                /* Valid metadata but no body was ever delivered. */
                xSemaphoreGiveRecursive(g_upload_mutex);
                upload_send(req, 500, "Upload failed");
                return;
            }

            /* Body callbacks ran. */
            if (g_upload.finished) {
                xSemaphoreGiveRecursive(g_upload_mutex);
                upload_send(req, 200, "OK");
                return;
            }
            if (g_upload.err[0]) {
                int st = upload_final_status(&g_upload);
                /* Snapshot the error while still under the mutex; prsl_stop()
                 * memsets g_upload and a concurrent body callback can clobber
                 * g_upload.err once the mutex is released. */
                char msg[PRSL_UPLOAD_ERR_MAX];
                snprintf(msg, sizeof(msg), "%s", g_upload.err);
                xSemaphoreGiveRecursive(g_upload_mutex);
                upload_send(req, st, msg);
                return;
            }
            if (g_upload.default_status) {
                int st = g_upload.default_status;
                const char *msg = (st == 400) ? "Upload rejected" : "Upload failed";
                xSemaphoreGiveRecursive(g_upload_mutex);
                upload_send(req, st, msg);
                return;
            }
            xSemaphoreGiveRecursive(g_upload_mutex);
            upload_send(req, 500, "Upload failed");
        },
        NULL,
        on_upload_body);

    return ESP_OK;
}

esp_err_t prsl_start(void) {
    if (!g_server) return ESP_ERR_INVALID_STATE;
    if (g_ws) return ESP_ERR_INVALID_STATE;  /* already started */
    g_ws = new AsyncWebSocket("/api/events");
    if (!g_ws) return ESP_ERR_NO_MEM;
    prsl_ws_init(g_ws, &g_store);
    /* addHandler transfers ownership to the server — never delete g_ws after
     * this; only removeHandler()/server teardown frees it. */
    g_server->addHandler(g_ws);
    g_server->begin();
    return ESP_OK;
}

esp_err_t prsl_reset(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;
    if (prsl_is_uploading()) return ESP_ERR_INVALID_STATE;
    prsl_store_reset_values(&g_store);
    return prsl_push();
}

esp_err_t prsl_stop(void) {
    if (!g_initialized) return ESP_ERR_INVALID_STATE;

    /* Abort any in-flight upload without racing a body callback. The mutex
     * serializes us against on_upload_body; the generation bump makes late
     * disconnects from a previous request inert. */
    g_upload_stopping = true;
    if (g_upload_mutex) xSemaphoreTakeRecursive(g_upload_mutex, portMAX_DELAY);
    g_upload_generation++;
    if (g_upload.active) prsl_upload_abort(&g_upload);
    upload_flag_set(false);
    memset(&g_upload, 0, sizeof(g_upload));
    if (g_upload_mutex) xSemaphoreGiveRecursive(g_upload_mutex);

    if (g_server) {
        if (g_ws) {
            g_ws->closeAll();                 /* close WS clients */
            g_ws->cleanupClients();
            g_server->removeHandler(g_ws);    /* server deletes g_ws */
            g_ws = NULL;                      /* dangling after removal — do not use */
        }
        g_server->end();                      /* stop the listener */
    }
    prsl_store_deinit(&g_store);
    g_server = NULL;
    g_on_save = NULL;
    g_on_reset = NULL;
    g_on_reboot = NULL;
    g_initialized = false;
    return ESP_OK;
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

esp_err_t prsl_set_val(const char *path, const prsl_val_t *value) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_set_val(&g_store, group_id, key, value);
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

static esp_err_t parse_and_get_number(const char *path, double *out) {
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (!out) return ESP_ERR_INVALID_ARG;
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_get_number(&g_store, group_id, key, out);
}

esp_err_t prsl_get_int(const char *path, int *out) {
    double n;
    if (!out) return ESP_ERR_INVALID_ARG;
    esp_err_t e = parse_and_get_number(path, &n);
    if (e == ESP_OK) {
        if (n < INT_MIN || n > INT_MAX) return ESP_ERR_NOT_FOUND;  /* unrepresentable */
        *out = (int)n;
    }
    return e;
}

esp_err_t prsl_get_float(const char *path, float *out) {
    double n;
    if (!out) return ESP_ERR_INVALID_ARG;
    esp_err_t e = parse_and_get_number(path, &n);
    if (e == ESP_OK) *out = (float)n;
    return e;
}

esp_err_t prsl_get_bool(const char *path, bool *out) {
    if (!out) return ESP_ERR_INVALID_ARG;
    char group_id[PRSL_MAX_PATH] = {0};
    char key[PRSL_MAX_PATH] = {0};
    if (parse_dot_path(path, group_id, key) != ESP_OK) return ESP_ERR_INVALID_ARG;
    return prsl_store_get_bool(&g_store, group_id, key, out);
}

/* ── Has reset ────────────────────────────────────────────────── */

bool prsl_has_reset(void) {
    return g_on_reset != NULL;
}

bool prsl_has_reboot(void) {
    return g_on_reboot != NULL;
}

/* ── Shared settings payload builder ─────────────────────────── */

cJSON *prsl_build_settings_payload(prsl_store_t *store) {
    return prsl_json_build_settings_payload(store, prsl_store_is_dirty(store),
        prsl_has_reset(), prsl_has_reboot(), prsl_is_uploading());
}

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t prsl_push(void) {
    xSemaphoreTakeRecursive(g_store.mutex, portMAX_DELAY);
    cJSON *root = prsl_build_settings_payload(&g_store);
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (str) {
        if (g_ws) g_ws->textAll(str);
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
        if (g_ws) g_ws->textAll(str);
        free(str);
    }
    xSemaphoreGiveRecursive(g_store.mutex);
    return ESP_OK;
}
