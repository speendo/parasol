#include "unity.h"
#include "prsl_json.h"
#include "prsl_store.h"
#include "cJSON.h"
#include <stdlib.h>

static prsl_store_t store;

static void add_field(const char *group, const char *key, prsl_type_t type,
                       bool is_status, const char *val) {
    prsl_field_t f = {0};
    f.group_id = group;
    f.key = key;
    f.label = key;
    f.type = type;
    f.is_status = is_status;
    prsl_store_add_group(&store, group, NULL);
    prsl_store_add_field(&store, &f);
    prsl_store_set_value(&store, group, key, val);
}

void setUp(void) {
    prsl_store_init(&store);
}

void tearDown(void) {
    prsl_store_deinit(&store);
}

void test_build_settings_output(void) {
    add_field("wifi", "ssid", PRSL_TEXT, false, "MyNetwork");
    cJSON *out = prsl_json_build_settings(&store);
    TEST_ASSERT_NOT_NULL(out);

    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    TEST_ASSERT_NOT_NULL(wifi);
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    TEST_ASSERT_TRUE(cJSON_IsArray(ssid));
    TEST_ASSERT_EQUAL_STRING("text", cJSON_GetStringValue(cJSON_GetArrayItem(ssid, 0)));
    TEST_ASSERT_EQUAL_STRING("ssid", cJSON_GetStringValue(cJSON_GetArrayItem(ssid, 1)));

    cJSON_Delete(out);
}

void test_build_status_no_dirty(void) {
    add_field("system", "uptime", PRSL_TEXT, true, "3h");
    cJSON *out = prsl_json_build_status(&store);
    cJSON *sys = cJSON_GetObjectItem(out, "system");
    TEST_ASSERT_NOT_NULL(sys);
    cJSON_Delete(out);
}

void test_build_with_options(void) {
    static const char *opts_arr[][2] = {
        {"ap", "Access Point"},
        {"sta", "Station"},
    };
    prsl_field_t f = {0};
    f.group_id = "wifi";
    f.key = "mode";
    f.label = "Mode";
    f.type = PRSL_RADIO;
    f.is_status = false;
    f.options = opts_arr;
    f.option_count = 2;
    prsl_store_add_group(&store, "wifi", NULL);
    prsl_store_add_field(&store, &f);
    prsl_store_set_value(&store, "wifi", "mode", "ap");

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *mode = cJSON_GetObjectItem(wifi, "mode");
    cJSON *opts = cJSON_GetArrayItem(mode, 2);
    cJSON *options = cJSON_GetObjectItem(opts, "options");
    TEST_ASSERT_TRUE(cJSON_IsArray(options));
    TEST_ASSERT_EQUAL(2, cJSON_GetArraySize(options));
    cJSON_Delete(out);
}

void test_build_with_attrs(void) {
    prsl_field_t f = {0};
    f.group_id = "wifi";
    f.key = "ssid";
    f.label = "SSID";
    f.type = PRSL_TEXT;
    f.is_status = false;
    f.attrs = "{'required':true,'maxlength':32}";
    prsl_store_add_group(&store, "wifi", NULL);
    prsl_store_add_field(&store, &f);

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    cJSON *opts = cJSON_GetArrayItem(ssid, 2);
    cJSON *attrs = cJSON_GetObjectItem(opts, "attrs");
    TEST_ASSERT_NOT_NULL(attrs);
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(attrs, "required")));
    cJSON_Delete(out);
}

void test_attrs_quote_fixer(void) {
    char *fixed = prsl_json_fix_attrs_quotes("{'key':'value','num':42}");
    TEST_ASSERT_EQUAL_STRING("{\"key\":\"value\",\"num\":42}", fixed);
    free(fixed);
}

void test_attrs_quote_fixer_empty(void) {
    char *fixed = prsl_json_fix_attrs_quotes("");
    TEST_ASSERT_EQUAL_STRING("{}", fixed);
    free(fixed);
}



void test_build_empty_store(void) {
    cJSON *out = prsl_json_build_settings(&store);
    TEST_ASSERT_NOT_NULL(out);
    TEST_ASSERT_EQUAL(0, cJSON_GetArraySize(out));
    cJSON_Delete(out);
}

void test_build_with_help(void) {
    prsl_field_t f = {0};
    f.group_id = "wifi";
    f.key = "ssid";
    f.label = "SSID";
    f.type = PRSL_TEXT;
    f.is_status = false;
    f.help = "The network name";
    prsl_store_add_group(&store, "wifi", NULL);
    prsl_store_add_field(&store, &f);
    prsl_store_set_value(&store, "wifi", "ssid", "MyNet");

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    cJSON *opts = cJSON_GetArrayItem(ssid, 2);
    cJSON *help = cJSON_GetObjectItem(opts, "help");
    TEST_ASSERT_NOT_NULL(help);
    TEST_ASSERT_EQUAL_STRING("The network name", cJSON_GetStringValue(help));
    cJSON_Delete(out);
}

