#include "unity.h"
#include "pwui_json.h"
#include "pwui_store.h"
#include "cJSON.h"

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
    return UNITY_END();
}
