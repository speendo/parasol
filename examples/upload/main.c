/*
 * Deferred upload: chunks go to a temp file; END marks the form dirty so Save
 * appears. Save promotes temp -> final; Reset discards the temp and restores
 * the previous label. The existing final file is untouched until Save.
 */
#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "LittleFS.h"
#include <stdio.h>
#include <string.h>

#define CLIP_MAX   (512 * 1024)
#define CLIP_TMP   "/clip.tmp"
#define CLIP_FINAL "/clip.mp3"
#define CLIP_LABEL "clip.mp3"

static File g_file;
static bool g_pending;      /* a temp upload is waiting for Save */

/* Load hook: label shown after boot and after Reset. */
static const char *clip_label(void) {
    return LittleFS.exists(CLIP_FINAL) ? CLIP_LABEL : "none";
}

static esp_err_t on_clip(prsl_upload_t *u) {
    switch (u->event) {
    case PRSL_UPLOAD_META:
        /* Open temp; the existing final file is not touched yet. */
        g_file = LittleFS.open(CLIP_TMP, "w");
        if (!g_file) {
            snprintf(u->err, u->err_len, "Cannot open temp file");
            return ESP_FAIL;
        }
        g_pending = true;
        break;

    case PRSL_UPLOAD_CHUNK:
        /* Write each network chunk to the temp file. */
        if (g_file.write(u->data, u->len) != u->len) {
            snprintf(u->err, u->err_len, "Write failed");
            return ESP_FAIL;
        }
        break;

    case PRSL_UPLOAD_END:
        /* Upload complete, but not committed. Show a pending label and mark
         * dirty so the Save button appears. */
        g_file.close();
        prsl_set_str("audio.clip", "clip.mp3 (pending)");
        prsl_set_dirty(true);
        prsl_push();
        break;

    case PRSL_UPLOAD_ABORT:
        /* Cancel, disconnect, timeout, or a rejection: discard the temp. */
        if (g_file) g_file.close();
        LittleFS.remove(CLIP_TMP);
        g_pending = false;
        break;
    }
    return ESP_OK;
}

/* Save: promote the temp file to the final name, then update the label. */
static esp_err_t save(void) {
    if (!g_pending) return ESP_OK;
    LittleFS.remove(CLIP_FINAL);
    if (!LittleFS.rename(CLIP_TMP, CLIP_FINAL)) return ESP_FAIL;
    g_pending = false;
    prsl_set_str("audio.clip", CLIP_LABEL);
    return ESP_OK;
}

/* Reset: discard the temp and restore the label of the current final file. */
static esp_err_t reset(void) {
    if (g_pending) {
        LittleFS.remove(CLIP_TMP);
        g_pending = false;
    }
    prsl_set_str("audio.clip", clip_label());
    return ESP_OK;
}

/* on_get, on_upload, accept, max_size, idle_timeout_ms, help, attrs */
static const prsl_file_opts_t clip_opts = {
    clip_label, on_clip, ".mp3,audio/*", CLIP_MAX, 30000,
    "MP3, up to 512 KiB. Save applies it.", NULL
};

void app_main(void) {
    LittleFS.begin(true);
    LittleFS.remove(CLIP_TMP);          /* drop a stale pending upload */
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-upload", NULL);
    AsyncWebServer server(80);

    prsl_add_group("audio", "Audio");
    prsl_add_file_field("audio", "clip", "Clip", &clip_opts);
    prsl_init(&server, save, reset, NULL);   /* Save commits, Reset discards */
    prsl_start();
}
