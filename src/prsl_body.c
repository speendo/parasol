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
                char path[PRSL_MAX_PATH];
                snprintf(path, sizeof(path), "%s.%s", group->string, field->string);
                prsl_set_str(path, val_str);
                count++;
            }
            field = field->next;
        }
        group = group->next;
    }
    return count;
}
