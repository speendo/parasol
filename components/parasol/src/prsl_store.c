#include "prsl_store.h"
#include <stdlib.h>
#include <string.h>

esp_err_t prsl_store_init(prsl_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    memset(store, 0, sizeof(*store));
    store->capacity = 16;
    store->fields = calloc(store->capacity, sizeof(prsl_field_t));
    if (!store->fields) return ESP_ERR_NO_MEM;
    store->group_capacity = 4;
    store->groups = calloc(store->group_capacity, sizeof(prsl_group_meta_t));
    if (!store->groups) {
        free(store->fields);
        return ESP_ERR_NO_MEM;
    }
    store->mutex = xSemaphoreCreateMutex();
    if (!store->mutex) {
        free(store->groups);
        free(store->fields);
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void prsl_store_deinit(prsl_store_t *store) {
    if (!store) return;
    for (int i = 0; i < store->count; i++) {
        cJSON_Delete(store->fields[i].value);
    }
    if (store->mutex) {
        vSemaphoreDelete(store->mutex);
        store->mutex = NULL;
    }
    free(store->fields);
    free(store->groups);
    memset(store, 0, sizeof(*store));
}

esp_err_t prsl_store_add_field(prsl_store_t *store, const prsl_field_t *field) {
    if (!store || !field) return ESP_ERR_INVALID_ARG;
    if (!prsl_store_has_group(store, field->group_id)) return ESP_ERR_NOT_FOUND;
    xSemaphoreTake(store->mutex, portMAX_DELAY);
    if (store->count >= store->capacity) {
        int new_cap = store->capacity * 2;
        prsl_field_t *new_fields = realloc(store->fields, new_cap * sizeof(prsl_field_t));
        if (!new_fields) {
            xSemaphoreGive(store->mutex);
            return ESP_ERR_NO_MEM;
        }
        store->fields = new_fields;
        store->capacity = new_cap;
    }
    store->fields[store->count] = *field;
    store->fields[store->count].value = NULL;
    store->count++;
    xSemaphoreGive(store->mutex);
    return ESP_OK;
}

prsl_field_t *prsl_store_find(prsl_store_t *store, const char *group_id, const char *key) {
    if (!store || !group_id || !key) return NULL;
    xSemaphoreTake(store->mutex, portMAX_DELAY);
    for (int i = 0; i < store->count; i++) {
        if (strcmp(store->fields[i].group_id, group_id) == 0 &&
            strcmp(store->fields[i].key, key) == 0) {
            xSemaphoreGive(store->mutex);
            return &store->fields[i];
        }
    }
    xSemaphoreGive(store->mutex);
    return NULL;
}

prsl_field_t *prsl_store_field_at(prsl_store_t *store, int i) {
    if (!store || i < 0 || i >= store->count) return NULL;
    return &store->fields[i];
}

static bool is_bool_type(prsl_type_t t) {
    return t == PRSL_CHECKBOX || t == PRSL_SWITCH;
}

static bool is_number_type(prsl_type_t t) {
    return t == PRSL_NUMBER || t == PRSL_RANGE;
}

esp_err_t prsl_store_set_value(prsl_store_t *store, const char *group_id,
                                const char *key, const char *value_str) {
    if (!store || !group_id || !key) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(store->mutex, portMAX_DELAY);

    /* Inline find to avoid re-entrant mutex in prsl_store_find */
    prsl_field_t *f = NULL;
    for (int i = 0; i < store->count; i++) {
        if (strcmp(store->fields[i].group_id, group_id) == 0 &&
            strcmp(store->fields[i].key, key) == 0) {
            f = &store->fields[i];
            break;
        }
    }
    if (!f) {
        xSemaphoreGive(store->mutex);
        return ESP_ERR_NOT_FOUND;
    }

    cJSON_Delete(f->value);
    f->value = NULL;

    if (value_str == NULL || (is_bool_type(f->type) && value_str[0] == '\0')) {
        f->value = cJSON_CreateNull();
    } else if (is_bool_type(f->type)) {
        bool v = (strcmp(value_str, "true") == 0 || strcmp(value_str, "1") == 0);
        f->value = cJSON_CreateBool(v);
    } else if (is_number_type(f->type)) {
        f->value = cJSON_CreateNumber(atof(value_str));
    } else {
        f->value = cJSON_CreateString(value_str);
    }

    if (!f->is_status) {
        if (store->is_dirty_hook) {
            char path[PRSL_MAX_PATH];
            snprintf(path, sizeof(path), "%s.%s", group_id, key);
            const char *cv = (f->value && cJSON_IsString(f->value))
                ? cJSON_GetStringValue(f->value) : NULL;
            if (store->is_dirty_hook(group_id, key, cv)) {
                store->dirty = true;
            }
        } else {
            store->dirty = true;
        }
    }
    xSemaphoreGive(store->mutex);
    return ESP_OK;
}

cJSON *prsl_store_get_value(prsl_store_t *store, const char *group_id, const char *key) {
    if (!store || !group_id || !key) return NULL;
    xSemaphoreTake(store->mutex, portMAX_DELAY);
    /* Inline find to avoid re-entrant mutex */
    prsl_field_t *f = NULL;
    for (int i = 0; i < store->count; i++) {
        if (strcmp(store->fields[i].group_id, group_id) == 0 &&
            strcmp(store->fields[i].key, key) == 0) {
            f = &store->fields[i];
            break;
        }
    }
    cJSON *v = f ? f->value : NULL;
    xSemaphoreGive(store->mutex);
    return v;
}

bool prsl_store_is_dirty(prsl_store_t *store) {
    return store ? store->dirty : false;
}

void prsl_store_set_dirty(prsl_store_t *store, bool d) {
    if (store) store->dirty = d;
}

void prsl_store_clear_dirty(prsl_store_t *store) {
    if (store) store->dirty = false;
}

void prsl_store_set_dirty_hook(prsl_store_t *store, prsl_is_dirty_cb_t hook) {
    if (store) store->is_dirty_hook = hook;
}

void prsl_store_check_dirty(prsl_store_t *store) {
    if (!store || !store->is_dirty_hook) return;
    store->dirty = false;
    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = &store->fields[i];
        if (f->is_status) continue;
        const char *cv = (f->value && cJSON_IsString(f->value))
            ? cJSON_GetStringValue(f->value) : NULL;
        if (store->is_dirty_hook(f->group_id, f->key, cv)) {
            store->dirty = true;
            break;
        }
    }
}

esp_err_t prsl_store_add_group(prsl_store_t *store, const char *group_id, const char *label) {
    if (!store || !group_id) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(store->mutex, portMAX_DELAY);
    for (int i = 0; i < store->group_count; i++) {
        if (strcmp(store->groups[i].group_id, group_id) == 0) {
            if (!label && !store->groups[i].label) {
                xSemaphoreGive(store->mutex);
                return ESP_OK;
            }
            if (label && store->groups[i].label
                && strcmp(store->groups[i].label, label) == 0) {
                xSemaphoreGive(store->mutex);
                return ESP_OK;
            }
            xSemaphoreGive(store->mutex);
            return ESP_ERR_INVALID_STATE;
        }
    }
    if (store->group_count >= store->group_capacity) {
        int new_cap = store->group_capacity * 2;
        prsl_group_meta_t *new_groups = realloc(store->groups, new_cap * sizeof(prsl_group_meta_t));
        if (!new_groups) {
            xSemaphoreGive(store->mutex);
            return ESP_ERR_NO_MEM;
        }
        store->groups = new_groups;
        store->group_capacity = new_cap;
    }
    store->groups[store->group_count].group_id = group_id;
    store->groups[store->group_count].label = label;
    store->group_count++;
    xSemaphoreGive(store->mutex);
    return ESP_OK;
}

bool prsl_store_has_group(prsl_store_t *store, const char *group_id) {
    if (!store || !group_id) return false;
    for (int i = 0; i < store->group_count; i++) {
        if (strcmp(store->groups[i].group_id, group_id) == 0) return true;
    }
    return false;
}

const char *prsl_store_get_label(prsl_store_t *store, const char *group_id) {
    if (!store || !group_id) return NULL;
    for (int i = 0; i < store->group_count; i++) {
        if (strcmp(store->groups[i].group_id, group_id) == 0)
            return store->groups[i].label;
    }
    return NULL;
}

esp_err_t prsl_store_load_values(prsl_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(store->mutex, portMAX_DELAY);
    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = &store->fields[i];
        if (!f->on_get) continue;
        const char *val = f->on_get();
        cJSON_Delete(f->value);
        f->value = NULL;
        if (!val) {
            f->value = cJSON_CreateNull();
        } else {
            f->value = cJSON_CreateString(val);
        }
    }
    store->dirty = false;
    xSemaphoreGive(store->mutex);
    return ESP_OK;
}

esp_err_t prsl_store_reset_values(prsl_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(store->mutex, portMAX_DELAY);
    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = &store->fields[i];
        const char *val = f->on_get ? f->on_get() : NULL;
        cJSON_Delete(f->value);
        f->value = NULL;
        if (!val) {
            f->value = cJSON_CreateNull();
        } else {
            f->value = cJSON_CreateString(val);
        }
    }
    store->dirty = false;
    xSemaphoreGive(store->mutex);
    return ESP_OK;
}
