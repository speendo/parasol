#include "unity.h"
#include "prsl_store.h"
#include "prsl_body.h"
#include "prsl_json.h"
#include "cJSON.h"
#include <string.h>

static prsl_store_t store;
static int set_calls = 0;

static esp_err_t on_set_spy(const char *g, const char *k, const prsl_val_t *v) {
    (void)g; (void)k; (void)v;
    set_calls++;
    return ESP_OK;
}
static esp_err_t on_set_reject(const char *g, const char *k, const prsl_val_t *v) {
    (void)g; (void)k; (void)v;
    return ESP_ERR_INVALID_ARG;
}

static prsl_val_kind_t last_kind;
static double last_num;
static bool   last_bool;
static const char *last_str;
static esp_err_t on_set_capture(const char *g, const char *k, const prsl_val_t *v) {
    (void)g; (void)k;
    last_kind = v->kind;
    last_num = 0; last_bool = false; last_str = NULL;
    if (v->kind == PRSL_VAL_STRING) last_str = v->u.str;
    else if (v->kind == PRSL_VAL_NUMBER) last_num = v->u.num;
    else if (v->kind == PRSL_VAL_BOOL) last_bool = v->u.b;
    return ESP_OK;
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

/* body with one field whose opts.value has a JSON number / bool / null */
static cJSON *make_typed_body(const char *group, const char *key,
                              int kind_of_value /* 0=num 1=true 2=false 3=null */, double num) {
    cJSON *body = cJSON_CreateObject();
    cJSON *grp = cJSON_CreateObject();
    cJSON *arr = cJSON_CreateArray();
    cJSON_AddItemToArray(arr, cJSON_CreateString("text"));
    cJSON_AddItemToArray(arr, cJSON_CreateString(key));
    cJSON *opts = cJSON_CreateObject();
    if (kind_of_value == 0) cJSON_AddNumberToObject(opts, "value", num);
    else if (kind_of_value == 1) cJSON_AddTrueToObject(opts, "value");
    else if (kind_of_value == 2) cJSON_AddFalseToObject(opts, "value");
    else cJSON_AddNullToObject(opts, "value");
    cJSON_AddItemToArray(arr, opts);
    cJSON_AddItemToObject(grp, key, arr);
    cJSON_AddItemToObject(body, group, grp);
    return body;
}

static void add_field_typed(const char *g, const char *k, prsl_type_t t, prsl_set_cb_t cb) {
    prsl_field_t f = {0};
    f.group_id = g; f.key = k; f.label = k; f.type = t;
    f.help = ""; f.attrs = ""; f.on_set = cb;
    prsl_store_add_field(&store, &f);
}

void test_apply_preserves_number_type(void) {
    add_field_typed("wifi", "gain", PRSL_NUMBER, NULL);
    cJSON *body = make_typed_body("wifi", "gain", 0, 42.5);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_NULL(rej.group_id);
    cJSON *v = prsl_store_get_value(&store, "wifi", "gain");
    TEST_ASSERT_TRUE(cJSON_IsNumber(v));
    TEST_ASSERT_EQUAL_DOUBLE(42.5, cJSON_GetNumberValue(v));
    cJSON_Delete(body);
}

void test_apply_preserves_bool_type(void) {
    add_field_typed("wifi", "flag", PRSL_SWITCH, NULL);
    cJSON *body = make_typed_body("wifi", "flag", 1, 0);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    cJSON *v = prsl_store_get_value(&store, "wifi", "flag");
    TEST_ASSERT_TRUE(cJSON_IsBool(v) && cJSON_IsTrue(v));
    cJSON_Delete(body);
}

void test_apply_preserves_false_type(void) {
    add_field_typed("wifi", "flag", PRSL_SWITCH, NULL);
    cJSON *body = make_typed_body("wifi", "flag", 2, 0);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    cJSON *v = prsl_store_get_value(&store, "wifi", "flag");
    TEST_ASSERT_TRUE(cJSON_IsBool(v) && cJSON_IsFalse(v));
    cJSON_Delete(body);
}

void test_apply_preserves_null_type(void) {
    add_field_typed("wifi", "mode", PRSL_TEXT, NULL);
    cJSON *body = make_typed_body("wifi", "mode", 3, 0);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    cJSON *v = prsl_store_get_value(&store, "wifi", "mode");
    TEST_ASSERT_TRUE(cJSON_IsNull(v));
    cJSON_Delete(body);
}

void test_on_set_receives_string_kind(void) {
    add_field_typed("wifi", "ssid", PRSL_TEXT, on_set_capture);
    cJSON *body = make_typed_body("wifi", "ssid", 0, 0); /* number! wrong kind path is separate */
    /* rebuild with a string value for this test */
    cJSON_Delete(body);
    body = cJSON_CreateObject();
    cJSON *wifi = cJSON_CreateObject();
    cJSON *arr = cJSON_CreateArray();
    cJSON_AddItemToArray(arr, cJSON_CreateString("text"));
    cJSON_AddItemToArray(arr, cJSON_CreateString("SSID"));
    cJSON *opts = cJSON_CreateObject();
    cJSON_AddStringToObject(opts, "value", "MyNet");
    cJSON_AddItemToArray(arr, opts);
    cJSON_AddItemToObject(wifi, "ssid", arr);
    cJSON_AddItemToObject(body, "wifi", wifi);

    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL(PRSL_VAL_STRING, last_kind);
    TEST_ASSERT_EQUAL_STRING("MyNet", last_str);
    cJSON_Delete(body);
}

void test_on_set_receives_number_kind(void) {
    add_field_typed("wifi", "gain", PRSL_NUMBER, on_set_capture);
    cJSON *body = make_typed_body("wifi", "gain", 0, 7.25);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL(PRSL_VAL_NUMBER, last_kind);
    TEST_ASSERT_EQUAL_DOUBLE(7.25, last_num);
    cJSON_Delete(body);
}

void test_on_set_receives_bool_kind(void) {
    add_field_typed("wifi", "flag", PRSL_SWITCH, on_set_capture);
    cJSON *body = make_typed_body("wifi", "flag", 1, 0);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL(PRSL_VAL_BOOL, last_kind);
    TEST_ASSERT_TRUE(last_bool);
    cJSON_Delete(body);
}

void test_on_set_receives_null_kind(void) {
    add_field_typed("wifi", "mode", PRSL_TEXT, on_set_capture);
    cJSON *body = make_typed_body("wifi", "mode", 3, 0);
    prsl_rejection_t rej;
    int n = prsl_apply_body(body, &store, &rej);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL(PRSL_VAL_NULL, last_kind);
    cJSON_Delete(body);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_apply_no_on_set_writes_store);
    RUN_TEST(test_apply_with_on_set_does_not_write_store);
    RUN_TEST(test_apply_underscore_group_skipped);
    RUN_TEST(test_apply_rejection_populated);
    RUN_TEST(test_apply_short_array_skipped);
    RUN_TEST(test_apply_preserves_number_type);
    RUN_TEST(test_apply_preserves_bool_type);
    RUN_TEST(test_apply_preserves_false_type);
    RUN_TEST(test_apply_preserves_null_type);
    RUN_TEST(test_on_set_receives_string_kind);
    RUN_TEST(test_on_set_receives_number_kind);
    RUN_TEST(test_on_set_receives_bool_kind);
    RUN_TEST(test_on_set_receives_null_kind);
    return UNITY_END();
}
