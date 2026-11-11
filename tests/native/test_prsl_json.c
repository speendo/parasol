#include "unity.h"
#include "prsl_json.h"
#include "prsl_store.h"
#include "cJSON.h"
#include <stdlib.h>
#include <string.h>

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
    prsl_store_set_json(&store, group, key, cJSON_CreateString(val));
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
    prsl_store_set_json(&store, "wifi", "mode", cJSON_CreateString("ap"));

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
    prsl_store_set_json(&store, "wifi", "ssid", cJSON_CreateString("MyNet"));

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

static esp_err_t on_upload_spy(prsl_upload_t *u) { (void)u; return ESP_OK; }

void test_build_file_field(void) {
    prsl_store_add_group(&store, "audio", "Audio");
    prsl_field_t f = {0};
    f.group_id = "audio"; f.key = "clip"; f.label = "Clip";
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.accept = ".mp3,audio/*";
    f.max_size = 512 * 1024;
    f.idle_timeout_ms = 30000;
    f.help = "MP3";
    f.attrs = "{\"title\":\"Clip\"}";
    prsl_store_add_field(&store, &f);
    prsl_store_set_json(&store, "audio", "clip", cJSON_CreateString("beep.mp3"));

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *arr = cJSON_GetObjectItem(cJSON_GetObjectItem(out, "audio"), "clip");
    TEST_ASSERT_EQUAL_INT(3, cJSON_GetArraySize(arr));
    TEST_ASSERT_EQUAL_STRING("file", cJSON_GetStringValue(cJSON_GetArrayItem(arr, 0)));
    TEST_ASSERT_EQUAL_STRING("Clip", cJSON_GetStringValue(cJSON_GetArrayItem(arr, 1)));
    cJSON *opts = cJSON_GetArrayItem(arr, 2);
    TEST_ASSERT_TRUE(cJSON_IsObject(opts));
    TEST_ASSERT_EQUAL_STRING("beep.mp3", cJSON_GetStringValue(cJSON_GetObjectItem(opts, "value")));
    TEST_ASSERT_EQUAL_STRING(".mp3,audio/*", cJSON_GetStringValue(cJSON_GetObjectItem(opts, "accept")));
    TEST_ASSERT_EQUAL_INT(512 * 1024, cJSON_GetNumberValue(cJSON_GetObjectItem(opts, "max_size")));
    TEST_ASSERT_NULL(cJSON_GetObjectItem(opts, "idle_timeout_ms"));
    TEST_ASSERT_NOT_NULL(cJSON_GetObjectItem(opts, "help"));
    TEST_ASSERT_NOT_NULL(cJSON_GetObjectItem(opts, "attrs"));
    cJSON_Delete(out);
}

void test_build_file_field_no_optional_opts(void) {
    prsl_store_add_group(&store, "audio", "Audio");
    prsl_field_t f = {0};
    f.group_id = "audio"; f.key = "clip"; f.label = "Clip";
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    prsl_store_add_field(&store, &f);

    cJSON *out = prsl_json_build_settings(&store);
    cJSON *arr = cJSON_GetObjectItem(cJSON_GetObjectItem(out, "audio"), "clip");
    cJSON *opts = cJSON_GetArrayItem(arr, 2);
    TEST_ASSERT_NULL(cJSON_GetObjectItem(opts, "accept"));
    TEST_ASSERT_NULL(cJSON_GetObjectItem(opts, "max_size"));
    TEST_ASSERT_NULL(cJSON_GetObjectItem(opts, "idle_timeout_ms"));
    cJSON_Delete(out);
}

void test_build_settings_payload_meta(void) {
    cJSON *out = prsl_json_build_settings_payload(&store, true, true, false, true);
    cJSON *meta = cJSON_GetObjectItem(out, "_meta");
    TEST_ASSERT_TRUE(cJSON_IsObject(meta));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "dirty")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "show_reset")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "show_reboot")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "uploading")));
    /* Legacy aliases remain for 0.8.0. */
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_dirty")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_show_reset")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_show_reboot")));
    TEST_ASSERT_NULL(cJSON_GetObjectItem(out, "_uploading"));
    TEST_ASSERT_NOT_NULL(cJSON_GetObjectItem(out, "data"));
    cJSON_Delete(out);
}

void test_build_settings_payload_not_uploading(void) {
    cJSON *out = prsl_json_build_settings_payload(&store, false, false, true, false);
    cJSON *meta = cJSON_GetObjectItem(out, "_meta");
    TEST_ASSERT_TRUE(cJSON_IsObject(meta));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "dirty")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "show_reset")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "show_reboot")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "uploading")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_dirty")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_show_reset")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_show_reboot")));
    cJSON_Delete(out);
}

