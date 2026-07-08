#include "pwui.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

/* ── Per-field load callbacks ─────────────────────────────────
 * Called at pwui_init time. Return persisted value (or factory default)
 * from NVS. Return NULL if no value stored yet.
 */

static const char *load_ssid(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("pwui", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.ssid", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "MyNetwork";
}

static const char *load_pass(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("pwui", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.pass", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "";
}

/* ── Apply callback ───────────────────────────────────────────
 * on_apply fires on blur/change AND on Save.
 * Return ESP_OK to accept. Return anything else to reject (Save aborts).
 */

static esp_err_t on_ssid_change(const char *comp_id, const char *key,
                                 const char *value) {
    printf("%s.%s changed to: %s\n", comp_id, key, value);
    if (value && strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

/* ── Commit callback ──────────────────────────────────────────
 * Called once per Save, after all on_apply have returned ESP_OK.
 * All changed pairs are passed as a flat array. Do ONE nvs_open /
 * write loop / nvs_commit / nvs_close to minimize flash wear.
 *
 * Compare against current NVS value before writing — skip if unchanged.
 */

static void commit_to_nvs(const char *pairs[][2], int count) {
    nvs_handle_t h;
    if (nvs_open("pwui", NVS_READWRITE, &h) != ESP_OK) return;

    for (int i = 0; i < count; i++) {
        char current[64];
        size_t len = sizeof(current);
        if (nvs_get_str(h, pairs[i][0], current, &len) == ESP_OK
            && strcmp(current, pairs[i][1]) == 0) continue;
        nvs_set_str(h, pairs[i][0], pairs[i][1]);
    }

    nvs_commit(h);
    nvs_close(h);
    printf("Saved %d changed field(s) to NVS\n", count);
}

/* ── Main ───────────────────────────────────────────────────── */

void app_main(void) {
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("pico-config", NULL);
    AsyncWebServer server(80);

    /* Register components and fields BEFORE pwui_init */

    pwui_begin_component("wifi", "Wi-Fi Setup", false);
    pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
        &(pwui_field_opts_t){
            .on_load  = load_ssid,
            .on_apply = on_ssid_change,
            .help     = "Network name - 1-32 characters",
            .attrs    = "{\"required\":true,\"maxlength\":32}",
        });
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
        &(pwui_field_opts_t){
            .on_load  = load_pass,
            .on_apply = NULL,
            .help     = "At least 8 characters",
        });
    pwui_end_component("wifi");

    /* Status component: on_load = NULL (ignored, values come from runtime loop) */
    pwui_begin_component("system", "System Status", true);
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime",
        &(pwui_field_opts_t){
            .on_load  = NULL,
            .on_apply = NULL,
        });
    pwui_end_component("system");

    /* init + start */
    pwui_init(&server, commit_to_nvs);
    pwui_start();

    /* Runtime loop */
    int seconds = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        seconds += 3;
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", seconds);
        pwui_set("system.uptime", buf);
        pwui_broadcast_status();
    }
}
