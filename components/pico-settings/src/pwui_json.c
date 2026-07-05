#include "pwui_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *pwui_json_fix_attrs_quotes(const char *attrs_str) {
    if (!attrs_str || attrs_str[0] == '\0') return strdup("{}");
    size_t len = strlen(attrs_str);
    char *fixed = malloc(len + 1);
    if (!fixed) return strdup("{}");
    for (size_t i = 0; i < len; i++) {
        fixed[i] = (attrs_str[i] == '\'') ? '"' : attrs_str[i];
    }
    fixed[len] = '\0';
    return fixed;
}

static cJSON *build_group(pwui_store_t *store, bool is_status) {
    cJSON *root = cJSON_CreateObject();

    const char *current_comp_id = NULL;
    cJSON *group_obj = NULL;

    for (int i = 0; i < store->count; i++) {
        pwui_field_t *f = pwui_store_field_at(store, i);
        if (f->is_status != is_status) continue;

        if (!current_comp_id || strcmp(current_comp_id, f->comp_id) != 0) {
            current_comp_id = f->comp_id;
            group_obj = cJSON_CreateObject();
            const char *label = pwui_store_get_label(store, f->comp_id);
            if (label) {
                cJSON_AddStringToObject(group_obj, "label", label);
            }
            cJSON_AddItemToObject(root, f->comp_id, group_obj);
        }

        cJSON *field_arr = cJSON_CreateArray();
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(
            f->type == PWUI_TEXT ? "text" :
            f->type == PWUI_NUMBER ? "number" :
            f->type == PWUI_PASSWORD ? "password" :
            f->type == PWUI_EMAIL ? "email" :
            f->type == PWUI_TEL ? "tel" :
            f->type == PWUI_URL ? "url" :
            f->type == PWUI_COLOR ? "color" :
            f->type == PWUI_SWITCH ? "switch" :
            f->type == PWUI_CHECKBOX ? "checkbox" :
            f->type == PWUI_RANGE ? "range" :
            f->type == PWUI_TEXTAREA ? "textarea" :
            f->type == PWUI_RADIO ? "radio" : "select"
        ));
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(f->label));

        cJSON *opts = cJSON_CreateObject();

        if (f->value) {
            cJSON_AddItemToObject(opts, "value", cJSON_Duplicate(f->value, 1));
        } else {
            cJSON_AddNullToObject(opts, "value");
        }

        if (f->help && f->help[0]) {
            cJSON_AddStringToObject(opts, "help", f->help);
        }

        if (f->option_count > 0) {
            cJSON *options_arr = cJSON_CreateArray();
            for (int j = 0; j < f->option_count; j++) {
                cJSON *pair = cJSON_CreateArray();
                cJSON_AddItemToArray(pair, cJSON_CreateString(f->options[j][0]));
                cJSON_AddItemToArray(pair, cJSON_CreateString(f->options[j][1]));
                cJSON_AddItemToArray(options_arr, pair);
            }
            cJSON_AddItemToObject(opts, "options", options_arr);
        }

        if (f->attrs && f->attrs[0]) {
            char *fixed = pwui_json_fix_attrs_quotes(f->attrs);
            cJSON *attrs_json = cJSON_Parse(fixed);
            if (attrs_json && cJSON_IsObject(attrs_json)) {
                cJSON_AddItemToObject(opts, "attrs", attrs_json);
            } else {
                if (attrs_json) cJSON_Delete(attrs_json);
            }
            free(fixed);
        }

        cJSON_AddItemToArray(field_arr, opts);
        cJSON_AddItemToObject(group_obj, f->key, field_arr);
    }

    return root;
}

cJSON *pwui_json_build_settings(pwui_store_t *store) {
    return build_group(store, false);
}

cJSON *pwui_json_build_status(pwui_store_t *store) {
    return build_group(store, true);
}

int pwui_json_parse_apply(pwui_store_t *store, const char *json_str,
                          char comps[][32], char keys[][32],
                          char values[][256], int max_changes) {
    if (!store || !json_str) return 0;

    cJSON *msg = cJSON_Parse(json_str);
    if (!msg) return 0;

    cJSON *data = cJSON_GetObjectItem(msg, "data");
    if (!data || !cJSON_IsObject(data)) {
        cJSON_Delete(msg);
        return 0;
    }

    int count = 0;
    cJSON *group = data->child;
    while (group && count < max_changes) {
        if (!cJSON_IsObject(group) || group->string[0] == '_') {
            group = group->next; continue;
        }
        cJSON *field = group->child;
        while (field && count < max_changes) {
            if (!cJSON_IsArray(field) || cJSON_GetArraySize(field) < 3) {
                field = field->next; continue;
            }
            cJSON *opts = cJSON_GetArrayItem(field, 2);
            cJSON *val = NULL;
            if (cJSON_IsObject(opts)) {
                val = cJSON_GetObjectItem(opts, "value");
            }
            if (val && pwui_store_find(store, group->string, field->string)) {
                strncpy(comps[count], group->string, 31);
                comps[count][31] = '\0';
                strncpy(keys[count], field->string, 31);
                keys[count][31] = '\0';
                if (cJSON_IsString(val)) {
                    strncpy(values[count], val->valuestring, 255);
                    values[count][255] = '\0';
                } else if (cJSON_IsNumber(val)) {
                    snprintf(values[count], 256, "%g", val->valuedouble);
                } else if (cJSON_IsTrue(val)) {
                    strncpy(values[count], "true", 255);
                } else if (cJSON_IsFalse(val)) {
                    strncpy(values[count], "false", 255);
                } else {
                    values[count][0] = '\0';
                }
                count++;
            }
            field = field->next;
        }
        group = group->next;
    }

    cJSON_Delete(msg);
    return count;
}
