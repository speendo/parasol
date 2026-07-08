#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"
#include "pwui.h"

#define PWUI_MAX_PATH 128

typedef struct {
    const char *comp_id;       /* points to flash string literal */
    const char *key;           /* points to flash string literal */
    const char *label;         /* points to flash string literal */
    pwui_type_t type;
    bool is_status;
    const char *help;          /* points to flash string literal, or "" */
    const char *attrs;         /* points to flash string literal, or "" */
    pwui_apply_cb_t on_apply;
    pwui_load_cb_t on_load;
    const char *(*options)[2]; /* points to static array of [value,label] pairs */
    int option_count;
    cJSON *value;              /* cJSON value node (RAM) */
} pwui_field_t;

typedef struct {
    const char *comp_id;
    const char *label;
} pwui_comp_meta_t;

typedef struct {
    pwui_field_t *fields;
    int count;
    int capacity;
    bool dirty;
    pwui_comp_meta_t *comps;
    int comp_count;
    int comp_capacity;
} pwui_store_t;

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t pwui_store_init(pwui_store_t *store);
void pwui_store_deinit(pwui_store_t *store);
esp_err_t pwui_store_add_field(pwui_store_t *store, const pwui_field_t *field);
esp_err_t pwui_store_add_component(pwui_store_t *store, const char *comp_id, const char *label);
const char *pwui_store_get_label(pwui_store_t *store, const char *comp_id);
pwui_field_t *pwui_store_find(pwui_store_t *store, const char *comp_id, const char *key);
esp_err_t pwui_store_set_value(pwui_store_t *store, const char *comp_id, const char *key, const char *value_str);
cJSON *pwui_store_get_value(pwui_store_t *store, const char *comp_id, const char *key);
bool pwui_store_is_dirty(pwui_store_t *store);
void pwui_store_set_dirty(pwui_store_t *store, bool d);
void pwui_store_clear_dirty(pwui_store_t *store);
int pwui_store_settings_count(pwui_store_t *store);
int pwui_store_status_count(pwui_store_t *store);
pwui_field_t *pwui_store_field_at(pwui_store_t *store, int i);
void pwui_store_lock(pwui_store_t *store);
void pwui_store_unlock(pwui_store_t *store);

/** @brief Call on_load on every registered field to populate initial values. */
esp_err_t pwui_store_load_values(pwui_store_t *store);

/** @brief Re-call on_load on every field (for reset). */
esp_err_t pwui_store_reset_values(pwui_store_t *store);

#ifdef __cplusplus
}
#endif
