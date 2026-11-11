#include <stdio.h>
#include <string.h>
#include "unity.h"
#include "prsl_store.h"
#include "prsl_upload.h"
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
    cJSON *loaded = prsl_store_get_value(&store, "sys", "fw");
    TEST_ASSERT_EQUAL_STRING("firmware.bin", cJSON_GetStringValue(loaded));
    prsl_store_set_json(&store, "sys", "fw", cJSON_CreateString("changed"));
    cJSON *changed = prsl_store_get_value(&store, "sys", "fw");
    TEST_ASSERT_EQUAL_STRING("changed", cJSON_GetStringValue(changed));
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

static void test_validate_name_rules(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(400, status);
    TEST_ASSERT_EQUAL_STRING("Invalid name", err);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, NULL, NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(400, status);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "../x.bin", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "a\\b.bin", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "a\nb.bin", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, ".", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "..", NULL, 1, err, sizeof(err), &status));

    char long_name[PRSL_UPLOAD_NAME_MAX + 1];
    memset(long_name, 'a', sizeof(long_name) - 1);
    long_name[sizeof(long_name) - 1] = '\0';
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, long_name, NULL, 1, err, sizeof(err), &status));

    char max_name[PRSL_UPLOAD_NAME_MAX];
    memset(max_name, 'a', sizeof(max_name) - 1);
    max_name[sizeof(max_name) - 1] = '\0';
    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, max_name, "application/octet-stream",
                             1024, err, sizeof(err), &status));

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "firmware.bin", "application/octet-stream",
                             1024, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);
    TEST_ASSERT_EQUAL_STRING("", err);
}

static void test_validate_empty_file(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "a.bin", NULL, 0, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(400, status);
    TEST_ASSERT_EQUAL_STRING("Empty file", err);
}

static void test_validate_size_limit(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.max_size = 8;
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "a.bin", NULL, 9, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(413, status);
    TEST_ASSERT_EQUAL_STRING("File too large", err);

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "a.bin", NULL, 8, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);
    TEST_ASSERT_EQUAL_STRING("", err);
}

static void test_validate_no_size_limit(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "a.bin", NULL, (size_t)-1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);
}

static void test_validate_accept_extension(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.accept = ".bin";
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "firmware.BIN", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "firmware.txt", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(415, status);
    TEST_ASSERT_EQUAL_STRING("File type not allowed", err);
}

static void test_validate_accept_mixed(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.accept = ".mp3, audio/*";
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "clip.mp3", "video/mp4", 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "clip.dat", "audio/mpeg", 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "clip.dat", "video/mp4", 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(415, status);
}

static void test_validate_accept_mime_without_mime(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.accept = "audio/*";
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "clip.mp3", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(415, status);
    TEST_ASSERT_EQUAL_STRING("File type not allowed", err);
}

static void test_validate_accept_null(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "anything.dat", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);
}

static void test_validate_accept_all(void) {
    prsl_field_t f = {0};
    f.type = PRSL_FILE;
    f.on_upload = on_upload_spy;
    f.accept = "*/*";
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_validate(&f, "anything.dat", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(0, status);
}

static void test_validate_field_guard(void) {
    prsl_field_t f = {0};
    char err[PRSL_UPLOAD_ERR_MAX];
    int status = 0;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(NULL, "a.bin", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(400, status);

    f.type = PRSL_TEXT;
    f.on_upload = on_upload_spy;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "a.bin", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(400, status);

    f.type = PRSL_FILE;
    f.on_upload = NULL;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
        prsl_upload_validate(&f, "a.bin", NULL, 1, err, sizeof(err), &status));
    TEST_ASSERT_EQUAL_INT(400, status);
}

static void test_accept_match_direct(void) {
    TEST_ASSERT_TRUE(prsl_upload_accept_match(NULL, "a.bin", NULL));
    TEST_ASSERT_TRUE(prsl_upload_accept_match("", "a.bin", NULL));
    TEST_ASSERT_TRUE(prsl_upload_accept_match(".bin", "a.BIN", NULL));
    TEST_ASSERT_FALSE(prsl_upload_accept_match(".binary", "a.bin", NULL));
    TEST_ASSERT_FALSE(prsl_upload_accept_match(".bin", NULL, NULL));
    TEST_ASSERT_TRUE(prsl_upload_accept_match("application/octet-stream", "a.bin",
                                             "Application/Octet-Stream"));
    TEST_ASSERT_FALSE(prsl_upload_accept_match("application/octet-stream", "a.bin", NULL));
    TEST_ASSERT_TRUE(prsl_upload_accept_match(" image/* , .bin ", "a.bin", NULL));
    TEST_ASSERT_FALSE(prsl_upload_accept_match("image/*", "a.bin", "text/plain"));
    TEST_ASSERT_TRUE(prsl_upload_accept_match("*/*", "a.bin", NULL));
}

static void test_upload_is_active(void) {
    prsl_upload_state_t st = {0};

    TEST_ASSERT_FALSE(prsl_upload_is_active(NULL));
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));

    st.active = true;
    TEST_ASSERT_TRUE(prsl_upload_is_active(&st));

    st.finished = true;
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));

    st.finished = false;
    st.active = false;
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
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
    RUN_TEST(test_validate_name_rules);
    RUN_TEST(test_validate_empty_file);
    RUN_TEST(test_validate_size_limit);
    RUN_TEST(test_validate_no_size_limit);
    RUN_TEST(test_validate_accept_extension);
    RUN_TEST(test_validate_accept_mixed);
    RUN_TEST(test_validate_accept_mime_without_mime);
    RUN_TEST(test_validate_accept_null);
    RUN_TEST(test_validate_accept_all);
    RUN_TEST(test_validate_field_guard);
    RUN_TEST(test_accept_match_direct);
    RUN_TEST(test_upload_is_active);
    return UNITY_END();
}
