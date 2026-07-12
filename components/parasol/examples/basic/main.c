#include "pwui.h"
#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "nvs_flash.h"
#include <stdio.h>

static esp_err_t load_from_nvs(cJSON *root) {
    cJSON *wifi = cJSON_CreateObject();
    cJSON_AddItemToObject(wifi, "ssid",
        cJSON_Parse("[\"text\",\"SSID\",{\"value\":\"MyNetwork\"}]"));
    cJSON_AddItemToObject(wifi, "pass",
        cJSON_Parse("[\"password\",\"Password\",{\"value\":\"\"}]"));
    cJSON_AddItemToObject(root, "wifi", wifi);
    return ESP_OK;
}

static esp_err_t save_to_nvs(cJSON *root) {
    printf("Save called\n");
    return ESP_OK;
}

static esp_err_t reset_defaults(cJSON *root) {
    printf("Reset called\n");
    return ESP_OK;
}

static void on_ssid_change(const char *comp_id, const char *key, const char *value) {
    printf("SSID changed to: %s\n", value);
}

void app_main(void) {
    nvs_flash_init();
    WiFi.mode(WIFI_AP);
    WiFi.softAP("pico-config", NULL);

    AsyncWebServer server(80);

    pwui_begin_component("wifi", "Wi-Fi Setup", false);
    pwui_add_field(PWUI_TEXT, "wifi", "ssid", "SSID",
                   PWUI_VALUE, "MyNetwork",
                   PWUI_APPLY, on_ssid_change,
                   PWUI_END);
    pwui_add_field(PWUI_PASSWORD, "wifi", "pass", "Password",
                   PWUI_HELP, "At least 8 characters", PWUI_END);
    pwui_end_component("wifi");

    pwui_begin_component("system", "System Status", true);
    pwui_add_field(PWUI_TEXT, "system", "uptime", "Uptime", PWUI_VALUE, "", PWUI_END);
    pwui_end_component("system");

    pwui_storage_t storage = {
        .on_load = load_from_nvs,
        .on_save = save_to_nvs,
        .on_reset = reset_defaults,
    };

    pwui_init(&server, &storage);
    pwui_start();

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
