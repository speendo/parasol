#include "prsl.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

static const char *load_ssid(void) {
    nvs_handle_t h;
    static char buf[64];
    if (nvs_open("parasol", NVS_READONLY, &h) == ESP_OK) {
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
    if (nvs_open("parasol", NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(buf);
        if (nvs_get_str(h, "wifi.pass", buf, &len) == ESP_OK) {
            nvs_close(h);
            return buf;
        }
        nvs_close(h);
    }
    return "";
}

static esp_err_t on_ssid_change(const char *group_id, const char *key,
                                 const char *value) {
    printf("%s.%s changed to: %s\n", group_id, key, value);
    if (value && strlen(value) > 32) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

static void save_to_nvs(const char *pairs[][2], int count) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READWRITE, &h) != ESP_OK) return;

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

static bool check_dirty(const char *group_id, const char *key,
                         const char *current_value) {
    nvs_handle_t h;
    if (nvs_open("parasol", NVS_READONLY, &h) != ESP_OK) return true;
    char saved[64]; size_t len = sizeof(saved);
    char path[128];
    snprintf(path, sizeof(path), "%s.%s", group_id, key);
    bool differs = (nvs_get_str(h, path, saved, &len) != ESP_OK ||
                    strcmp(saved, current_value ? current_value : ""));
    nvs_close(h);
    return differs;
}

void app_main(void) {
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("parasol-config", NULL);
    AsyncWebServer server(80);

    prsl_set_dirty_check(check_dirty);

    prsl_add_group("wifi", "Wi-Fi Setup");
    prsl_add_group("system", "System Status");

    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID",
        &(prsl_field_opts_t){
            .on_get = load_ssid,
            .on_set = on_ssid_change,
            .help   = "Network name - 1-32 characters",
            .attrs  = "{\"required\":true,\"maxlength\":32}",
        });

    prsl_add_field(PRSL_PASSWORD, "wifi", "pass", "Password",
        &(prsl_field_opts_t){
            .on_get = load_pass,
            .help   = "At least 8 characters",
        });

    prsl_add_field(PRSL_TEXT, "system", "uptime", "Uptime",
        &(prsl_field_opts_t){ .is_status = true });

    prsl_init(&server, save_to_nvs);
    prsl_start();

    int seconds = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(3000));
        seconds += 3;
        char buf[64];
        snprintf(buf, sizeof(buf), "%ds", seconds);
        prsl_set("system.uptime", buf);
        prsl_broadcast_status();
    }
}
