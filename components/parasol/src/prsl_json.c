#include "prsl_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const char *prsl_json_value_str(cJSON *val) {
    static char buf[64];
    if (!val) return NULL;
    if (cJSON_IsString(val)) return val->valuestring;
    if (cJSON_IsNumber(val)) { snprintf(buf, sizeof(buf), "%g", cJSON_GetNumberValue(val)); return buf; }
    if (cJSON_IsTrue(val)) return "true";
    if (cJSON_IsFalse(val)) return "false";
    return NULL;
}

char *prsl_json_fix_attrs_quotes(const char *attrs_str) {
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

static cJSON *build_group(prsl_store_t *store, bool is_status) {
    cJSON *root = cJSON_CreateObject();

    const char *current_group_id = NULL;
    cJSON *group_obj = NULL;

    for (int i = 0; i < store->count; i++) {
        prsl_field_t *f = prsl_store_field_at(store, i);
        if (f->is_status != is_status) continue;

        if (!current_group_id || strcmp(current_group_id, f->group_id) != 0) {
            current_group_id = f->group_id;
            group_obj = cJSON_GetObjectItem(root, f->group_id);
            if (!group_obj) {
                group_obj = cJSON_CreateObject();
                const char *label = prsl_store_get_label(store, f->group_id);
                if (label) {
                    cJSON_AddStringToObject(group_obj, "label", label);
                }
                cJSON_AddItemToObject(root, f->group_id, group_obj);
            }
        }

        cJSON *field_arr = cJSON_CreateArray();
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(
            f->type == PRSL_TEXT ? "text" :
            f->type == PRSL_NUMBER ? "number" :
            f->type == PRSL_PASSWORD ? "password" :
            f->type == PRSL_EMAIL ? "email" :
            f->type == PRSL_TEL ? "tel" :
            f->type == PRSL_URL ? "url" :
            f->type == PRSL_COLOR ? "color" :
            f->type == PRSL_SWITCH ? "switch" :
            f->type == PRSL_CHECKBOX ? "checkbox" :
            f->type == PRSL_RANGE ? "range" :
            f->type == PRSL_TEXTAREA ? "textarea" :
            f->type == PRSL_RADIO ? "radio" : "select"
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
            char *fixed = prsl_json_fix_attrs_quotes(f->attrs);
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

cJSON *prsl_json_build_settings(prsl_store_t *store) {
    return build_group(store, false);
}

cJSON *prsl_json_build_status(prsl_store_t *store) {
    return build_group(store, true);
}

int prsl_json_parse_apply(prsl_store_t *store, const char *json_str,
                          char groups[][32], char keys[][32],
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
            if (val && prsl_store_find(store, group->string, field->string)) {
                strncpy(groups[count], group->string, 31);
                groups[count][31] = '\0';
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
