/*
 * Secure example: one shared password, a cookie session, and a header-time
 * gate that covers the page, assets, API, uploads, and WebSocket.
 *
 * The gate is an AsyncWebHandler installed BEFORE prsl_init(). Handler
 * selection happens at the end of the headers, so an unauthorized request
 * never attaches the prsl handler and never reaches an upload/save body
 * callback. Server middleware runs too late for that in ESPAsyncWebServer.
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "session_cookie.h"
#include <esp_random.h>
#include <nvs_flash.h>
#include <LittleFS.h>
#include <stdio.h>
#include <string.h>

#define ADMIN_PASSWORD "CHANGE-ME"
#define AP_SSID        "parasol-secure"
#define AP_PASSWORD    "CHANGE-ME-AP"
#define COOKIE_SECURE  ""   /* use "; Secure" when the server runs HTTPS */

static char g_token[33];    /* empty = no session */

/* ── Persisted field ───────────────────────────────────────── */

static const char *load_name(void) {
    static char buf[33];
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof buf;
        if (nvs_get_str(h, "system.name", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "parasol";
}

static esp_err_t on_name(const char *group_id, const char *key,
                         const prsl_val_t *value) {
    (void)group_id;
    (void)key;
    if (value->kind != PRSL_VAL_STRING || !value->u.str) {
        return ESP_ERR_INVALID_ARG;
    }
    size_t n = strlen(value->u.str);
    if (n < 1 || n > 32) return ESP_ERR_INVALID_ARG;
    esp_err_t r = prsl_set_val("system.name", value);
    if (r == ESP_OK) prsl_set_dirty(true);
    return r;
}

static esp_err_t save_to_nvs(void) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READWRITE, &h) != ESP_OK) return ESP_FAIL;
    const char *name = prsl_get("system.name");
    esp_err_t err = ESP_OK;
    if (name) err = nvs_set_str(h, "system.name", name);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

/* Positional initializers keep this C++ smoke build valid before C++20.
 * Field order: is_status, on_get, on_set, help, attrs. */
static const prsl_field_opts_t name_opts = {
    false, load_name, on_name, "Device name", NULL
};

/* ── Uploaded blob ─────────────────────────────────────────── */

#define BLOB_TMP   "/secure.tmp"
#define BLOB_FINAL "/secure.bin"
#define BLOB_LABEL "secure.bin"
#define BLOB_MAX   (64 * 1024)

static File g_blob;

static const char *blob_label(void) {
    return LittleFS.exists(BLOB_FINAL) ? BLOB_LABEL : "none";
}

static esp_err_t on_blob(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        LittleFS.remove(BLOB_TMP);
        g_blob = LittleFS.open(BLOB_TMP, "w");
        if (!g_blob) {
            snprintf(u->err, u->err_len, "Cannot open temp file");
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_CHUNK:
        if (g_blob.write(u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Write failed");
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        g_blob.close();
        LittleFS.remove(BLOB_FINAL);
        if (!LittleFS.rename(BLOB_TMP, BLOB_FINAL)) {
            LittleFS.remove(BLOB_TMP);
            snprintf(u->err, u->err_len, "Commit failed");
            return ESP_FAIL;
        }
        prsl_set_dirty(true);
        prsl_push();
        break;

    case PRSL_UPLOAD_ABORT:
        if (g_blob) g_blob.close();
        LittleFS.remove(BLOB_TMP);
        break;
    }
    return ESP_OK;
}

/* Field order: on_get, on_upload, accept, max_size, idle_timeout_ms,
 * help, attrs. */
static const prsl_file_opts_t blob_opts = {
    blob_label, on_blob, ".bin", BLOB_MAX, 30000,
    "Config blob, up to 64 KiB.", NULL
};

/* ── Session ───────────────────────────────────────────────── */

static void new_token(void) {
    static const char hex[] = "0123456789abcdef";
    uint8_t raw[16];
    esp_fill_random(raw, sizeof raw);
    for (int i = 0; i < 16; i++) {
        g_token[i * 2] = hex[raw[i] >> 4];
        g_token[i * 2 + 1] = hex[raw[i] & 0x0f];
    }
    g_token[32] = '\0';
}

static void session_cookie(char *buf, size_t n, bool expire) {
    if (expire) {
        snprintf(buf, n,
                 "prsl_session=; Max-Age=0; Path=/; HttpOnly; "
                 "SameSite=Strict%s", COOKIE_SECURE);
    } else {
        snprintf(buf, n,
                 "prsl_session=%s; Path=/; HttpOnly; SameSite=Strict%s",
                 g_token, COOKIE_SECURE);
    }
}

static bool valid_session(AsyncWebServerRequest *req) {
    return session_cookie_matches(req->header("Cookie").c_str(), g_token);
}

static void send_redirect(AsyncWebServerRequest *req, const char *loc,
                          const char *cookie) {
    AsyncWebServerResponse *res = req->beginResponse(303);
    res->addHeader("Location", loc);
    res->addHeader("Set-Cookie", cookie);
    req->send(res);
}

/* ── Gate ──────────────────────────────────────────────────── */

static bool is_public_path(AsyncWebServerRequest *req) {
    const String &u = req->url();
    if (u == "/pico.jade.min.css") return req->method() == HTTP_GET;
    if (u == "/login" || u == "/logout")
        return req->method() == HTTP_GET || req->method() == HTTP_POST;
    return false;
}

static bool is_api(AsyncWebServerRequest *req) {
    return req->url().startsWith("/api/");
}

static bool origin_ok(AsyncWebServerRequest *req) {
    if (!req->isWebSocketUpgrade()) return true;
    return origin_matches(req->header("Origin").c_str(),
                          req->host().c_str());
}

class Gate : public AsyncWebHandler {
    bool canHandle(AsyncWebServerRequest *req) const override {
        if (is_public_path(req)) return false;
        if (!valid_session(req)) return true;
        if (!origin_ok(req)) return true;
        return false;
    }

    void handleRequest(AsyncWebServerRequest *req) override {
        if (is_api(req)) req->send(401, "text/plain", "Unauthorized");
        else req->redirect("/login", 302);
    }
};

/* ── Pages ─────────────────────────────────────────────────── */

static const char LOGIN_HTML[] = R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title>
<link rel="stylesheet" href="/pico.jade.min.css">
</head>
<body>
<dialog open>
<article>
<header><h2>PARASOL</h2></header>
<!--ERROR-->
<form method="post" action="/login">
<label>Password
<input type="password" name="password" autocomplete="current-password" autofocus required>
</label>
<button type="submit">Sign in</button>
</form>
</article>
</dialog>
</body>
</html>)HTML";

static const char LOGIN_ERROR[] =
    "<p role=\"alert\"><mark>Wrong password</mark></p>";

static const char LOGOUT_HTML[] = R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign out</title>
<link rel="stylesheet" href="/pico.jade.min.css">
</head>
<body>
<dialog open>
<article>
<header><h2>Sign out</h2></header>
<p>End this session on the device?</p>
<form method="post" action="/logout">
<button type="submit">Sign out</button>
<a href="/" role="button" class="secondary">Cancel</a>
</form>
</article>
</dialog>
</body>
</html>)HTML";

