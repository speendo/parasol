/*
 * Minimal file upload: replace /config.json with a JSON object uploaded from
 * the browser. The old file survives until the new one is complete.
 *
 * Flow:
 *   preflight (accept/max_size) -> raw PUT ->
 *   META (open temp) -> CHUNK* (check first byte, write) ->
 *   END (rename temp to final) or ABORT (delete temp).
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "LittleFS.h"
#include <stdio.h>

/* Final file, temp file, and a device-enforced hard limit. */
#define CONFIG_PATH "/config.json"
#define CONFIG_TMP  "/config.tmp"
#define CONFIG_MAX  (8 * 1024)

/* The library allows one upload at a time, so one global handle is enough.
 * Every byte written here came through on_config() below. */
static File g_file;

/* on_get is the load hook: it returns the label the browser shows after boot
 * and after Reset. Check storage so a reboot shows the right state. */
static const char *config_label(void) {
    return LittleFS.exists(CONFIG_PATH) ? "config.json" : "none";
}

/* The upload callback runs in the ESPAsyncWebServer task. Write data
 * synchronously: u->data is only valid during this call. */
static esp_err_t on_config(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        /* No bytes yet; u->name/u->size/u->mime are available. Reject here to
         * avoid writing anything. The library already enforced max_size and
         * the accept filter; this is the developer's hook for extra rules. */
        g_file = LittleFS.open(CONFIG_TMP, "w");
        if (!g_file) {
            snprintf(u->err, u->err_len, "Cannot open temp file");
            return ESP_FAIL;                    /* browser shows this text */
        }
        break;

    case PRSL_UPLOAD_CHUNK:
        /* One sanity check: the first byte of the first chunk must be '{'.
         * Reject before writing, so an mp3 renamed to .json never lands. */
        if (u->offset == 0 && (u->len == 0 || u->data[0] != '{')) {
            snprintf(u->err, u->err_len, "Not a JSON object");
            return ESP_ERR_INVALID_ARG;
        }
        /* Write this chunk. A short write is a device error. */
        if (g_file.write(u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Write failed");
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        /* All bytes arrived. Swap the temp file into place. Do not set dirty:
         * this example applies immediately; there is nothing for Save to do. */
        g_file.close();
        LittleFS.remove(CONFIG_PATH);           /* see the backup note below */
        if (!LittleFS.rename(CONFIG_TMP, CONFIG_PATH)) {
            snprintf(u->err, u->err_len, "Rename failed");
            return ESP_FAIL;                    /* ABORT deletes the temp */
        }
        prsl_set_str("config.file", "config.json");
        prsl_push();                            /* update every open browser */
        break;

    case PRSL_UPLOAD_ABORT:
        /* Cancel, disconnect, idle timeout, or a rejection above. Clean up
         * exactly once; never leave a partial file behind. */
        if (g_file) g_file.close();
        LittleFS.remove(CONFIG_TMP);
        break;
    }
    return ESP_OK;
}

/* Registration: limits are device-enforced; accept is a picker/hint.
 * help is rendered under the field. attrs could add extra HTML (e.g. title). */
/* on_get, on_upload, accept, max_size, idle_timeout_ms, help, attrs */
static const prsl_file_opts_t config_opts = {
    config_label, on_config, ".json,application/json", CONFIG_MAX, 30000,
    "JSON config, up to 8 KiB", NULL
};

void app_main(void) {
    LittleFS.begin(true);                       /* format on first use */

    /* Minimal AP; replace with your normal WiFi setup. */
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-config", NULL);
    AsyncWebServer server(80);

    /* Register groups before fields; finish all registration before init. */
    prsl_add_group("config", "Config");
    prsl_add_file_field("config", "file", "Config file", &config_opts);
    prsl_init(&server, NULL, NULL, NULL);       /* no save/reset/reboot here */
    prsl_start();                               /* serve the UI + endpoints */
}
