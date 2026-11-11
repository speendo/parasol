/*
 * OTA firmware upload: validate the image, stream it into the OTA partition
 * with Arduino Update, then reboot. The HTTP response must be sent before
 * esp_restart(), so the reboot runs in a task with a short delay.
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include <Update.h>
#include <esp_system.h>
#include <stdio.h>
#include <string.h>

/* Extension check is a cheap sanity guard; Update.end() validates the image. */
static bool ends_with(const char *s, const char *suffix) {
    size_t n = strlen(s), m = strlen(suffix);
    return n >= m && strcmp(s + n - m, suffix) == 0;
}

/* Set only after Update.begin() succeeds, so ABORT is safe on early rejects. */
static bool g_ota_started;

static void reboot_task(void *arg) {
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(1000));   /* let the HTTP response flush */
    esp_restart();
}

static const char *fw_label(void) {
    return "firmware.bin";
}

static esp_err_t on_fw(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        /* Metadata only: reject before any bytes are written. */
        if (!ends_with(u->name, ".bin")) {
            snprintf(u->err, u->err_len, "Expected a .bin image");
            return ESP_ERR_INVALID_ARG;           /* 400 */
        }
        /* Update.begin() checks the image against the OTA partition. */
        if (!Update.begin(u->size)) {
            snprintf(u->err, u->err_len, "Image does not fit");
            return ESP_FAIL;                      /* 400 */
        }
        g_ota_started = true;
        break;

    case PRSL_UPLOAD_CHUNK:
        /* Stream each network chunk into the OTA partition. */
        if (Update.write((uint8_t *)u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Flash write failed");
            u->status = 500;                      /* device error, not bad file */
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        /* Finalize and schedule the reboot after the HTTP response is sent. */
        if (!Update.end(true)) {
            snprintf(u->err, u->err_len, "Invalid image");
            return ESP_FAIL;                      /* 500 */
        }
        g_ota_started = false;
        xTaskCreate(reboot_task, "reboot", 2048, NULL, 5, NULL);
        break;

    case PRSL_UPLOAD_ABORT:
        /* Cancel, disconnect, timeout, or a rejection above. */
        if (g_ota_started) {
            Update.abort();
            g_ota_started = false;
        }
        break;
    }
    return ESP_OK;
}

/* max_size = 0 means no device limit; Update.begin() checks the OTA partition. */
/* on_get, on_upload, accept, max_size, idle_timeout_ms, help, attrs */
static const prsl_file_opts_t fw_opts = {
    fw_label, on_fw, ".bin,application/octet-stream", 0, 30000,
    "Firmware .bin image", NULL
};

void app_main(void) {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-ota", NULL);
    AsyncWebServer server(80);

    prsl_add_group("system", "System");
    prsl_add_file_field("system", "firmware", "Firmware", &fw_opts);
    prsl_init(&server, NULL, NULL, NULL);
    prsl_start();
}
