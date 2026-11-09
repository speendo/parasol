#include <Arduino.h>
#include "ESPAsyncWebServer.h"
#include "prsl.h"

AsyncWebServer server(80);

void setup() {
    prsl_add_group("wifi", "Wi-Fi");
    prsl_add_field(PRSL_TEXT, "wifi", "ssid", "SSID", NULL);
    prsl_init(&server, NULL, NULL, NULL);
    prsl_start();
}

void loop() {
    delay(1000);
}
