#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "unity.h"
#include "prsl_store.h"

static prsl_store_t store;

static const char *get_persisted_val(void) {
    return "persisted";
}

static const char *get_persisted_val2(void) {
    return "persisted2";
}

static prsl_field_t make_field(const char *group, const char *k, prsl_type_t t, bool st) {
    prsl_field_t f = {0};
    f.group_id = group;
    f.key = k;
    f.label = "Test";
    f.type = t;
    f.is_status = st;
    f.help = "";
    f.attrs = "";
    f.on_get = NULL;
    f.on_set = NULL;
    f.options = NULL;
    f.option_count = 0;
    return f;
}

void setUp(void) {
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&store));
}

void tearDown(void) {
    prsl_store_deinit(&store);
}

void test_init_deinit(void) {
    prsl_store_t s;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&s));
    TEST_ASSERT_EQUAL(0, s.count);
    TEST_ASSERT_EQUAL(0, s.group_count);
    TEST_ASSERT_FALSE(s.dirty);
    prsl_store_deinit(&s);
    TEST_ASSERT_EQUAL(0, s.count);
    TEST_ASSERT_EQUAL(0, s.group_count);
}

void test_init_null(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_store_init(NULL));
}

void test_add_group_success(void) {
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&store, "wifi", "WiFi Settings"));
    TEST_ASSERT_EQUAL(1, store.group_count);
}

void test_add_group_duplicate_same_label(void) {
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&store, "wifi", "WiFi Settings"));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&store, "wifi", "WiFi Settings"));
    TEST_ASSERT_EQUAL(1, store.group_count);
}

void test_add_group_duplicate_different_label(void) {
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&store, "wifi", "WiFi Settings"));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, prsl_store_add_group(&store, "wifi", "Network"));
    TEST_ASSERT_EQUAL(1, store.group_count);
}

void test_add_group_null_id(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_store_add_group(&store, NULL, "label"));
}

void test_has_group_true(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    TEST_ASSERT_TRUE(prsl_store_has_group(&store, "wifi"));
}

void test_has_group_false(void) {
    TEST_ASSERT_FALSE(prsl_store_has_group(&store, "unknown"));
}

void test_has_group_null(void) {
    TEST_ASSERT_FALSE(prsl_store_has_group(&store, NULL));
}

void test_add_field_no_group(void) {
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND, prsl_store_add_field(&store, &f));
    TEST_ASSERT_EQUAL(0, store.count);
}

void test_add_field_after_group(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f));
    TEST_ASSERT_EQUAL(1, store.count);
}

void test_add_field_null_store(void) {
    prsl_field_t f = make_field("x", "y", PRSL_TEXT, false);
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_store_add_field(NULL, &f));
}

void test_add_field_interleaved(void) {
    prsl_store_add_group(&store, "groupA", "Group A");
    prsl_store_add_group(&store, "groupB", "Group B");
    prsl_field_t f1 = make_field("groupA", "f1", PRSL_TEXT, false);
    prsl_field_t f2 = make_field("groupB", "f1", PRSL_NUMBER, false);
    prsl_field_t f3 = make_field("groupA", "f2", PRSL_SWITCH, false);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f1));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f2));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f3));
    TEST_ASSERT_EQUAL(3, store.count);
}

void test_find_found(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    prsl_store_add_field(&store, &f);
    prsl_field_t *found = prsl_store_find(&store, "wifi", "ssid");
    TEST_ASSERT_NOT_NULL(found);
    TEST_ASSERT_EQUAL_STRING("wifi", found->group_id);
    TEST_ASSERT_EQUAL_STRING("ssid", found->key);
}

void test_find_not_found(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    prsl_field_t *found = prsl_store_find(&store, "wifi", "nope");
    TEST_ASSERT_NULL(found);
}

void test_find_unknown_group(void) {
    prsl_field_t *found = prsl_store_find(&store, "nope", "nope");
    TEST_ASSERT_NULL(found);
}

