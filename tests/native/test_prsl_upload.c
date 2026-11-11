#include <stdio.h>
#include <string.h>
#include "unity.h"
#include "prsl_store.h"
#include "prsl_upload.h"
#include "prsl.h"

static prsl_store_t store;

static esp_err_t on_upload_spy(prsl_upload_t *u) { (void)u; return ESP_OK; }

/* ── upload lifecycle spy ─────────────────────────────────── */

/* Host stub lacks ESP_FAIL; use an existing distinct error code. */
#define REJECT_ERR ESP_ERR_NOT_FOUND

static int events[8];
static int event_count;
static int reject_event = -1;
static int reject_status;
static int reject_write_err = 1;
static int last_status;
static char last_err[64];
static const char *last_name;
static const char *last_mime;
static const uint8_t *last_data;
static size_t last_len;
static size_t last_offset;
static size_t last_size;
static const char *last_group;
static const char *last_key;
static prsl_upload_state_t st;

static esp_err_t on_upload_record(prsl_upload_t *u) {
    events[event_count++] = u->event;
    last_status = u->status;
    if (u->err && u->err_len) snprintf(last_err, sizeof(last_err), "%s", u->err);
    last_name = u->name;
    last_mime = u->mime;
    last_data = u->data;
    last_len = u->len;
    last_offset = u->offset;
    last_size = u->size;
    last_group = u->group_id;
    last_key = u->key;
    if (u->event == reject_event) {
        if (reject_write_err && u->err && u->err_len) snprintf(u->err, u->err_len, "rejected");
        u->status = reject_status;
        return REJECT_ERR;
    }
    return ESP_OK;
}

static prsl_field_t make_field(size_t max_size, const char *accept) {
    prsl_field_t f = {0};
    f.group_id = "sys";
    f.key = "fw";
    f.label = "Firmware";
    f.type = PRSL_FILE;
    f.on_upload = on_upload_record;
    f.accept = accept;
    f.max_size = max_size;
    f.help = "";
    f.attrs = "";
    return f;
}

static int count_events(int code) {
    int i, n = 0;
    for (i = 0; i < event_count; i++) {
        if (events[i] == code) n++;
    }
    return n;
}

static const char *file_label(void) { return "firmware.bin"; }

void setUp(void) {
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&store));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&store, "sys", NULL));
    memset(&st, 0, sizeof(st));
    event_count = 0;
    reject_event = -1;
    reject_status = 0;
    reject_write_err = 1;
    last_status = 0;
    last_err[0] = '\0';
    last_name = NULL;
    last_mime = NULL;
    last_data = NULL;
    last_len = 0;
    last_offset = 0;
    last_size = 0;
    last_group = NULL;
    last_key = NULL;
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

static void test_upload_lifecycle_ok(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[4] = {1, 2, 3, 4};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "firmware.bin", NULL, 4));
    TEST_ASSERT_TRUE(prsl_upload_is_active(&st));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_end(&st));

    TEST_ASSERT_EQUAL_INT(3, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_META, events[0]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_CHUNK, events[1]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_END, events[2]);
    TEST_ASSERT_EQUAL_INT(0, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_TRUE(st.finished);
    TEST_ASSERT_FALSE(st.active);
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
    TEST_ASSERT_EQUAL(ESP_OK, st.result);
    TEST_ASSERT_EQUAL_INT(0, last_status); /* status hint unset on the wire */
}

static void test_upload_chunk_payload(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[3] = {'a', 'b', 'c'};

    TEST_ASSERT_EQUAL(ESP_OK,
        prsl_upload_begin(&st, &f, "firmware.bin", "application/octet-stream", 3));
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_META, events[0]);
    TEST_ASSERT_EQUAL_STRING("firmware.bin", last_name);
    TEST_ASSERT_EQUAL_STRING("application/octet-stream", last_mime);
    TEST_ASSERT_EQUAL_STRING("sys", last_group);
    TEST_ASSERT_EQUAL_STRING("fw", last_key);
    TEST_ASSERT_EQUAL_UINT32(3, (uint32_t)last_size);
    TEST_ASSERT_NULL(last_data);

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_CHUNK, events[1]);
    TEST_ASSERT_EQUAL_PTR(buf, last_data);
    TEST_ASSERT_EQUAL_UINT32(3, (uint32_t)last_len);
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)last_offset);
    TEST_ASSERT_EQUAL_UINT32(3, (uint32_t)last_size);
    TEST_ASSERT_EQUAL_STRING("firmware.bin", last_name);
    TEST_ASSERT_EQUAL_STRING("application/octet-stream", last_mime);
}

static void test_upload_chunk_mime_null_when_absent(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[2] = {1, 2};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 2));
    TEST_ASSERT_NULL(last_mime);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_NULL(last_mime);
}

