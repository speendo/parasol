#include "unity.h"
#include "pwui_json.h"
#include "pwui_store.h"
#include "cJSON.h"
#include <stdlib.h>

static pwui_store_t store;

static void add_field(const char *comp, const char *key, pwui_type_t type,
                       bool is_status, const char *val) {
    pwui_field_t f = {0};
    f.comp_id = comp;
    f.key = key;
    f.label = key;
    f.type = type;
    f.is_status = is_status;
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, comp, key, val);
}

void setUp(void) {
    pwui_store_init(&store);
}

void tearDown(void) {
    pwui_store_deinit(&store);
}

void test_build_settings_output(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "MyNetwork");
    cJSON *out = pwui_json_build_settings(&store);
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
    add_field("system", "uptime", PWUI_TEXT, true, "3h");
    cJSON *out = pwui_json_build_status(&store);
    cJSON *sys = cJSON_GetObjectItem(out, "system");
    TEST_ASSERT_NOT_NULL(sys);
    cJSON_Delete(out);
}

void test_build_with_options(void) {
    static const char *opts_arr[][2] = {
        {"ap", "Access Point"},
        {"sta", "Station"},
    };
    pwui_field_t f = {0};
    f.comp_id = "wifi";
    f.key = "mode";
    f.label = "Mode";
    f.type = PWUI_RADIO;
    f.is_status = false;
    f.options = opts_arr;
    f.option_count = 2;
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "wifi", "mode", "ap");

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *mode = cJSON_GetObjectItem(wifi, "mode");
    cJSON *opts = cJSON_GetArrayItem(mode, 2);
    cJSON *options = cJSON_GetObjectItem(opts, "options");
    TEST_ASSERT_TRUE(cJSON_IsArray(options));
    TEST_ASSERT_EQUAL(2, cJSON_GetArraySize(options));
    cJSON_Delete(out);
}

void test_build_with_attrs(void) {
    pwui_field_t f = {0};
    f.comp_id = "wifi";
    f.key = "ssid";
    f.label = "SSID";
    f.type = PWUI_TEXT;
    f.is_status = false;
    f.attrs = "{'required':true,'maxlength':32}";
    pwui_store_add_field(&store, &f);

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    cJSON *opts = cJSON_GetArrayItem(ssid, 2);
    cJSON *attrs = cJSON_GetObjectItem(opts, "attrs");
    TEST_ASSERT_NOT_NULL(attrs);
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(attrs, "required")));
    cJSON_Delete(out);
}

void test_attrs_quote_fixer(void) {
    char *fixed = pwui_json_fix_attrs_quotes("{'key':'value','num':42}");
    TEST_ASSERT_EQUAL_STRING("{\"key\":\"value\",\"num\":42}", fixed);
    free(fixed);
}

void test_attrs_quote_fixer_empty(void) {
    char *fixed = pwui_json_fix_attrs_quotes("");
    TEST_ASSERT_EQUAL_STRING("{}", fixed);
    free(fixed);
}

void test_parse_apply_single_field(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    const char *msg = "{\"action\":\"apply\",\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"NewNet\"}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL_STRING("wifi", comps[0]);
    TEST_ASSERT_EQUAL_STRING("ssid", keys[0]);
    TEST_ASSERT_EQUAL_STRING("NewNet", values[0]);
}

void test_parse_apply_unknown_field_skipped(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    const char *msg = "{\"action\":\"apply\",\"data\":{\"wifi\":{\"nope\":[\"text\",\"X\",{\"value\":\"y\"}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(0, n);
}

void test_parse_apply_malformed(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, "not json", comps, keys, values, 8);
    TEST_ASSERT_EQUAL(0, n);
}

void test_build_empty_store(void) {
    cJSON *out = pwui_json_build_settings(&store);
    TEST_ASSERT_NOT_NULL(out);
    TEST_ASSERT_EQUAL(0, cJSON_GetArraySize(out));
    cJSON_Delete(out);
}

void test_build_with_help(void) {
    pwui_field_t f = {0};
    f.comp_id = "wifi";
    f.key = "ssid";
    f.label = "SSID";
    f.type = PWUI_TEXT;
    f.is_status = false;
    f.help = "The network name";
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "wifi", "ssid", "MyNet");

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    cJSON *ssid = cJSON_GetObjectItem(wifi, "ssid");
    cJSON *opts = cJSON_GetArrayItem(ssid, 2);
    cJSON *help = cJSON_GetObjectItem(opts, "help");
    TEST_ASSERT_NOT_NULL(help);
    TEST_ASSERT_EQUAL_STRING("The network name", cJSON_GetStringValue(help));
    cJSON_Delete(out);
}

void test_build_group_label(void) {
    pwui_store_add_component(&store, "wifi", "WiFi Settings");
    add_field("wifi", "ssid", PWUI_TEXT, false, "MyNet");

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    TEST_ASSERT_NOT_NULL(wifi);
    cJSON *label = cJSON_GetObjectItem(wifi, "label");
    TEST_ASSERT_NOT_NULL(label);
    TEST_ASSERT_EQUAL_STRING("WiFi Settings", cJSON_GetStringValue(label));
    cJSON_Delete(out);
}

void test_build_group_no_label(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "MyNet");

    cJSON *out = pwui_json_build_settings(&store);
    cJSON *wifi = cJSON_GetObjectItem(out, "wifi");
    TEST_ASSERT_NOT_NULL(wifi);
    cJSON *label = cJSON_GetObjectItem(wifi, "label");
    TEST_ASSERT_NULL(label);
    cJSON_Delete(out);
}