void test_build_group_label(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    add_field("wifi", "ssid", PRSL_TEXT, false, "MyNet");

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    TEST_ASSERT_NOT_NULL(wifi);
    cJSON *label = cJSON_GetObjectItem(wifi, "label");
    TEST_ASSERT_NOT_NULL(label);
    TEST_ASSERT_EQUAL_STRING("WiFi Settings", cJSON_GetStringValue(label));
    cJSON_Delete(out);
}

void test_build_group_no_label(void) {
    add_field("wifi", "ssid", PRSL_TEXT, false, "MyNet");

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    TEST_ASSERT_NOT_NULL(wifi);
    cJSON *label = cJSON_GetObjectItem(wifi, "label");
    TEST_ASSERT_NULL(label);
    cJSON_Delete(out);
}

void test_attrs_fixer_null_input(void) {
    char *fixed = prsl_json_fix_attrs_quotes(NULL);
    TEST_ASSERT_EQUAL_STRING("{}", fixed);
    free(fixed);
}

void test_build_interleaved_fields(void) {
    prsl_store_add_group(&store, "groupA", "Group A");
    prsl_store_add_group(&store, "groupB", "Group B");

    prsl_field_t f1 = {0};
    f1.group_id = "groupA";
    f1.key = "f1";
    f1.label = "Field1";
    f1.type = PRSL_TEXT;
    f1.is_status = false;
    prsl_store_add_field(&store, &f1);
    prsl_store_set_value(&store, "groupA", "f1", "valA1");

    prsl_field_t f2 = {0};
    f2.group_id = "groupB";
    f2.key = "f1";
    f2.label = "Field1";
    f2.type = PRSL_NUMBER;
    f2.is_status = false;
    prsl_store_add_field(&store, &f2);
    prsl_store_set_value(&store, "groupB", "f1", "42");

    prsl_field_t f3 = {0};
    f3.group_id = "groupA";
    f3.key = "f2";
    f3.label = "Field2";
    f3.type = PRSL_SWITCH;
    f3.is_status = false;
    prsl_store_add_field(&store, &f3);
    prsl_store_set_value(&store, "groupA", "f2", "true");

    cJSON *out = prsl_json_build_settings(&store);
    TEST_ASSERT_NOT_NULL(out);

    cJSON *groupA = cJSON_GetObjectItem(out, "groupA");
    TEST_ASSERT_NOT_NULL(groupA);
    cJSON *a_f1 = cJSON_GetObjectItem(groupA, "f1");
    TEST_ASSERT_NOT_NULL(a_f1);
    cJSON *a_f2 = cJSON_GetObjectItem(groupA, "f2");
    TEST_ASSERT_NOT_NULL(a_f2);

    cJSON *groupB = cJSON_GetObjectItem(out, "groupB");
    TEST_ASSERT_NOT_NULL(groupB);
    cJSON *b_f1 = cJSON_GetObjectItem(groupB, "f1");
    TEST_ASSERT_NOT_NULL(b_f1);

    cJSON_Delete(out);
}

void test_value_str_string(void) {
    cJSON *s = cJSON_CreateString("hello");
    char buf[64];
    TEST_ASSERT_EQUAL_STRING("hello", prsl_json_value_str(s, buf, sizeof(buf)));
    cJSON_Delete(s);
}

void test_value_str_number(void) {
    cJSON *n = cJSON_CreateNumber(42.5);
    char buf[64];
    TEST_ASSERT_EQUAL_STRING("42.5", prsl_json_value_str(n, buf, sizeof(buf)));
    cJSON_Delete(n);
}

void test_value_str_true(void) {
    cJSON *t = cJSON_CreateTrue();
    char buf[64];
    TEST_ASSERT_EQUAL_STRING("true", prsl_json_value_str(t, buf, sizeof(buf)));
    cJSON_Delete(t);
}

void test_value_str_false(void) {
    cJSON *f = cJSON_CreateFalse();
    char buf[64];
    TEST_ASSERT_EQUAL_STRING("false", prsl_json_value_str(f, buf, sizeof(buf)));
    cJSON_Delete(f);
}

void test_value_str_null(void) {
    char buf[64];
    TEST_ASSERT_NULL(prsl_json_value_str(NULL, buf, sizeof(buf)));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_build_settings_output);
    RUN_TEST(test_build_status_no_dirty);
    RUN_TEST(test_build_with_options);
    RUN_TEST(test_build_with_attrs);
    RUN_TEST(test_attrs_quote_fixer);
    RUN_TEST(test_attrs_quote_fixer_empty);
    RUN_TEST(test_build_empty_store);
    RUN_TEST(test_build_with_help);
    RUN_TEST(test_build_group_label);
    RUN_TEST(test_build_group_no_label);
    RUN_TEST(test_attrs_fixer_null_input);
    RUN_TEST(test_build_interleaved_fields);
    RUN_TEST(test_value_str_string);
    RUN_TEST(test_value_str_number);
    RUN_TEST(test_value_str_true);
    RUN_TEST(test_value_str_false);
    RUN_TEST(test_value_str_null);
    return UNITY_END();
}
