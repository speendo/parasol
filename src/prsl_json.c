#include "prsl_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
            f->type == PRSL_RADIO ? "radio" :
            f->type == PRSL_FILE ? "file" : "select"
        ));
        cJSON_AddItemToArray(field_arr, cJSON_CreateString(f->label));

        cJSON *opts = cJSON_CreateObject();

        if (f->value) {
            cJSON_AddItemToObject(opts, "value", cJSON_Duplicate(f->value, 1));
        } else {
            cJSON_AddNullToObject(opts, "value");
        }

        if (f->type == PRSL_FILE) {
            if (f->accept && f->accept[0]) {
                cJSON_AddStringToObject(opts, "accept", f->accept);
            }
            if (f->max_size != 0) {
                cJSON_AddNumberToObject(opts, "max_size", (double)f->max_size);
            }
            /* idle_timeout_ms is device policy, never sent to clients. */
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

        if (f->parsed_attrs) {
            cJSON_AddItemToObject(opts, "attrs", cJSON_Duplicate(f->parsed_attrs, 1));
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

cJSON *prsl_json_build_settings_payload(prsl_store_t *store, bool dirty,
                                        bool show_reset, bool show_reboot,
                                        bool uploading) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "settings");

    cJSON *meta = cJSON_AddObjectToObject(root, "_meta");
    cJSON_AddBoolToObject(meta, "dirty", dirty);
    cJSON_AddBoolToObject(meta, "show_reset", show_reset);
    cJSON_AddBoolToObject(meta, "show_reboot", show_reboot);
    cJSON_AddBoolToObject(meta, "uploading", uploading);

    cJSON_AddItemToObject(root, "data", prsl_json_build_settings(store));
    return root;
}