static void send_login_page(AsyncWebServerRequest *req, int code, bool bad) {
    String page(LOGIN_HTML);
    page.replace("<!--ERROR-->", bad ? LOGIN_ERROR : "");
    req->send(code, "text/html", page);
}

/* ── Routes ────────────────────────────────────────────────── */

static void on_login_get(AsyncWebServerRequest *req) {
    if (valid_session(req)) {
        req->redirect("/", 302);
        return;
    }
    send_login_page(req, 200, false);
}

static void on_login_post(AsyncWebServerRequest *req) {
    const String &pw = req->arg("password");
    if (pw.length() == 0 || strcmp(pw.c_str(), ADMIN_PASSWORD) != 0) {
        send_login_page(req, 401, true);
        return;
    }

    new_token();
    (void)prsl_disconnect_clients();

    char cookie[128];
    session_cookie(cookie, sizeof cookie, false);
    send_redirect(req, "/", cookie);
}

static void on_logout_get(AsyncWebServerRequest *req) {
    req->send(200, "text/html", LOGOUT_HTML);
}

static void on_logout_post(AsyncWebServerRequest *req) {
    char cookie[128];
    session_cookie(cookie, sizeof cookie, true);

    /* Only a valid session may revoke the current token or kick clients. */
    if (valid_session(req)) {
        memset(g_token, 0, sizeof g_token);
        (void)prsl_disconnect_clients();
    }

    send_redirect(req, "/login", cookie);
}

/* ── Entry point ───────────────────────────────────────────── */

void app_main(void) {
    nvs_flash_init();
    LittleFS.begin(true);
    LittleFS.remove(BLOB_TMP);          /* drop a stale pending upload */
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);

    AsyncWebServer server(80);

    /* BEFORE prsl_init: the gate must be the first handler. */
    server.addHandler(new Gate());

    prsl_add_group("system", "System");
    prsl_add_field(PRSL_TEXT, "system", "name", "Name", &name_opts);
    prsl_add_file_field("system", "blob", "Config blob", &blob_opts);
    prsl_init(&server, save_to_nvs, NULL, NULL);

    server.on("/login", HTTP_GET, on_login_get);
    server.on("/login", HTTP_POST, on_login_post);
    server.on("/logout", HTTP_GET, on_logout_get);
    server.on("/logout", HTTP_POST, on_logout_post);

    prsl_start();

    /* Keep app_main alive: the server is an automatic local and must not be
     * destroyed. Arduino sketches instead use setup()/loop(). */
    for (;;) vTaskDelay(pdMS_TO_TICKS(1000));
}
