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

            prsl_val_t v;
            if (val && cJSON_IsString(val)) {
                v.kind = PRSL_VAL_STRING; v.u.str = val->valuestring;
            } else if (val && cJSON_IsNumber(val)) {
                v.kind = PRSL_VAL_NUMBER; v.u.num = cJSON_GetNumberValue(val);
            } else if (val && cJSON_IsBool(val)) {
                v.kind = PRSL_VAL_BOOL; v.u.b = cJSON_IsTrue(val) ? true : false;
            } else {
                v.kind = PRSL_VAL_NULL;
            }

            prsl_field_t *f = prsl_store_find(store, group->string, field->string);
            if (f && f->type == PRSL_FILE) {
                /* File values only change through the upload path. Skip
                 * before on_set and the direct-store fallback so a settings
                 * body can never overwrite a file label. */
                field = field->next; continue;
            }
            if (f && f->on_set) {
                esp_err_t ae = f->on_set(group->string, field->string, &v);
                if (ae != ESP_OK) {
                    if (rejection) {
                        rejection->group_id = group->string;
                        rejection->key = field->string;
                    }
                } else {
                    count++;
                }
            } else if (f) {
                /* Callback absent: store the native typed value. Duplicate is
                 * owned by prsl_store_set_json (which frees on error) — the
                 * caller's body node must NOT be freed here. */
                if (prsl_store_set_json(store, group->string, field->string,
                        val ? cJSON_Duplicate(val, 1) : NULL) == ESP_OK) {
                    count++;
                }
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
