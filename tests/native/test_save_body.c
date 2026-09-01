#include "unity.h"
#include "prsl_store.h"
#include "prsl_body.h"
#include "cJSON.h"
#include <string.h>

static prsl_store_t store;

void setUp(void) {
    prsl_store_init(&store);
    prsl_store_add_group(&store, "wifi", "WiFi");
    prsl_store_add_group(&store, "_meta", "Meta");
}
void tearDown(void) { prsl_store_deinit(&store); }

static void add_field_no_cb(const char *g, const char *k) {
    prsl_field_t f = {0};
    f.group_id = g; f.key = k; f.label = k; f.type = PRSL_TEXT;
    f.help = ""; f.attrs = ""; f.on_set = NULL;
    prsl_store_add_field(&store, &f);
}

static esp_err_t reject_cb(const char *g, const char *k, const char *v) {
    (void)g; (void)k; (void)v;
    return ESP_ERR_INVALID_ARG;
}

void test_save_body_no_wrapper_applies(void) {
    add_field_no_cb("wifi", "ssid");
    const char *json = "{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"MyNet\"}]}}";
    char err[128];
    prsl_save_status_t st = prsl_apply_save_body(json, strlen(json), &store, err, sizeof(err));
    TEST_ASSERT_EQUAL(PRSL_SAVE_APPLIED, st);
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("MyNet", cJSON_GetStringValue(v));
}

void test_save_body_invalid_json_rejected(void) {
    add_field_no_cb("wifi", "ssid");
    const char *json = "{\"wifi\":{\"ssid\":";
    char err[128];
    prsl_save_status_t st = prsl_apply_save_body(json, strlen(json), &store, err, sizeof(err));
    TEST_ASSERT_EQUAL(PRSL_SAVE_INVALID_JSON, st);
    TEST_ASSERT_EQUAL_STRING("Invalid JSON", err);
}

void test_save_body_truncated_parse_length(void) {
    add_field_no_cb("wifi", "ssid");
    const char *json = "{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"MyNet\"}]}}";
    char err[128];
    prsl_save_status_t st = prsl_apply_save_body(json, strlen(json) / 2, &store, err, sizeof(err));
    TEST_ASSERT_EQUAL(PRSL_SAVE_INVALID_JSON, st);
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v);
}

void test_save_body_underscore_group_skipped(void) {
    add_field_no_cb("_meta", "hidden");
    const char *json = "{\"_meta\":{\"hidden\":[\"text\",\"Hidden\",{\"value\":\"x\"}]}}";
    char err[128];
    prsl_save_status_t st = prsl_apply_save_body(json, strlen(json), &store, err, sizeof(err));
    TEST_ASSERT_EQUAL(PRSL_SAVE_APPLIED, st);
    cJSON *v = prsl_store_get_value(&store, "_meta", "hidden");
    TEST_ASSERT_NULL(v);
}

void test_save_body_on_set_rejection_message(void) {
    prsl_field_t f = {0};
    f.group_id = "wifi"; f.key = "ssid"; f.label = "SSID"; f.type = PRSL_TEXT;
    f.help = ""; f.attrs = ""; f.on_set = reject_cb;
    prsl_store_add_field(&store, &f);
    const char *json = "{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"MyNet\"}]}}";
    char err[128];
    prsl_save_status_t st = prsl_apply_save_body(json, strlen(json), &store, err, sizeof(err));
    TEST_ASSERT_EQUAL(PRSL_SAVE_REJECTED, st);
    TEST_ASSERT_EQUAL_STRING("on_set rejected wifi.ssid", err);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_save_body_no_wrapper_applies);
    RUN_TEST(test_save_body_invalid_json_rejected);
    RUN_TEST(test_save_body_truncated_parse_length);
    RUN_TEST(test_save_body_underscore_group_skipped);
    RUN_TEST(test_save_body_on_set_rejection_message);
    return UNITY_END();
}