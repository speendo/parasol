#include <stdio.h>
#include <string.h>
#include "unity.h"
#include "prsl_store.h"
#include "prsl.h"

static prsl_store_t store;

static esp_err_t on_upload_spy(prsl_upload_t *u) { (void)u; return ESP_OK; }

static const char *file_label(void) { return "firmware.bin"; }

void setUp(void) {
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&store));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&store, "sys", NULL));
}

void tearDown(void) {
    prsl_store_deinit(&store);
}

void test_file_field_registration(void) {
    prsl_file_opts_t opts = {0};
    opts.on_upload = on_upload_spy;
    opts.accept = ".bin";
    opts.max_size = 1024;
    opts.idle_timeout_ms = 5000;
    opts.help = "Firmware";
    opts.attrs = "{\"title\":\"FW\"}";

    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_file_field(&store, "sys", "fw", "Firmware", &opts));
    prsl_field_t *f = prsl_store_find(&store, "sys", "fw");
    TEST_ASSERT_NOT_NULL(f);
    TEST_ASSERT_EQUAL(PRSL_FILE, f->type);
    TEST_ASSERT_EQUAL_PTR(on_upload_spy, f->on_upload);
    TEST_ASSERT_EQUAL_STRING(".bin", f->accept);
    TEST_ASSERT_EQUAL_UINT32(1024, (uint32_t)f->max_size);
    TEST_ASSERT_EQUAL_UINT32(5000, f->idle_timeout_ms);
    TEST_ASSERT_NOT_NULL(f->parsed_attrs);
}

void test_file_field_label_load(void) {
    prsl_file_opts_t opts = {0};
    opts.on_upload = on_upload_spy;
    opts.on_get = file_label;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_file_field(&store, "sys", "fw", "Firmware", &opts));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_load_values(&store));
    cJSON *v = prsl_store_get_value(&store, "sys", "fw");
    TEST_ASSERT_EQUAL_STRING("firmware.bin", cJSON_GetStringValue(v));
}

void test_file_field_label_reset(void) {
    prsl_file_opts_t opts = {0};
    opts.on_upload = on_upload_spy;
    opts.on_get = file_label;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_file_field(&store, "sys", "fw", "Firmware", &opts));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_load_values(&store));
    TEST_ASSERT_NOT_NULL(prsl_store_get_value(&store, "sys", "fw"));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_reset_values(&store));
    cJSON *rv = prsl_store_get_value(&store, "sys", "fw");
    TEST_ASSERT_EQUAL_STRING("firmware.bin", cJSON_GetStringValue(rv));
}

void test_file_field_null_opts(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      prsl_store_add_file_field(&store, "sys", "fw", "Firmware", NULL));
}

void test_file_field_null_on_upload(void) {
    prsl_file_opts_t opts = {0};
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      prsl_store_add_file_field(&store, "sys", "fw", "Firmware", &opts));
}

void test_file_field_unknown_group(void) {
    prsl_file_opts_t opts = {0};
    opts.on_upload = on_upload_spy;
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      prsl_store_add_file_field(&store, "nope", "fw", "Firmware", &opts));
}

void test_file_field_duplicate(void) {
    prsl_file_opts_t opts = {0};
    opts.on_upload = on_upload_spy;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_file_field(&store, "sys", "fw", "Firmware", &opts));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      prsl_store_add_file_field(&store, "sys", "fw", "Firmware", &opts));
}

void test_add_field_rejects_file_without_on_upload(void) {
    prsl_field_t f = {0};
    f.group_id = "sys";
    f.key = "fw";
    f.label = "Firmware";
    f.type = PRSL_FILE;
    f.help = "";
    f.attrs = "";
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_store_add_field(&store, &f));
}

void test_add_field_accepts_file_with_on_upload(void) {
    prsl_field_t f = {0};
    f.group_id = "sys";
    f.key = "fw";
    f.label = "Firmware";
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.help = "";
    f.attrs = "";
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f));
    prsl_field_t *got = prsl_store_find(&store, "sys", "fw");
    TEST_ASSERT_NOT_NULL(got);
    TEST_ASSERT_EQUAL(PRSL_FILE, got->type);
}

void test_scalar_field_defaults_unaffected(void) {
    prsl_field_t f = {0};
    f.group_id = "sys";
    f.key = "txt";
    f.label = "Text";
    f.type = PRSL_TEXT;
    f.help = "";
    f.attrs = "";
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f));
    prsl_field_t *got = prsl_store_find(&store, "sys", "txt");
    TEST_ASSERT_NOT_NULL(got);
    TEST_ASSERT_NULL(got->on_upload);
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)got->max_size);
    TEST_ASSERT_EQUAL_UINT32(0, got->idle_timeout_ms);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_file_field_registration);
    RUN_TEST(test_file_field_label_load);
    RUN_TEST(test_file_field_label_reset);
    RUN_TEST(test_file_field_null_opts);
    RUN_TEST(test_file_field_null_on_upload);
    RUN_TEST(test_file_field_unknown_group);
    RUN_TEST(test_file_field_duplicate);
    RUN_TEST(test_add_field_rejects_file_without_on_upload);
    RUN_TEST(test_add_field_accepts_file_with_on_upload);
    RUN_TEST(test_scalar_field_defaults_unaffected);
    return UNITY_END();
}