/* Guards against a parallel schema: _meta is the exact 4-key direct child,
 * legacy aliases sit next to it, and field data stays in the `data` object. */
void test_build_payload_meta_convention(void) {
    prsl_store_add_group(&store, "audio", "Audio");
    prsl_field_t f = {0};
    f.group_id = "audio"; f.key = "clip"; f.label = "Clip";
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    prsl_store_add_field(&store, &f);
    prsl_store_set_json(&store, "audio", "clip", cJSON_CreateString("beep.mp3"));

    cJSON *out = prsl_json_build_settings_payload(&store, true, true, false, true);

    /* Root: type, _meta, _dirty, _show_reset, _show_reboot, data only. */
    TEST_ASSERT_EQUAL_INT(6, cJSON_GetArraySize(out));
    TEST_ASSERT_NULL(cJSON_GetObjectItem(out, "_uploading"));

    cJSON *meta = cJSON_GetObjectItem(out, "_meta");
    TEST_ASSERT_TRUE(cJSON_IsObject(meta));
    TEST_ASSERT_EQUAL_INT(4, cJSON_GetArraySize(meta));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "dirty")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "show_reset")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "show_reboot")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(meta, "uploading")));
    for (cJSON *c = meta->child; c; c = c->next) {
        TEST_ASSERT_TRUE(strcmp(c->string, "dirty") == 0 ||
                         strcmp(c->string, "show_reset") == 0 ||
                         strcmp(c->string, "show_reboot") == 0 ||
                         strcmp(c->string, "uploading") == 0);
    }

    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_dirty")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_show_reset")));
    TEST_ASSERT_FALSE(cJSON_IsTrue(cJSON_GetObjectItem(out, "_show_reboot")));

    cJSON *data = cJSON_GetObjectItem(out, "data");
    TEST_ASSERT_TRUE(cJSON_IsObject(data));
    cJSON *clip = cJSON_GetObjectItem(cJSON_GetObjectItem(data, "audio"), "clip");
    TEST_ASSERT_TRUE(cJSON_IsArray(clip));
    TEST_ASSERT_EQUAL_INT(3, cJSON_GetArraySize(clip));
    TEST_ASSERT_TRUE(cJSON_IsString(cJSON_GetArrayItem(clip, 0)));
    TEST_ASSERT_TRUE(cJSON_IsString(cJSON_GetArrayItem(clip, 1)));
    TEST_ASSERT_TRUE(cJSON_IsObject(cJSON_GetArrayItem(clip, 2)));

    cJSON_Delete(out);
}

/* The upload flag is process-global, not per-store state. */
void test_build_payload_uploading_is_global(void) {
    prsl_store_t a, b;
    prsl_store_init(&a); prsl_store_init(&b);
    cJSON *pa = prsl_json_build_settings_payload(&a, false, true, true, true);
    cJSON *pb = prsl_json_build_settings_payload(&b, false, true, true, true);
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(pa, "_meta"), "uploading")));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(pb, "_meta"), "uploading")));
    cJSON_Delete(pa); cJSON_Delete(pb);
    prsl_store_deinit(&a); prsl_store_deinit(&b);
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
    prsl_store_set_json(&store, "groupA", "f1", cJSON_CreateString("valA1"));

    prsl_field_t f2 = {0};
    f2.group_id = "groupB";
    f2.key = "f1";
    f2.label = "Field1";
    f2.type = PRSL_NUMBER;
    f2.is_status = false;
    prsl_store_add_field(&store, &f2);
    prsl_store_set_json(&store, "groupB", "f1", cJSON_CreateNumber(42));

    prsl_field_t f3 = {0};
    f3.group_id = "groupA";
    f3.key = "f2";
    f3.label = "Field2";
    f3.type = PRSL_SWITCH;
    f3.is_status = false;
    prsl_store_add_field(&store, &f3);
    prsl_store_set_json(&store, "groupA", "f2", cJSON_CreateBool(true));

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
    RUN_TEST(test_build_file_field);
    RUN_TEST(test_build_file_field_no_optional_opts);
    RUN_TEST(test_build_settings_payload_meta);
    RUN_TEST(test_build_settings_payload_not_uploading);
    RUN_TEST(test_build_payload_meta_convention);
    RUN_TEST(test_build_payload_uploading_is_global);
    return UNITY_END();
}
