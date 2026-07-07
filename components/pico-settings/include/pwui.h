#pragma once
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
class AsyncWebServer;
#else
typedef struct AsyncWebServer AsyncWebServer;
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ── Types ─────────────────────────────────────────────────── */

typedef enum {
    PWUI_TEXT, PWUI_NUMBER, PWUI_PASSWORD, PWUI_EMAIL, PWUI_TEL,
    PWUI_URL, PWUI_COLOR, PWUI_SWITCH, PWUI_CHECKBOX,
    PWUI_RANGE, PWUI_TEXTAREA, PWUI_RADIO, PWUI_SELECT
} pwui_type_t;

typedef void (*pwui_apply_cb_t)(const char *comp_id, const char *key, const char *value);
typedef esp_err_t (*pwui_storage_cb_t)(cJSON *data);

typedef struct {
    pwui_storage_cb_t on_load;
    pwui_storage_cb_t on_save;
    pwui_storage_cb_t on_reset;
} pwui_storage_t;

/* ── Varargs sentinels ──────────────────────────────────────── */

#define PWUI_END     ((const void*)0)
#define PWUI_VALUE   ((const void*)1)
#define PWUI_HELP    ((const void*)2)
#define PWUI_APPLY   ((const void*)3)
#define PWUI_ATTRS   ((const void*)4)
#define PWUI_NULL    ((const void*)5)  /* creates null value — use standalone (not with PWUI_VALUE) */

/* ── Lifecycle ──────────────────────────────────────────────── */

esp_err_t pwui_init(AsyncWebServer *server, const pwui_storage_t *storage);
esp_err_t pwui_start(void);

/* ── Component registration ─────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status);
esp_err_t pwui_end_component(const char *id);

/* ── Field registration ─────────────────────────────────────── */

esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, ...);

esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              ...);

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value);
const char *pwui_get(const char *path);

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void);
esp_err_t pwui_broadcast_status(void);

#ifdef __cplusplus
}
#endif