void test_find_null_args(void) {
    TEST_ASSERT_NULL(prsl_store_find(NULL, "x", "y"));
    TEST_ASSERT_NULL(prsl_store_find(&store, NULL, "y"));
    TEST_ASSERT_NULL(prsl_store_find(&store, "x", NULL));
}

void test_set_get_value_string(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    prsl_store_add_field(&store, &f);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_set_value(&store, "wifi", "ssid", "MyNet"));
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("MyNet", cJSON_GetStringValue(v));
}

void test_set_value_unknown_field(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND, prsl_store_set_value(&store, "nope", "nope", "x"));
}

void test_set_value_overwrite(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    prsl_store_add_field(&store, &f);
    prsl_store_set_value(&store, "wifi", "ssid", "first");
    cJSON *v1 = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("first", cJSON_GetStringValue(v1));
    prsl_store_set_value(&store, "wifi", "ssid", "second");
    cJSON *v2 = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("second", cJSON_GetStringValue(v2));
}

void test_get_value_unknown(void) {
    cJSON *v = prsl_store_get_value(&store, "nope", "nope");
    TEST_ASSERT_NULL(v);
}

void test_load_values_calls_on_get(void) {
    prsl_store_add_group(&store, "wifi", "WiFi");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    f.on_get = get_persisted_val;
    prsl_store_add_field(&store, &f);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_load_values(&store));
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("persisted", cJSON_GetStringValue(v));
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&store));
}

void test_reset_values_calls_on_get(void) {
    prsl_store_add_group(&store, "wifi", "WiFi");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    f.on_get = get_persisted_val;
    prsl_store_add_field(&store, &f);
    prsl_store_load_values(&store);
    prsl_store_set_value(&store, "wifi", "ssid", "changed");
    cJSON *v1 = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("changed", cJSON_GetStringValue(v1));
    prsl_store_reset_values(&store);
    cJSON *v2 = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("persisted", cJSON_GetStringValue(v2));
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&store));
}

void test_reset_values_no_on_get_sets_null(void) {
    prsl_store_add_group(&store, "wifi", "WiFi");
    prsl_field_t f = make_field("wifi", "ssid", PRSL_TEXT, false);
    f.on_get = NULL;
    prsl_store_add_field(&store, &f);
    prsl_store_load_values(&store);
    prsl_store_set_value(&store, "wifi", "ssid", "val");
    prsl_store_reset_values(&store);
    cJSON *v = prsl_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsNull(v));
}

void test_load_values_null_store(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_store_load_values(NULL));
}

void test_reset_values_null_store(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, prsl_store_reset_values(NULL));
}

void test_get_label_after_add(void) {
    prsl_store_add_group(&store, "wifi", "WiFi Settings");
    const char *label = prsl_store_get_label(&store, "wifi");
    TEST_ASSERT_NOT_NULL(label);
    TEST_ASSERT_EQUAL_STRING("WiFi Settings", label);
}

void test_get_label_nonexistent(void) {
    TEST_ASSERT_NULL(prsl_store_get_label(&store, "unknown"));
}

void test_field_at_bounds(void) {
    TEST_ASSERT_NULL(prsl_store_field_at(&store, -1));
    TEST_ASSERT_NULL(prsl_store_field_at(&store, 0));
    prsl_store_add_group(&store, "g", "G");
    prsl_field_t f = make_field("g", "k", PRSL_TEXT, false);
    prsl_store_add_field(&store, &f);
    TEST_ASSERT_NULL(prsl_store_field_at(&store, 1));
    TEST_ASSERT_NOT_NULL(prsl_store_field_at(&store, 0));
}

void test_capacity_growth_fields(void) {
    prsl_store_add_group(&store, "g", "G");
    prsl_field_t f = make_field("g", "k", PRSL_TEXT, false);
    for (int i = 0; i < 32; i++) {
        TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&store, &f));
    }
    TEST_ASSERT_GREATER_OR_EQUAL(32, store.count);
    TEST_ASSERT_GREATER_OR_EQUAL(32, store.capacity);
}

