#include "unity.h"
#include "prsl_store.h"
#include "prsl_body.h"
#include "prsl_json.h"
#include "prsl_ws_handle.h"
#include "cJSON.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static prsl_store_t store;

/* Device-only symbol (src/prsl.cpp). Host stub: meta flags fixed false. */
cJSON *prsl_build_settings_payload(prsl_store_t *s) {
    return prsl_json_build_settings_payload(s, false, false, false, false);
}

void setUp(void) {
    prsl_store_init(&store);
    prsl_store_add_group(&store, "wifi", "WiFi");
}
void tearDown(void) { prsl_store_deinit(&store); }

static void add_text(const char *g, const char *k, const char *v, prsl_set_cb_t cb) {
    prsl_field_t f = {0};
    f.group_id = g; f.key = k; f.label = k; f.type = PRSL_TEXT;
    f.help = ""; f.attrs = ""; f.on_set = cb;
    prsl_store_add_field(&store, &f);
    if (v) prsl_store_set_json(&store, g, k, cJSON_CreateString(v));
}

static esp_err_t store_double(const char *g, const char *k, const prsl_val_t *v) {
    if (v->kind != PRSL_VAL_NUMBER) return ESP_ERR_INVALID_ARG;
    char buf[32];
    snprintf(buf, sizeof(buf), "%.0f", v->u.num * 2);
    prsl_store_set_json(&store, g, k, cJSON_CreateString(buf));
    return ESP_OK;
}
static esp_err_t store_nothing(const char *g, const char *k, const prsl_val_t *v) {
    (void)g; (void)k; (void)v; return ESP_OK;
}
static esp_err_t reject_cb(const char *g, const char *k, const prsl_val_t *v) {
    (void)g; (void)k; (void)v; return ESP_ERR_INVALID_ARG;
}

static prsl_ws_reply_t run(const char *json) {
    prsl_ws_reply_t out;
    prsl_ws_handle(json, strlen(json), &store, &out);
    return out;
}
static cJSON *parse(const char *s) { return s ? cJSON_Parse(s) : NULL; }
static void free_reply(prsl_ws_reply_t *r) {
    free(r->to_sender); free(r->to_all); free(r->error);
    r->to_sender = r->to_all = r->error = NULL;
}

void test_ack_for_same_value_apply(void) {
    /* Same value as the store. The no-`on_set` fallback still writes (and
     * counts) the field, so `applied > 0` and a broadcast is produced; the
     * ack is what matters here. */
    add_text("wifi", "ssid", "old", NULL);
    prsl_ws_reply_t r = run(
        "{\"action\":\"apply\",\"i\":7,\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"old\"}]}}}");
    cJSON *ack = parse(r.to_sender);
    TEST_ASSERT_EQUAL_STRING("ack", cJSON_GetStringValue(cJSON_GetObjectItem(ack, "type")));
    TEST_ASSERT_EQUAL(7, cJSON_GetNumberValue(cJSON_GetObjectItem(ack, "i")));
    cJSON *d = cJSON_GetObjectItem(ack, "d");
    TEST_ASSERT_EQUAL_STRING("old", cJSON_GetStringValue(cJSON_GetObjectItem(d, "wifi.ssid")));
    TEST_ASSERT_NULL(cJSON_GetObjectItem(ack, "e"));
    TEST_ASSERT_NULL(r.error);
    TEST_ASSERT_NOT_NULL(r.to_all);
    cJSON_Delete(ack); free_reply(&r);
}

void test_ack_reports_transformed_value(void) {
    add_text("wifi", "pin", "1", store_double);
    prsl_ws_reply_t r = run(
        "{\"action\":\"apply\",\"i\":1,\"data\":{\"wifi\":{\"pin\":[\"number\",\"Pin\",{\"value\":5}]}}}");
    cJSON *ack = parse(r.to_sender);
    TEST_ASSERT_EQUAL_STRING("10",
        cJSON_GetStringValue(cJSON_GetObjectItem(cJSON_GetObjectItem(ack, "d"), "wifi.pin")));
    cJSON_Delete(ack); free_reply(&r);
}

void test_ack_reports_discard_as_old_value(void) {
    add_text("wifi", "ssid", "kept", store_nothing);
    prsl_ws_reply_t r = run(
        "{\"action\":\"apply\",\"i\":1,\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"typed\"}]}}}");
    cJSON *ack = parse(r.to_sender);
    TEST_ASSERT_EQUAL_STRING("kept",
        cJSON_GetStringValue(cJSON_GetObjectItem(cJSON_GetObjectItem(ack, "d"), "wifi.ssid")));
    cJSON_Delete(ack); free_reply(&r);
}

void test_ack_omits_unknown_keys_and_no_all(void) {
    prsl_ws_reply_t r = run(
        "{\"action\":\"apply\",\"i\":3,\"data\":{\"nope\":{\"x\":[\"text\",\"X\",{\"value\":\"v\"}]}}}");
    cJSON *ack = parse(r.to_sender);
    cJSON *d = cJSON_GetObjectItem(ack, "d");
    TEST_ASSERT_EQUAL(0, cJSON_GetArraySize(d));
    TEST_ASSERT_NULL(r.to_all);          /* nothing applied → no broadcast */
    cJSON_Delete(ack); free_reply(&r);
}

