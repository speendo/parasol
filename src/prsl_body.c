#include "prsl_body.h"
#include "prsl_json.h"
#include <string.h>
#include <stdio.h>

int prsl_apply_body(cJSON *body, prsl_store_t *store, prsl_rejection_t *rejection) {
    int count = 0;
    if (rejection) { rejection->group_id = NULL; rejection->key = NULL; }

    cJSON *group = body->child;
    while (group) {
        if (!cJSON_IsObject(group) || group->string[0] == '_') {
            group = group->next; continue;
        }
        cJSON *field = group->child;
        while (field) {
            if (rejection && rejection->group_id) break;
            if (!cJSON_IsArray(field) || cJSON_GetArraySize(field) < 3) {
                field = field->next; continue;
            }
            cJSON *opts = cJSON_GetArrayItem(field, 2);
            cJSON *val = cJSON_GetObjectItem(opts, "value");
            char val_buf[64];
            const char *val_str = prsl_json_value_str(val, val_buf, sizeof(val_buf));

            prsl_field_t *f = prsl_store_find(store, group->string, field->string);
            if (f && f->on_set) {
                esp_err_t ae = f->on_set(group->string, field->string, val_str);
                if (ae != ESP_OK) {
                    if (rejection) {
                        rejection->group_id = group->string;
                        rejection->key = field->string;
                    }
                } else {
                    count++;
                }
            } else if (f) {
                prsl_store_set_json(store, group->string, field->string,
                    val_str ? cJSON_CreateString(val_str) : cJSON_CreateNull());
                count++;
            }
            field = field->next;
        }
        group = group->next;
    }
    return count;
}

prsl_save_status_t prsl_apply_save_body(const char *json, size_t len,
                                        prsl_store_t *store,
                                        char *err, size_t err_sz) {
    cJSON *body = cJSON_ParseWithLength(json, len);
    if (!body) {
        snprintf(err, err_sz, "Invalid JSON");
        return PRSL_SAVE_INVALID_JSON;
    }
    prsl_rejection_t rej;
    prsl_apply_body(body, store, &rej);
    if (rej.group_id) {
        snprintf(err, err_sz, "on_set rejected %s.%s", rej.group_id, rej.key);
        cJSON_Delete(body);
        return PRSL_SAVE_REJECTED;
    }
    cJSON_Delete(body);
    return PRSL_SAVE_APPLIED;
}
