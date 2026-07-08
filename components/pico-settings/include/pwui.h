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

/** @brief Called once per field at pwui_init time.
 *  @return Persisted value string, or NULL.
 *          For PWUI_CHECKBOX: NULL = indeterminate (third state).
 *          For all other types: NULL = start empty. */
typedef const char *(*pwui_load_cb_t)(void);

/** @brief Called on every value change (blur/change) and on Save.
 *  @param comp_id Component ID, e.g. "wifi".
 *  @param key     Field key, e.g. "ssid".
 *  @param value   New value string, or NULL if cleared/indeterminate.
 *  @return ESP_OK to accept, anything else to reject (Save aborts). */
typedef esp_err_t (*pwui_apply_cb_t)(const char *comp_id, const char *key, const char *value);

/** @brief Called once per Save, after all on_apply callbacks have returned ESP_OK.
 *  @param pairs  Array of [path, value] pairs. pairs[i][0] = "comp_id.key", pairs[i][1] = "value".
 *  @param count  Number of pairs.
 *  Use for single-cycle NVS persistence (one open/write/commit). */
typedef void (*pwui_commit_cb_t)(const char *pairs[][2], int count);

/** @brief Per-field options. All fields are required; pass NULL to opt out.
 *  @var on_load  NULL = type-dependent (checkbox→indeterminate, else empty).
 *                  For status fields: always NULL (runtime loop provides values).
 *  @var on_apply NULL = auto-accept any value (returns ESP_OK).
 *                  For status fields: always NULL (fields are read-only in browser).
 *  @var help     NULL = no tooltip rendered.
 *  @var attrs    NULL = no HTML validation attributes. */
typedef struct {
    pwui_load_cb_t  on_load;
    pwui_apply_cb_t on_apply;
    const char     *help;
    const char     *attrs;
} pwui_field_opts_t;

/* ── Lifecycle ──────────────────────────────────────────────── */

/** @brief Initialize pwui with a web server and commit callback.
 *  @param server     Initialized AsyncWebServer (port 80).
 *  @param on_commit  Called on Save after all on_apply pass. NULL = no persistence.
 *  @return ESP_OK on success.
 *  @warning All components and fields MUST be registered BEFORE calling this. */
esp_err_t pwui_init(AsyncWebServer *server, pwui_commit_cb_t on_commit);

/** @brief Start the async web server. */
esp_err_t pwui_start(void);

/** @brief Re-load all persisted values from on_load callbacks and push to browser.
 *  Resets applied values to stored values, discarding unsaved changes. */
esp_err_t pwui_reset(void);

/* ── Component registration ─────────────────────────────────── */

esp_err_t pwui_begin_component(const char *id, const char *label, bool is_status);
esp_err_t pwui_end_component(const char *id);

/* ── Field registration ─────────────────────────────────────── */

/** @brief Register a field. opts may be NULL for no callbacks/help/attrs. */
esp_err_t pwui_add_field(pwui_type_t type, const char *comp_id, const char *key,
                         const char *label, const pwui_field_opts_t *opts);

/** @brief Register a select or radio field with options. */
esp_err_t pwui_add_field_opts(pwui_type_t type, const char *comp_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              const pwui_field_opts_t *opts);

/* ── Runtime value access ───────────────────────────────────── */

esp_err_t pwui_set(const char *path, const char *value);
const char *pwui_get(const char *path);

/* ── Push / broadcast ───────────────────────────────────────── */

esp_err_t pwui_push(void);
esp_err_t pwui_broadcast_status(void);

#ifdef __cplusplus
}
#endif
