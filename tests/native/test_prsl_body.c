#include "unity.h"
#include "prsl_store.h"
#include "prsl_body.h"
#include "prsl_json.h"
#include "cJSON.h"
#include <string.h>

static prsl_store_t store;
static int set_calls = 0;

static esp_err_t on_set_spy(const char *g, const char *k, const char *v) {
    (void)g; (void)k; (void)v;
    set_calls++;
    return ESP_OK;
}
static esp_err_t on_set_reject(const char *g, const char *k, const char *v) {
    (void)g; (void)k; (void)v;
    return ESP_ERR_INVALID_ARG;
}

static void add_field_cb(const char *g, const char *k, prsl_set_cb_t cb) {
    prsl_field_t f = {0};
    f.group_id = g; f.key = k; f.label = k; f.type = PRSL_TEXT;
    f.help = ""; f.attrs = ""; f.on_set = cb;
    prsl_store_add_field(&store, &f);
}

static void add_field_no_cb(const char *g, const char *k) {
    add_field_cb(g, k, NULL);
}

void setUp(void) {
    set_calls = 0;
    prsl_store_init(&store);
    prsl_store_add_group(&store, "wifi", "WiFi");
    prsl_store_add_group(&store, "_meta", "Meta");
    prsl_store_add_group(&store, "sys", "Sys");
}

void tearDown(void) {
    prsl_store_deinit(&store);
}

static cJSON *make_body(void) {
    cJSON *body = cJSON_CreateObject();
    cJSON *wifi = cJSON_CreateObject();
    cJSON *arr = cJSON_CreateArray();
    cJSON_AddItemToArray(arr, cJSON_CreateString("text"));
    cJSON_AddItemToArray(arr, cJSON_CreateString("SSID"));
    cJSON *opts = cJSON_CreateObject();
    cJSON_AddStringToObject(opts, "value", "MyNet");
    cJSON_AddItemToArray(arr, opts);
    cJSON_AddItemToObject(wifi, "ssid", arr);
    cJSON_AddItemToObject(body, "wifi", wifi);
    return body;
}

void test_apply_no_on_set_writes_store(void) {
    add_field_no_cb("wifi", "ssid");
    cJSON *body = make_body();
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_NULL(rej.group_id);
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("MyNet", cJSON_GetStringValue(v));
    cJSON_Delete(body);
}

void test_apply_with_on_set_does_not_write_store(void) {
    add_field_cb("wifi", "ssid", on_set_spy);
    cJSON *body = make_body();
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL(1, set_calls);
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v);
    cJSON_Delete(body);
}

void test_apply_underscore_group_skipped(void) {
    add_field_no_cb("_meta", "hidden");
    cJSON *body = cJSON_CreateObject();
    cJSON *meta = cJSON_CreateObject();
    cJSON *arr = cJSON_CreateArray();
    cJSON_AddItemToArray(arr, cJSON_CreateString("text"));
    cJSON_AddItemToArray(arr, cJSON_CreateString("Hidden"));
    cJSON *opts = cJSON_CreateObject();
    cJSON_AddStringToObject(opts, "value", "x");
    cJSON_AddItemToArray(arr, opts);
    cJSON_AddItemToObject(meta, "hidden", arr);
    cJSON_AddItemToObject(body, "_meta", meta);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(0, n);
    TEST_ASSERT_NULL(rej.group_id);
    cJSON *v = prsl_store_get_value(&store, "_meta", "hidden");
    TEST_ASSERT_NULL(v);
    cJSON_Delete(body);
}

void test_apply_rejection_populated(void) {
    add_field_cb("wifi", "ssid", on_set_reject);
    cJSON *body = make_body();
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(0, n);
    TEST_ASSERT_NOT_NULL(rej.group_id);
    TEST_ASSERT_EQUAL_STRING("wifi", rej.group_id);
    TEST_ASSERT_EQUAL_STRING("ssid", rej.key);
    cJSON_Delete(body);
}

void test_apply_short_array_skipped(void) {
    add_field_no_cb("wifi", "ssid");
    cJSON *body = cJSON_CreateObject();
    cJSON *wifi = cJSON_CreateObject();
    cJSON_AddItemToObject(wifi, "ssid", cJSON_CreateString("notarray"));
    cJSON_AddItemToObject(body, "wifi", wifi);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(0, n);
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v);
    cJSON_Delete(body);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_apply_no_on_set_writes_store);
    RUN_TEST(test_apply_with_on_set_does_not_write_store);
    RUN_TEST(test_apply_underscore_group_skipped);
    RUN_TEST(test_apply_rejection_populated);
    RUN_TEST(test_apply_short_array_skipped);
    return UNITY_END();
}
