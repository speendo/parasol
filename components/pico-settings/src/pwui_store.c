#include "pwui_store.h"
#include <stdlib.h>
#include <string.h>

esp_err_t pwui_store_init(pwui_store_t *store) {
    if (!store) return ESP_ERR_INVALID_ARG;
    memset(store, 0, sizeof(*store));
    store->capacity = 16;
    store->fields = calloc(store->capacity, sizeof(pwui_field_t));
    if (!store->fields) return ESP_ERR_NO_MEM;
    store->comp_capacity = 4;
    store->comps = calloc(store->comp_capacity, sizeof(pwui_comp_meta_t));
    if (!store->comps) {
        free(store->fields);
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void pwui_store_deinit(pwui_store_t *store) {
    if (!store) return;
    for (int i = 0; i < store->count; i++) {
        cJSON_Delete(store->fields[i].value);
    }
    free(store->fields);
    free(store->comps);
    memset(store, 0, sizeof(*store));
}

esp_err_t pwui_store_add_field(pwui_store_t *store, const pwui_field_t *field) {
    if (!store || !field) return ESP_ERR_INVALID_ARG;
    if (store->count >= store->capacity) {
        int new_cap = store->capacity * 2;
        pwui_field_t *new_fields = realloc(store->fields, new_cap * sizeof(pwui_field_t));
        if (!new_fields) return ESP_ERR_NO_MEM;
        store->fields = new_fields;
        store->capacity = new_cap;
    }
    store->fields[store->count] = *field;
    store->fields[store->count].value = NULL;
    store->count++;
    return ESP_OK;
}

pwui_field_t *pwui_store_find(pwui_store_t *store, const char *comp_id, const char *key) {
    if (!store || !comp_id || !key) return NULL;
    for (int i = 0; i < store->count; i++) {
        if (strcmp(store->fields[i].comp_id, comp_id) == 0 &&
            strcmp(store->fields[i].key, key) == 0) {
            return &store->fields[i];
        }
    }
    return NULL;
}

int pwui_store_settings_count(pwui_store_t *store) {
    if (!store) return 0;
    int n = 0;
    for (int i = 0; i < store->count; i++) {
        if (!store->fields[i].is_status) n++;
    }
    return n;
}

int pwui_store_status_count(pwui_store_t *store) {
    if (!store) return 0;
    int n = 0;
    for (int i = 0; i < store->count; i++) {
        if (store->fields[i].is_status) n++;
    }
    return n;
}

pwui_field_t *pwui_store_field_at(pwui_store_t *store, int i) {
    if (!store || i < 0 || i >= store->count) return NULL;
    return &store->fields[i];
}

static bool is_bool_type(pwui_type_t t) {
    return t == PWUI_CHECKBOX || t == PWUI_SWITCH;
}

static bool is_number_type(pwui_type_t t) {
    return t == PWUI_NUMBER || t == PWUI_RANGE;
}

esp_err_t pwui_store_set_value(pwui_store_t *store, const char *comp_id,
                                const char *key, const char *value_str) {
    if (!store || !comp_id || !key) return ESP_ERR_INVALID_ARG;
    pwui_field_t *f = pwui_store_find(store, comp_id, key);
    if (!f) return ESP_ERR_NOT_FOUND;

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
        store->dirty = true;
    }
    return ESP_OK;
}

cJSON *pwui_store_get_value(pwui_store_t *store, const char *comp_id, const char *key) {
    pwui_field_t *f = pwui_store_find(store, comp_id, key);
    if (!f) return NULL;
    return f->value;
}

bool pwui_store_is_dirty(pwui_store_t *store) {
    return store ? store->dirty : false;
}

void pwui_store_set_dirty(pwui_store_t *store, bool d) {
    if (store) store->dirty = d;
}

void pwui_store_clear_dirty(pwui_store_t *store) {
    if (store) store->dirty = false;
}

void pwui_store_lock(pwui_store_t *store) { (void)store; }
void pwui_store_unlock(pwui_store_t *store) { (void)store; }

esp_err_t pwui_store_add_component(pwui_store_t *store, const char *comp_id, const char *label) {
    if (!store || !comp_id || !label) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < store->comp_count; i++) {
        if (strcmp(store->comps[i].comp_id, comp_id) == 0) return ESP_ERR_INVALID_STATE;
    }
    if (store->comp_count >= store->comp_capacity) {
        int new_cap = store->comp_capacity * 2;
        pwui_comp_meta_t *new_comps = realloc(store->comps, new_cap * sizeof(pwui_comp_meta_t));
        if (!new_comps) return ESP_ERR_NO_MEM;
        store->comps = new_comps;
        store->comp_capacity = new_cap;
    }
    store->comps[store->comp_count].comp_id = comp_id;
    store->comps[store->comp_count].label = label;
    store->comp_count++;
    return ESP_OK;
}

const char *pwui_store_get_label(pwui_store_t *store, const char *comp_id) {
    if (!store || !comp_id) return NULL;
    for (int i = 0; i < store->comp_count; i++) {
        if (strcmp(store->comps[i].comp_id, comp_id) == 0) return store->comps[i].label;
    }
    return NULL;
}

esp_err_t pwui_store_populate(pwui_store_t *store, cJSON *data) {
    if (!store || !data) return ESP_ERR_INVALID_ARG;
    if (!cJSON_IsObject(data)) return ESP_ERR_INVALID_ARG;

    cJSON *group = data->child;
    while (group) {
        if (!cJSON_IsObject(group)) { group = group->next; continue; }
        cJSON *field_json = group->child;
        while (field_json) {
            if (!cJSON_IsArray(field_json) || cJSON_GetArraySize(field_json) < 3) {
                field_json = field_json->next; continue;
            }
            cJSON *opts = cJSON_GetArrayItem(field_json, 2);
            cJSON *val = NULL;
            if (cJSON_IsObject(opts)) {
                val = cJSON_GetObjectItem(opts, "value");
            }
            if (val) {
                char *val_str = cJSON_PrintUnformatted(val);
                pwui_store_set_value(store, group->string, field_json->string, val_str);
                free(val_str);
            }
            field_json = field_json->next;
        }
        group = group->next;
    }
    store->dirty = false;
    return ESP_OK;
}
