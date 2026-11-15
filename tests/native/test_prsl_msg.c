#include "unity.h"
#include "prsl_msg.h"
#include "cJSON.h"
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static void assert_frame(prsl_msg_level_t level, const char *text,
                         const char *expect_level) {
    char *out = NULL;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_msg_build(level, text, &out));
    TEST_ASSERT_NOT_NULL(out);
    cJSON *m = cJSON_Parse(out);
    TEST_ASSERT_NOT_NULL(m);
    TEST_ASSERT_EQUAL_STRING("message",
        cJSON_GetStringValue(cJSON_GetObjectItem(m, "type")));
    TEST_ASSERT_EQUAL_STRING(expect_level,
        cJSON_GetStringValue(cJSON_GetObjectItem(m, "level")));
    TEST_ASSERT_EQUAL_STRING(text,
        cJSON_GetStringValue(cJSON_GetObjectItem(m, "message")));
    cJSON_Delete(m);
    free(out);
}

void test_level_names(void) {
    assert_frame(PRSL_MSG_INFO, "a", "info");
    assert_frame(PRSL_MSG_WARNING, "b", "warning");
    assert_frame(PRSL_MSG_ERROR, "c", "error");
    assert_frame((prsl_msg_level_t)99, "d", "info");
}

void test_null_message_rejected(void) {
    char *out = NULL;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_msg_build(PRSL_MSG_INFO, NULL, &out));
    TEST_ASSERT_NULL(out);
}

void test_cap_is_512_bytes(void) {
    char text[PRSL_MSG_MAX + 2];
    char *out = NULL;

    memset(text, 'x', PRSL_MSG_MAX);
    text[PRSL_MSG_MAX] = '\0';
    TEST_ASSERT_EQUAL(ESP_OK, prsl_msg_build(PRSL_MSG_INFO, text, &out));
    TEST_ASSERT_NOT_NULL(out);
    free(out);

    memset(text, 'x', PRSL_MSG_MAX + 1);
    text[PRSL_MSG_MAX + 1] = '\0';
    out = NULL;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_msg_build(PRSL_MSG_INFO, text, &out));
    TEST_ASSERT_NULL(out);
}

void test_message_is_json_escaped(void) {
    assert_frame(PRSL_MSG_WARNING, "say \"hi\"\nnow", "warning");
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_level_names);
    RUN_TEST(test_null_message_rejected);
    RUN_TEST(test_cap_is_512_bytes);
    RUN_TEST(test_message_is_json_escaped);
    return UNITY_END();
}
