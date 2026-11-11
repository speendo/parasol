#include <Arduino.h>
#include "ESPAsyncWebServer.h"
#include "prsl.h"

AsyncWebServer server(80);

static esp_err_t on_fw(prsl_upload_t *u) {
    (void)u->event; (void)u->group_id; (void)u->key; (void)u->name;
    (void)u->mime; (void)u->size; (void)u->offset; (void)u->data;
    (void)u->len; (void)u->err; (void)u->err_len; (void)u->status;
    return ESP_OK;
}
/* Positional initializers keep this C++ smoke build valid before C++20;
 * field order is on_get, on_upload, accept, max_size, idle_timeout_ms,
 * help, attrs. */
static const prsl_file_opts_t fw_opts = {
    NULL, on_fw, ".bin", 1024, 30000, "Firmware", NULL
};

void setup() {
    prsl_add_group("wifi", "Wi-Fi");
    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID", NULL);
    prsl_add_file_field("wifi", "fw", "Firmware", &fw_opts);
    prsl_init(&server, NULL, NULL, NULL);
    (void)prsl_is_uploading();
    prsl_start();
}

void loop() {
    delay(1000);
}