static void test_upload_chunk_invalid_offset(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[2] = {1, 2};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_chunk(&st, buf, 1, 0));
    TEST_ASSERT_EQUAL_INT(3, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_ABORT, events[2]);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_EQUAL_INT(400, st.status);
    TEST_ASSERT_EQUAL_INT(400, st.default_status);
    TEST_ASSERT_EQUAL_STRING("Invalid offset", st.err);
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
}

static void test_upload_end_incomplete(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[2] = {1, 2};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_end(&st));
    TEST_ASSERT_EQUAL_INT(3, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_CHUNK, events[1]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_ABORT, events[2]);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_EQUAL_INT(400, st.status);
    TEST_ASSERT_EQUAL_INT(400, st.default_status);
    TEST_ASSERT_EQUAL_STRING("Incomplete upload", st.err);
    TEST_ASSERT_FALSE(st.finished);
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
}

static void test_upload_meta_rejection(void) {
    prsl_field_t f = make_field(0, NULL);
    reject_event = PRSL_UPLOAD_META;

    TEST_ASSERT_NOT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    TEST_ASSERT_EQUAL(REJECT_ERR, st.result);
    TEST_ASSERT_EQUAL_INT(2, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_META, events[0]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_ABORT, events[1]);
    TEST_ASSERT_EQUAL_INT(0, count_events(PRSL_UPLOAD_CHUNK));
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
    TEST_ASSERT_TRUE(st.aborted);
    TEST_ASSERT_EQUAL_INT(400, st.default_status);
    TEST_ASSERT_EQUAL_STRING("rejected", st.err);
}

static void test_upload_meta_rejection_generic_err(void) {
    prsl_field_t f = make_field(0, NULL);
    reject_event = PRSL_UPLOAD_META;
    reject_write_err = 0;

    TEST_ASSERT_NOT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    TEST_ASSERT_EQUAL_STRING("Upload rejected", st.err);
}

static void test_upload_chunk_rejection(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[2] = {1, 2};
    reject_event = PRSL_UPLOAD_CHUNK;

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    TEST_ASSERT_EQUAL(REJECT_ERR, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_EQUAL_INT(3, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_META, events[0]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_CHUNK, events[1]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_ABORT, events[2]);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_EQUAL_INT(400, st.default_status);
    TEST_ASSERT_EQUAL_STRING("rejected", st.err);
    TEST_ASSERT_EQUAL(REJECT_ERR, st.result);
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, prsl_upload_chunk(&st, buf, 1, 2));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, prsl_upload_end(&st));
    TEST_ASSERT_EQUAL_INT(3, event_count);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
}

static void test_upload_end_rejection(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[2] = {1, 2};
    reject_event = PRSL_UPLOAD_END;

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 2));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_EQUAL(REJECT_ERR, prsl_upload_end(&st));

    TEST_ASSERT_EQUAL_INT(4, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_META, events[0]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_CHUNK, events[1]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_END, events[2]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_ABORT, events[3]);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_EQUAL_INT(500, st.default_status);
    TEST_ASSERT_EQUAL_STRING("rejected", st.err);
    TEST_ASSERT_EQUAL(REJECT_ERR, st.result);
    TEST_ASSERT_FALSE(st.finished);
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
}

static void test_upload_reject_status_override_and_clamp(void) {
    prsl_field_t f = make_field(0, NULL);
    reject_event = PRSL_UPLOAD_META;

    reject_status = 429;
    TEST_ASSERT_NOT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL_INT(429, st.status);
    TEST_ASSERT_EQUAL_INT(400, st.default_status);

    event_count = 0;
    reject_status = 200;
    TEST_ASSERT_NOT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL_INT(400, st.status);

    event_count = 0;
    reject_status = 700;
    TEST_ASSERT_NOT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL_INT(599, st.status);
}

static void test_upload_abort_twice_once(void) {
    prsl_field_t f = make_field(0, NULL);

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    prsl_upload_abort(&st);
    prsl_upload_abort(&st);

    TEST_ASSERT_EQUAL_INT(2, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_META, events[0]);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_ABORT, events[1]);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));
    TEST_ASSERT_TRUE(st.aborted);
}

static void test_upload_abort_after_end_noop(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[1] = {7};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_end(&st));

    prsl_upload_abort(&st);
    TEST_ASSERT_EQUAL_INT(3, event_count);
    TEST_ASSERT_EQUAL_INT(0, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_FALSE(st.aborted);
    TEST_ASSERT_TRUE(st.finished);
    TEST_ASSERT_FALSE(st.active);
}

static void test_upload_begin_while_active(void) {
    prsl_field_t f = make_field(0, NULL);

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, prsl_upload_begin(&st, &f, "b.bin", NULL, 1));
    TEST_ASSERT_EQUAL_INT(1, event_count);
    TEST_ASSERT_TRUE(prsl_upload_is_active(&st));
    TEST_ASSERT_EQUAL_STRING("a.bin", st.name);
}

