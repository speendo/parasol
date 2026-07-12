#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"
#include "prsl.h"

#define PRSL_MAX_PATH 128

typedef struct {
    const char *group_id;      /* points to flash string literal */
    const char *key;           /* points to flash string literal */
    const char *label;         /* points to flash string literal */
    prsl_type_t type;
    bool is_status;
    const char *help;          /* points to flash string literal, or "" */
    const char *attrs;         /* points to flash string literal, or "" */
    prsl_set_cb_t on_set;
    prsl_get_cb_t on_get;
    const char *(*options)[2]; /* points to static array of [value,label] pairs */
    int option_count;
    cJSON *value;              /* cJSON value node (RAM) */
} prsl_field_t;

typedef struct {
    const char *group_id;
    const char *label;
} prsl_group_meta_t;

typedef struct {
    prsl_field_t *fields;
    int count;
    int capacity;
    bool dirty;
    prsl_group_meta_t *groups;
    int group_count;
    int group_capacity;
    prsl_is_dirty_cb_t is_dirty_hook;
} prsl_store_t;

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t prsl_store_init(prsl_store_t *store);
void prsl_store_deinit(prsl_store_t *store);
esp_err_t prsl_store_add_group(prsl_store_t *store, const char *group_id, const char *label);
bool prsl_store_has_group(prsl_store_t *store, const char *group_id);
esp_err_t prsl_store_add_field(prsl_store_t *store, const prsl_field_t *field);
const char *prsl_store_get_label(prsl_store_t *store, const char *group_id);
prsl_field_t *prsl_store_find(prsl_store_t *store, const char *group_id, const char *key);
esp_err_t prsl_store_set_value(prsl_store_t *store, const char *group_id, const char *key, const char *value_str);
cJSON *prsl_store_get_value(prsl_store_t *store, const char *group_id, const char *key);
bool prsl_store_is_dirty(prsl_store_t *store);
void prsl_store_set_dirty(prsl_store_t *store, bool d);
void prsl_store_clear_dirty(prsl_store_t *store);
void prsl_store_set_dirty_hook(prsl_store_t *store, prsl_is_dirty_cb_t hook);
void prsl_store_check_dirty(prsl_store_t *store);
int prsl_store_settings_count(prsl_store_t *store);
int prsl_store_status_count(prsl_store_t *store);
prsl_field_t *prsl_store_field_at(prsl_store_t *store, int i);
void prsl_store_lock(prsl_store_t *store);
void prsl_store_unlock(prsl_store_t *store);

/** @brief Call on_get on every registered field to populate initial values. */
esp_err_t prsl_store_load_values(prsl_store_t *store);

/** @brief Re-call on_get on every field (for reset). */
esp_err_t prsl_store_reset_values(prsl_store_t *store);

#ifdef __cplusplus
}
#endif
