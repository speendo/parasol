#include "prsl_ws_handle.h"
#include "prsl_body.h"
#include "prsl_json.h"
#include <stdio.h>
#include <string.h>

static char *print_and_delete(cJSON *item) {
    char *s = cJSON_PrintUnformatted(item);
    cJSON_Delete(item);
    return s;
}

/* Ack "d": flat "group.key" -> value the store holds after the apply. Walks
 * the same shape prsl_apply_body() walked, so unknown keys are omitted and
 * file fields (skipped by the apply) still report their stored value. */
static void add_applied_values(cJSON *d, cJSON *body, prsl_store_t *store) {
    cJSON *group = body->child;
    while (group) {
        if (!cJSON_IsObject(group) || group->string[0] == '_') {
            group = group->next; continue;
        }
        cJSON *field = group->child;
        while (field) {
            if (!cJSON_IsArray(field) || cJSON_GetArraySize(field) < 3) {
                field = field->next; continue;
            }
            prsl_field_t *f = prsl_store_find(store, group->string, field->string);
            if (f) {
                char flat[PRSL_MAX_PATH * 2 + 2];
                snprintf(flat, sizeof(flat), "%s.%s", group->string, field->string);
                if (f->value) {
                    cJSON_AddItemToObject(d, flat, cJSON_Duplicate(f->value, 1));
                } else {
                    cJSON_AddNullToObject(d, flat);
                }
            }
            field = field->next;
        }
        group = group->next;
    }
}

int prsl_ws_handle(const char *json, size_t len, prsl_store_t *store,
                   prsl_ws_reply_t *out) {
    out->to_sender = NULL;
    out->to_all = NULL;
    out->error = NULL;

    cJSON *msg = cJSON_ParseWithLength(json, len);
    if (!msg) {
        out->error = strdup("{\"type\":\"error\",\"message\":\"Invalid JSON\"}");
        return -1;
    }

    cJSON *action = cJSON_GetObjectItem(msg, "action");
    if (!action || !cJSON_IsString(action)) {
        cJSON_Delete(msg);
        return 0;
    }

    cJSON *id = cJSON_GetObjectItem(msg, "i");

    /* Sync: reply to the requester only; no store mutation, no broadcast. */
    if (strcmp(action->valuestring, "sync") == 0) {
        if (!cJSON_IsNumber(id)) {
            out->error = strdup("{\"type\":\"error\",\"message\":\"Missing sync id\"}");
            cJSON_Delete(msg);
            return 0;
        }
        cJSON *root = prsl_build_settings_payload(store);
        cJSON_AddItemToObject(root, "i", cJSON_Duplicate(id, 1));
        out->to_sender = print_and_delete(root);
        cJSON_Delete(msg);
        return 0;
    }

    if (strcmp(action->valuestring, "apply") != 0) {
        cJSON_Delete(msg);
        return 0;
    }

    if (!cJSON_IsNumber(id)) {
        out->error = strdup("{\"type\":\"error\",\"message\":\"Missing apply id\"}");
        cJSON_Delete(msg);
        return 0;
    }

    cJSON *body = cJSON_GetObjectItem(msg, "data");
    bool invalid_data = !cJSON_IsObject(body);

    cJSON *ack = cJSON_CreateObject();
    cJSON_AddStringToObject(ack, "type", "ack");
    cJSON_AddItemToObject(ack, "i", cJSON_Duplicate(id, 1));
    cJSON *d = cJSON_CreateObject();
    cJSON_AddItemToObject(ack, "d", d);

    int applied = 0;
    if (!invalid_data) {
        prsl_rejection_t rej;
        applied = prsl_apply_body(body, store, &rej);

        add_applied_values(d, body, store);

        if (rej.group_id) {
            cJSON *e = cJSON_CreateObject();
            char flat[PRSL_MAX_PATH * 2 + 2];
            snprintf(flat, sizeof(flat), "%s.%s", rej.group_id, rej.key);
            cJSON_AddStringToObject(e, flat, "rejected");
            cJSON_AddItemToObject(ack, "e", e);
        }
    }

    out->to_sender = print_and_delete(ack);

    if (invalid_data) {
        out->error = strdup("{\"type\":\"error\",\"message\":\"Invalid data\"}");
    } else if (applied > 0) {
        out->to_all = print_and_delete(prsl_build_settings_payload(store));
    }

    cJSON_Delete(msg);
    return 0;
}
