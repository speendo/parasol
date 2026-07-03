#include "unity.h"
#include "pwui_store.h"
#include "cJSON.h"

static pwui_store_t store;

void setUp(void) {
    pwui_store_init(&store);
}

void tearDown(void) {
    pwui_store_deinit(&store);
}

static pwui_field_t make_field(const char *comp, const char *k, pwui_type_t t, bool st) {
    pwui_field_t f = {0};
    f.comp_id = comp;
    f.key = k;
    f.label = "Test";
    f.type = t;
    f.is_status = st;
    f.help = "";
    f.attrs = "";
    return f;
}

void test_init_empty_store(void) {
    TEST_ASSERT_EQUAL(0, store.count);
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_add_and_find_field(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_field(&store, &f));
    TEST_ASSERT_EQUAL(1, store.count);

    pwui_field_t *found = pwui_store_find(&store, "wifi", "ssid");
    TEST_ASSERT_NOT_NULL(found);
    TEST_ASSERT_EQUAL_STRING("wifi", found->comp_id);
    TEST_ASSERT_EQUAL_STRING("ssid", found->key);
}

void test_find_nonexistent(void) {
    pwui_field_t *found = pwui_store_find(&store, "nope", "nope");
    TEST_ASSERT_NULL(found);
}

void test_set_value_text(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_set_value(&store, "wifi", "ssid", "MyNet"));

    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("MyNet", cJSON_GetStringValue(v));
}

void test_set_value_switch(void) {
    pwui_field_t f = make_field("gpio", "enabled", PWUI_SWITCH, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "gpio", "enabled", "true");

    cJSON *v = pwui_store_get_value(&store, "gpio", "enabled");
    TEST_ASSERT_TRUE(cJSON_IsBool(v));
    TEST_ASSERT_TRUE(cJSON_IsTrue(v));
}

void test_set_value_number(void) {
    pwui_field_t f = make_field("gpio", "pin", PWUI_NUMBER, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "gpio", "pin", "42");

    cJSON *v = pwui_store_get_value(&store, "gpio", "pin");
    TEST_ASSERT_TRUE(cJSON_IsNumber(v));
    TEST_ASSERT_EQUAL(42, cJSON_GetNumberValue(v));
}

void test_set_value_null(void) {
    pwui_field_t f = make_field("gpio", "confirm", PWUI_CHECKBOX, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "gpio", "confirm", NULL);

    cJSON *v = pwui_store_get_value(&store, "gpio", "confirm");
    TEST_ASSERT_TRUE(cJSON_IsNull(v));
}

void test_set_value_marks_dirty(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));

    pwui_store_set_value(&store, "wifi", "ssid", "new");
    TEST_ASSERT_TRUE(pwui_store_is_dirty(&store));
}

void test_status_field_does_not_mark_dirty(void) {
    pwui_field_t f = make_field("system", "uptime", PWUI_TEXT, true);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "system", "uptime", "3h");
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_clear_dirty(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "wifi", "ssid", "new");
    TEST_ASSERT_TRUE(pwui_store_is_dirty(&store));

    pwui_store_clear_dirty(&store);
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_settings_and_status_counts(void) {
    pwui_field_t fs = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_field_t fst = make_field("system", "uptime", PWUI_TEXT, true);
    pwui_store_add_field(&store, &fs);
    pwui_store_add_field(&store, &fst);

    TEST_ASSERT_EQUAL(1, pwui_store_settings_count(&store));
    TEST_ASSERT_EQUAL(1, pwui_store_status_count(&store));
}

void test_populate_from_cjson(void) {
    pwui_field_t f1 = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_field_t f2 = make_field("wifi", "pass", PWUI_PASSWORD, false);
    pwui_store_add_field(&store, &f1);
    pwui_store_add_field(&store, &f2);

    cJSON *data = cJSON_Parse(
        "{\"wifi\":{"
        "\"ssid\":[\"text\",\"SSID\",{\"value\":\"LoadedSSID\"}],"
        "\"pass\":[\"password\",\"Pass\",{\"value\":\"secret\"}]"
        "}}"
    );
    TEST_ASSERT_NOT_NULL(data);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_populate(&store, data));
    cJSON_Delete(data);

    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v));

    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_set_unknown_field(void) {
    esp_err_t err = pwui_store_set_value(&store, "nope", "nope", "x");
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND, err);
}

void test_capacity_growth(void) {
    pwui_field_t f = make_field("a", "a", PWUI_TEXT, false);
    for (int i = 0; i < 32; i++) {
        esp_err_t err = pwui_store_add_field(&store, &f);
        TEST_ASSERT_EQUAL(ESP_OK, err);
    }
    TEST_ASSERT_GREATER_OR_EQUAL(32, store.count);
    TEST_ASSERT_GREATER_OR_EQUAL(32, store.capacity);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_empty_store);
    RUN_TEST(test_add_and_find_field);
    RUN_TEST(test_find_nonexistent);
    RUN_TEST(test_set_value_text);
    RUN_TEST(test_set_value_switch);
    RUN_TEST(test_set_value_number);
    RUN_TEST(test_set_value_null);
    RUN_TEST(test_set_value_marks_dirty);
    RUN_TEST(test_status_field_does_not_mark_dirty);
    RUN_TEST(test_clear_dirty);
    RUN_TEST(test_settings_and_status_counts);
    RUN_TEST(test_populate_from_cjson);
    RUN_TEST(test_set_unknown_field);
    RUN_TEST(test_capacity_growth);
    return UNITY_END();
}
