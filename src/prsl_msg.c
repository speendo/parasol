#include "prsl_msg.h"
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"

static const char *msg_level_name(prsl_msg_level_t level) {
    switch (level) {
        case PRSL_MSG_WARNING: return "warning";
        case PRSL_MSG_ERROR:   return "error";
        default:               return "info";
    }
}

esp_err_t prsl_msg_build(prsl_msg_level_t level, const char *message, char **out) {
    *out = NULL;
    if (!message) return ESP_ERR_INVALID_ARG;
    if (strlen(message) > PRSL_MSG_MAX) return ESP_ERR_INVALID_ARG;

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;
    if (!cJSON_AddStringToObject(root, "type", "message")
        || !cJSON_AddStringToObject(root, "level", msg_level_name(level))
        || !cJSON_AddStringToObject(root, "message", message)) {
        cJSON_Delete(root);
        return ESP_ERR_NO_MEM;
    }
    char *str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!str) return ESP_ERR_NO_MEM;

    *out = str;
    return ESP_OK;
}