void test_ack_with_rejection_sets_e_and_no_error(void) {
    add_text("wifi", "ssid", "old", reject_cb);
    prsl_ws_reply_t r = run(
        "{\"action\":\"apply\",\"i\":4,\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"x\"}]}}}");
    cJSON *ack = parse(r.to_sender);
    TEST_ASSERT_EQUAL_STRING("rejected",
        cJSON_GetStringValue(cJSON_GetObjectItem(cJSON_GetObjectItem(ack, "e"), "wifi.ssid")));
    TEST_ASSERT_NULL(r.error);           /* correlated rejection: ack only */
    cJSON_Delete(ack); free_reply(&r);
}

void test_keys_after_rejection_reported_in_d(void) {
    add_text("wifi", "bad", "old", reject_cb);
    add_text("wifi", "tail", "tailval", NULL);
    prsl_ws_reply_t r = run("{\"action\":\"apply\",\"i\":5,\"data\":{\"wifi\":{"
        "\"bad\":[\"text\",\"Bad\",{\"value\":\"x\"}],"
        "\"tail\":[\"text\",\"Tail\",{\"value\":\"newtail\"}]}}}");
    cJSON *ack = parse(r.to_sender);
    TEST_ASSERT_EQUAL_STRING("tailval",
        cJSON_GetStringValue(cJSON_GetObjectItem(cJSON_GetObjectItem(ack, "d"), "wifi.tail")));
    cJSON_Delete(ack); free_reply(&r);
}

void test_missing_i_is_protocol_error(void) {
    add_text("wifi", "ssid", "old", NULL);
    prsl_ws_reply_t r = run(
        "{\"action\":\"apply\",\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"new\"}]}}}");
    TEST_ASSERT_NULL(r.to_sender);
    TEST_ASSERT_NULL(r.to_all);
    TEST_ASSERT_NOT_NULL(r.error);
    cJSON *e = parse(r.error);
    TEST_ASSERT_EQUAL_STRING("Missing apply id", cJSON_GetStringValue(cJSON_GetObjectItem(e, "message")));
    cJSON_Delete(e); free_reply(&r);
    TEST_ASSERT_EQUAL_STRING("old",
        cJSON_GetStringValue(prsl_store_get_value(&store, "wifi", "ssid")));
}

void test_non_numeric_i_is_protocol_error(void) {
    add_text("wifi", "ssid", "old", NULL);
    prsl_ws_reply_t r = run("{\"action\":\"apply\",\"i\":\"7\",\"data\":{\"wifi\":{\"ssid\":"
        "[\"text\",\"SSID\",{\"value\":\"new\"}]}}}");
    TEST_ASSERT_NULL(r.to_sender);
    TEST_ASSERT_NOT_NULL(r.error);
    TEST_ASSERT_EQUAL_STRING("old",
        cJSON_GetStringValue(prsl_store_get_value(&store, "wifi", "ssid")));
    free_reply(&r);
}

void test_non_object_data_acks_and_errors(void) {
    prsl_ws_reply_t r = run("{\"action\":\"apply\",\"i\":9,\"data\":3}");
    cJSON *ack = parse(r.to_sender);
    TEST_ASSERT_EQUAL(9, cJSON_GetNumberValue(cJSON_GetObjectItem(ack, "i")));
    TEST_ASSERT_NOT_NULL(r.error);
    TEST_ASSERT_NULL(r.to_all);
    cJSON_Delete(ack); free_reply(&r);
}

void test_invalid_json_error_only(void) {
    prsl_ws_reply_t r = run("{\"action\":");
    TEST_ASSERT_NULL(r.to_sender);
    TEST_ASSERT_NOT_NULL(r.error);
    free_reply(&r);
}

void test_unknown_action_is_ignored(void) {
    prsl_ws_reply_t r = run("{\"action\":\"nope\"}");
    TEST_ASSERT_NULL(r.to_sender);
    TEST_ASSERT_NULL(r.to_all);
    TEST_ASSERT_NULL(r.error);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_ack_for_same_value_apply);
    RUN_TEST(test_ack_reports_transformed_value);
    RUN_TEST(test_ack_reports_discard_as_old_value);
    RUN_TEST(test_ack_omits_unknown_keys_and_no_all);
    RUN_TEST(test_ack_with_rejection_sets_e_and_no_error);
    RUN_TEST(test_keys_after_rejection_reported_in_d);
    RUN_TEST(test_missing_i_is_protocol_error);
    RUN_TEST(test_non_numeric_i_is_protocol_error);
    RUN_TEST(test_non_object_data_acks_and_errors);
    RUN_TEST(test_invalid_json_error_only);
    RUN_TEST(test_unknown_action_is_ignored);
    return UNITY_END();
}