static void test_upload_begin_validation_failure_no_callback(void) {
    prsl_field_t f = make_field(0, NULL);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_begin(&st, &f, "a.bin", NULL, 0));
    TEST_ASSERT_EQUAL_INT(0, event_count);
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, st.result);
    TEST_ASSERT_EQUAL_INT(400, st.status);
    TEST_ASSERT_EQUAL_INT(400, st.default_status);
    TEST_ASSERT_EQUAL_STRING("Empty file", st.err);
    TEST_ASSERT_FALSE(prsl_upload_is_active(&st));

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_begin(&st, &f, "..", NULL, 1));
    TEST_ASSERT_EQUAL_INT(0, event_count);
    TEST_ASSERT_EQUAL_STRING("Invalid name", st.err);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_begin(&st, NULL, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL_INT(0, event_count);
    TEST_ASSERT_EQUAL_STRING("Invalid field", st.err);
}

static void test_upload_chunk_too_large(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[8] = {0};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_chunk(&st, buf, 5, 0));
    TEST_ASSERT_EQUAL_INT(2, event_count);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
    TEST_ASSERT_EQUAL_INT(413, st.status);
    TEST_ASSERT_EQUAL_INT(413, st.default_status);
    TEST_ASSERT_EQUAL_STRING("File too large", st.err);

    /* offset alone beyond the declared size */
    event_count = 0;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    st.offset = 5;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_chunk(&st, buf, 0, 5));
    TEST_ASSERT_EQUAL_INT(413, st.status);
    TEST_ASSERT_EQUAL_STRING("File too large", st.err);

    /* declared size within max_size but the chunk exceeds max_size */
    event_count = 0;
    f = make_field(4, NULL);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 4));
    st.size = 8;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_upload_chunk(&st, buf, 6, 0));
    TEST_ASSERT_EQUAL_INT(413, st.status);
    TEST_ASSERT_EQUAL_STRING("File too large", st.err);
    TEST_ASSERT_EQUAL_INT(1, count_events(PRSL_UPLOAD_ABORT));
}

static void test_upload_zero_length_chunk(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t dummy = 0;

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", NULL, 1));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, &dummy, 0, 0));
    TEST_ASSERT_EQUAL_INT(2, event_count);
    TEST_ASSERT_EQUAL(PRSL_UPLOAD_CHUNK, events[1]);
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)last_len);
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)st.offset);
    TEST_ASSERT_EQUAL_PTR(&dummy, last_data);
    TEST_ASSERT_TRUE(prsl_upload_is_active(&st));
}

static void test_upload_begin_clears_previous_state(void) {
    prsl_field_t f = make_field(0, NULL);
    uint8_t buf[2] = {1, 2};

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "a.bin", "text/plain", 2));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_chunk(&st, buf, sizeof(buf), 0));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_end(&st));
    TEST_ASSERT_TRUE(st.finished);
    TEST_ASSERT_TRUE(st.has_mime);

    TEST_ASSERT_EQUAL(ESP_OK, prsl_upload_begin(&st, &f, "b.bin", NULL, 3));
    TEST_ASSERT_FALSE(st.finished);
    TEST_ASSERT_FALSE(st.aborted);
    TEST_ASSERT_FALSE(st.has_mime);
    TEST_ASSERT_EQUAL_STRING("", st.mime);
    TEST_ASSERT_EQUAL_STRING("b.bin", st.name);
    TEST_ASSERT_EQUAL_UINT32(3, (uint32_t)st.size);
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)st.offset);
    TEST_ASSERT_TRUE(prsl_upload_is_active(&st));
    TEST_ASSERT_NULL(last_mime);
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
    RUN_TEST(test_upload_lifecycle_ok);
    RUN_TEST(test_upload_chunk_payload);
    RUN_TEST(test_upload_chunk_mime_null_when_absent);
    RUN_TEST(test_upload_chunk_invalid_offset);
    RUN_TEST(test_upload_end_incomplete);
    RUN_TEST(test_upload_meta_rejection);
    RUN_TEST(test_upload_meta_rejection_generic_err);
    RUN_TEST(test_upload_chunk_rejection);
    RUN_TEST(test_upload_end_rejection);
    RUN_TEST(test_upload_reject_status_override_and_clamp);
    RUN_TEST(test_upload_abort_twice_once);
    RUN_TEST(test_upload_abort_after_end_noop);
    RUN_TEST(test_upload_begin_while_active);
    RUN_TEST(test_upload_begin_validation_failure_no_callback);
    RUN_TEST(test_upload_chunk_too_large);
    RUN_TEST(test_upload_zero_length_chunk);
    RUN_TEST(test_upload_begin_clears_previous_state);
    return UNITY_END();
}