void test_set_dirty_direct(void) {
    prsl_store_set_dirty(&store, true);
    TEST_ASSERT_TRUE(prsl_store_is_dirty(&store));
    prsl_store_set_dirty(&store, false);
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&store));
}

void test_prsl_set_dirty_sets_flag(void) {
    prsl_store_t s;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&s));
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&s));
    prsl_store_set_dirty(&s, true);
    TEST_ASSERT_TRUE(prsl_store_is_dirty(&s));
    prsl_store_set_dirty(&s, false);
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&s));
    prsl_store_deinit(&s);
}

void test_prsl_store_set_value_does_not_set_dirty(void) {
    prsl_store_t s;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&s));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&s, "g", NULL));
    prsl_field_t f = { .group_id = "g", .key = "k", .label = "L", .type = PRSL_TEXT,
                       .is_status = false, .help = "", .attrs = "" };
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&s, &f));
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&s));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_set_value(&s, "g", "k", "hello"));
    TEST_ASSERT_FALSE(prsl_store_is_dirty(&s));
    prsl_store_deinit(&s);
}

void test_recursive_mutex_allows_reentry(void) {
    prsl_store_t s;
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_init(&s));
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_group(&s, "g", NULL));
    prsl_field_t f = { .group_id = "g", .key = "k", .label = "L", .type = PRSL_TEXT,
                       .is_status = false, .help = "", .attrs = "" };
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_add_field(&s, &f));

    xSemaphoreTakeRecursive(s.mutex, portMAX_DELAY);
    TEST_ASSERT_EQUAL(ESP_OK, prsl_store_set_value(&s, "g", "k", "v"));
    xSemaphoreGiveRecursive(s.mutex);

    cJSON *v = prsl_store_get_value(&s, "g", "k");
    TEST_ASSERT_TRUE(v && cJSON_IsString(v) && strcmp(cJSON_GetStringValue(v), "v") == 0);
    xSemaphoreGiveRecursive(s.mutex);
    prsl_store_deinit(&s);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_deinit);
    RUN_TEST(test_init_null);
    RUN_TEST(test_add_group_success);
    RUN_TEST(test_add_group_duplicate_same_label);
    RUN_TEST(test_add_group_duplicate_different_label);
    RUN_TEST(test_add_group_null_id);
    RUN_TEST(test_has_group_true);
    RUN_TEST(test_has_group_false);
    RUN_TEST(test_has_group_null);
    RUN_TEST(test_add_field_no_group);
    RUN_TEST(test_add_field_after_group);
    RUN_TEST(test_add_field_null_store);
    RUN_TEST(test_add_field_interleaved);
    RUN_TEST(test_find_found);
    RUN_TEST(test_find_not_found);
    RUN_TEST(test_find_unknown_group);
    RUN_TEST(test_find_null_args);
    RUN_TEST(test_set_get_value_string);
    RUN_TEST(test_set_value_unknown_field);
    RUN_TEST(test_set_value_overwrite);
    RUN_TEST(test_get_value_unknown);
    RUN_TEST(test_load_values_calls_on_get);
    RUN_TEST(test_reset_values_calls_on_get);
    RUN_TEST(test_reset_values_no_on_get_sets_null);
    RUN_TEST(test_load_values_null_store);
    RUN_TEST(test_reset_values_null_store);
    RUN_TEST(test_get_label_after_add);
    RUN_TEST(test_get_label_nonexistent);
    RUN_TEST(test_field_at_bounds);
    RUN_TEST(test_capacity_growth_fields);
    RUN_TEST(test_set_dirty_direct);
    RUN_TEST(test_prsl_set_dirty_sets_flag);
    RUN_TEST(test_prsl_store_set_value_does_not_set_dirty);
    RUN_TEST(test_recursive_mutex_allows_reentry);
    return UNITY_END();
}