void test_parse_apply_empty_data(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    const char *msg = "{\"action\":\"apply\",\"data\":{}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(0, n);
}

void test_parse_apply_max_changes(void) {
    add_field("comp", "k1", PWUI_TEXT, false, "");
    add_field("comp", "k2", PWUI_TEXT, false, "");
    add_field("comp", "k3", PWUI_TEXT, false, "");
    add_field("comp", "k4", PWUI_TEXT, false, "");
    add_field("comp", "k5", PWUI_TEXT, false, "");
    const char *msg = "{\"action\":\"apply\",\"data\":{\"comp\":{"
        "\"k1\":[\"text\",\"k1\",{\"value\":\"v1\"}],"
        "\"k2\":[\"text\",\"k2\",{\"value\":\"v2\"}],"
        "\"k3\":[\"text\",\"k3\",{\"value\":\"v3\"}],"
        "\"k4\":[\"text\",\"k4\",{\"value\":\"v4\"}],"
        "\"k5\":[\"text\",\"k5\",{\"value\":\"v5\"}]"
    "}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 3);
    TEST_ASSERT_EQUAL(3, n);
}

void test_parse_apply_skips_prefix(void) {
    add_field("wifi", "ssid", PWUI_TEXT, false, "old");
    const char *msg = "{\"action\":\"apply\",\"data\":{\"_meta\":{\"dummy\":[\"text\",\"D\",{\"value\":\"x\"}]},\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":\"NewNet\"}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL_STRING("wifi", comps[0]);
    TEST_ASSERT_EQUAL_STRING("ssid", keys[0]);
    TEST_ASSERT_EQUAL_STRING("NewNet", values[0]);
}

void test_parse_apply_null_value(void) {
    pwui_field_t f = {0};
    f.comp_id = "wifi";
    f.key = "ssid";
    f.label = "SSID";
    f.type = PWUI_TEXT;
    f.is_status = false;
    pwui_store_add_field(&store, &f);
    const char *msg = "{\"action\":\"apply\",\"data\":{\"wifi\":{\"ssid\":[\"text\",\"SSID\",{\"value\":null}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL_STRING("", values[0]);
}

void test_parse_apply_number_value(void) {
    pwui_field_t f = {0};
    f.comp_id = "sensor";
    f.key = "threshold";
    f.label = "Threshold";
    f.type = PWUI_NUMBER;
    f.is_status = false;
    pwui_store_add_field(&store, &f);
    const char *msg = "{\"action\":\"apply\",\"data\":{\"sensor\":{\"threshold\":[\"number\",\"Threshold\",{\"value\":42}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(1, n);
    TEST_ASSERT_EQUAL_STRING("42", values[0]);
}

void test_parse_apply_bool_values(void) {
    pwui_field_t f1 = {0};
    f1.comp_id = "wifi";
    f1.key = "enabled";
    f1.label = "Enabled";
    f1.type = PWUI_CHECKBOX;
    f1.is_status = false;
    pwui_store_add_field(&store, &f1);

    pwui_field_t f2 = {0};
    f2.comp_id = "wifi";
    f2.key = "hidden";
    f2.label = "Hidden";
    f2.type = PWUI_CHECKBOX;
    f2.is_status = false;
    pwui_store_add_field(&store, &f2);

    const char *msg = "{\"action\":\"apply\",\"data\":{\"wifi\":{\"enabled\":[\"checkbox\",\"Enabled\",{\"value\":true}],\"hidden\":[\"checkbox\",\"Hidden\",{\"value\":false}]}}}";

    char comps[8][32], keys[8][32], values[8][256];
    int n = pwui_json_parse_apply(&store, msg, comps, keys, values, 8);
    TEST_ASSERT_EQUAL(2, n);
    TEST_ASSERT_EQUAL_STRING("true", values[0]);
    TEST_ASSERT_EQUAL_STRING("false", values[1]);
}

void test_attrs_fixer_null_input(void) {
    char *fixed = pwui_json_fix_attrs_quotes(NULL);
    TEST_ASSERT_EQUAL_STRING("{}", fixed);
    free(fixed);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_build_settings_output);
    RUN_TEST(test_build_status_no_dirty);
    RUN_TEST(test_build_with_options);
    RUN_TEST(test_build_with_attrs);
    RUN_TEST(test_attrs_quote_fixer);
    RUN_TEST(test_attrs_quote_fixer_empty);
    RUN_TEST(test_parse_apply_single_field);
    RUN_TEST(test_parse_apply_unknown_field_skipped);
    RUN_TEST(test_parse_apply_malformed);
    RUN_TEST(test_build_empty_store);
    RUN_TEST(test_build_with_help);
    RUN_TEST(test_build_group_label);
    RUN_TEST(test_build_group_no_label);
    RUN_TEST(test_parse_apply_empty_data);
    RUN_TEST(test_parse_apply_max_changes);
    RUN_TEST(test_parse_apply_skips_prefix);
    RUN_TEST(test_parse_apply_null_value);
    RUN_TEST(test_parse_apply_number_value);
    RUN_TEST(test_parse_apply_bool_values);
    RUN_TEST(test_attrs_fixer_null_input);
    return UNITY_END();
}
