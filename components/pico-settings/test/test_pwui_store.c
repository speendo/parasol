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

void test_set_value_overwrite(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);

    pwui_store_set_value(&store, "wifi", "ssid", "first");
    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("first", cJSON_GetStringValue(v1));

    pwui_store_set_value(&store, "wifi", "ssid", "second");
    cJSON *v2 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("second", cJSON_GetStringValue(v2));
}

void test_find_null_args(void) {
    TEST_ASSERT_NULL(pwui_store_find(NULL, "x", "y"));
    TEST_ASSERT_NULL(pwui_store_find(&store, NULL, "y"));
    TEST_ASSERT_NULL(pwui_store_find(&store, "x", NULL));
}

void test_store_field_at_bounds(void) {
    TEST_ASSERT_NULL(pwui_store_field_at(&store, -1));
    TEST_ASSERT_NULL(pwui_store_field_at(&store, 0));

    pwui_field_t f = make_field("a", "b", PWUI_TEXT, false);
    pwui_store_add_field(&store, &f);

    TEST_ASSERT_NULL(pwui_store_field_at(&store, 1));
    TEST_ASSERT_NOT_NULL(pwui_store_field_at(&store, 0));
}

void test_add_component_same_id_label(void) {
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp1", "label1"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp1", "label1"));
}

void test_add_component_same_id_different_label(void) {
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp1", "label1"));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, pwui_store_add_component(&store, "comp1", "label2"));
}

void test_get_label_nonexistent(void) {
    TEST_ASSERT_NULL(pwui_store_get_label(&store, "unknown"));
}

void test_get_label_after_add(void) {
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "wifi", "WiFi Settings"));
    const char *label = pwui_store_get_label(&store, "wifi");
    TEST_ASSERT_NOT_NULL(label);
    TEST_ASSERT_EQUAL_STRING("WiFi Settings", label);
}

void test_capacity_growth_comps(void) {
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp0", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp1", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp2", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp3", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp4", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp5", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp6", "label"));
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_add_component(&store, "comp7", "label"));
    TEST_ASSERT_EQUAL(8, store.comp_count);
    TEST_ASSERT_GREATER_OR_EQUAL(8, store.comp_capacity);
}

void test_store_init_null(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, pwui_store_init(NULL));
}

void test_add_field_null_store(void) {
    pwui_field_t f = make_field("x", "y", PWUI_TEXT, false);
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, pwui_store_add_field(NULL, &f));
}

static const char *test_load_ssid(void) { return "LoadedSSID"; }
static const char *test_load_pass(void) { return "secret"; }
static const char *test_load_null(void) { return NULL; }
static const char *test_load_default(void) { return "MyNetwork"; }

void test_load_values_calls_on_load(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = test_load_ssid;
    pwui_store_add_field(&store, &f);

    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));

    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v));
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v));
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_load_values_multiple_fields(void) {
    pwui_field_t f1 = make_field("wifi", "ssid", PWUI_TEXT, false);
    f1.on_load = test_load_ssid;
    pwui_store_add_field(&store, &f1);

    pwui_field_t f2 = make_field("wifi", "pass", PWUI_PASSWORD, false);
    f2.on_load = test_load_pass;
    pwui_store_add_field(&store, &f2);

    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));

    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v1));
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v1));

    cJSON *v2 = pwui_store_get_value(&store, "wifi", "pass");
    TEST_ASSERT_TRUE(cJSON_IsString(v2));
    TEST_ASSERT_EQUAL_STRING("secret", cJSON_GetStringValue(v2));
}

void test_load_values_null_on_load_skipped(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = NULL;
    pwui_store_add_field(&store, &f);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));
    cJSON *v = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v);
}

void test_load_values_on_load_returns_null(void) {
    pwui_field_t f = make_field("gpio", "confirm", PWUI_CHECKBOX, false);
    f.on_load = test_load_null;
    pwui_store_add_field(&store, &f);
    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_load_values(&store));
    cJSON *v = pwui_store_get_value(&store, "gpio", "confirm");
    TEST_ASSERT_TRUE(cJSON_IsNull(v));
}

void test_reset_values_reloads_all(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = test_load_ssid;
    pwui_store_add_field(&store, &f);

    pwui_store_load_values(&store);
    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v1));

    pwui_store_set_value(&store, "wifi", "ssid", "ChangedValue");
    TEST_ASSERT_TRUE(pwui_store_is_dirty(&store));

    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_reset_values(&store));
    cJSON *v2 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_EQUAL_STRING("LoadedSSID", cJSON_GetStringValue(v2));
    TEST_ASSERT_FALSE(pwui_store_is_dirty(&store));
}

void test_reset_values_null_on_load(void) {
    pwui_field_t f = make_field("wifi", "ssid", PWUI_TEXT, false);
    f.on_load = NULL;
    pwui_store_add_field(&store, &f);
    pwui_store_set_value(&store, "wifi", "ssid", "SomeValue");
    cJSON *v1 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_TRUE(cJSON_IsString(v1));

    TEST_ASSERT_EQUAL(ESP_OK, pwui_store_reset_values(&store));
    cJSON *v2 = pwui_store_get_value(&store, "wifi", "ssid");
    TEST_ASSERT_NULL(v2);
}

void test_reset_values_null_store(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, pwui_store_reset_values(NULL));
}

void test_load_values_null_store(void) {
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, pwui_store_load_values(NULL));
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
    RUN_TEST(test_set_unknown_field);
    RUN_TEST(test_capacity_growth);
    RUN_TEST(test_deinit_empty_store);
    RUN_TEST(test_set_value_overwrite);
    RUN_TEST(test_find_null_args);
    RUN_TEST(test_store_field_at_bounds);
    RUN_TEST(test_add_component_same_id_label);
    RUN_TEST(test_add_component_same_id_different_label);
    RUN_TEST(test_get_label_nonexistent);
    RUN_TEST(test_get_label_after_add);
    RUN_TEST(test_capacity_growth_comps);
    RUN_TEST(test_store_init_null);
    RUN_TEST(test_add_field_null_store);
    RUN_TEST(test_load_values_calls_on_load);
    RUN_TEST(test_load_values_multiple_fields);
    RUN_TEST(test_load_values_null_on_load_skipped);
    RUN_TEST(test_load_values_on_load_returns_null);
    RUN_TEST(test_reset_values_reloads_all);
    RUN_TEST(test_reset_values_null_on_load);
    RUN_TEST(test_reset_values_null_store);
    RUN_TEST(test_load_values_null_store);
    return UNITY_END();
}
