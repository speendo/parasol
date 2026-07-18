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
    PRSL_TEXT, PRSL_NUMBER, PRSL_PASSWORD, PRSL_EMAIL, PRSL_TEL,
    PRSL_URL, PRSL_COLOR, PRSL_SWITCH, PRSL_CHECKBOX,
    PRSL_RANGE, PRSL_TEXTAREA, PRSL_RADIO, PRSL_SELECT
} prsl_type_t;

/** @brief Called once per field at prsl_init time.
 *  @return Persisted value string, or NULL.
 *          For PRSL_CHECKBOX: NULL = indeterminate (third state).
 *          For all other types: NULL = start empty. */
typedef const char *(*prsl_get_cb_t)(void);

/** @brief Called on every value change (blur/change) and on Save.
 *  @param group_id Group ID, e.g. "wifi".
 *  @param key      Field key, e.g. "ssid".
 *  @param value    New value string, or NULL if cleared/indeterminate.
 *  @return ESP_OK to accept, anything else to reject (Save aborts). */
typedef esp_err_t (*prsl_set_cb_t)(const char *group_id, const char *key,
                                    const char *value);

/** @brief A single path/value pair passed to the save callback.
 *  @var path   "group_id.key" — heap-allocated, caller must free after callback.
 *  @var value  String representation of the field's value. For all field types
 *              (text, number, checkbox, switch, range, select, radio, etc.),
 *              the save callback always receives a string. Checkbox/switch values
 *              are "true"/"false", numbers are stringified (e.g., "6", "2.5"),
 *              text fields are the raw text. Developers are responsible for
 *              converting back to their expected type (atoi, strcmp, etc.). */
typedef struct {
    const char *path;
    const char *value;
} prsl_save_pair_t;

/** @brief Called once per batch after on_set callbacks return ESP_OK.
 *  May be called multiple times per HTTP save request if the store has more
 *  fields than PRSL_SAVE_MAX_FIELDS (see parasol_config.json).
 *  @param pairs  Array of prsl_save_pair_t structures. Every pair.value is a
 *                string (including for boolean and numeric field types).
 *  @param count  Number of pairs in this batch.
 *  Use for single-cycle NVS persistence (one open/write/commit per batch). */
typedef void (*prsl_save_cb_t)(const prsl_save_pair_t *pairs, int count);

/** @brief Per-field options. All fields are required; pass NULL to opt out.
 *  @var is_status false by default (via designated initializer). true = read-only status field.
 *  @var on_get    NULL = type-dependent (checkbox→indeterminate, else empty).
 *  @var on_set    NULL = auto-accept any value (returns ESP_OK).
 *  @var help      NULL = no tooltip rendered.
 *  @var attrs     NULL = no HTML validation attributes. */
typedef struct {
    bool           is_status;
    prsl_get_cb_t  on_get;
    prsl_set_cb_t  on_set;
    const char    *help;
    const char    *attrs;
} prsl_field_opts_t;

/* ── Group registration ────────────────────────────────────── */

/** @brief Register a group before adding fields to it.
 *  @param group_id Must be unique. Controls JSON key and DOM prefix.
 *  @param label    NULL = auto-derived from group_id (camelCase/snake_case
 *                  splitting, title-cased). Non-NULL overrides. */
esp_err_t prsl_add_group(const char *group_id, const char *label);

/* ── Field registration ────────────────────────────────────── */

/** @brief Register a field. opts may be NULL for no callbacks/help/attrs. */
esp_err_t prsl_add_field(prsl_type_t type, const char *group_id, const char *key,
                         const char *label, const prsl_field_opts_t *opts);

/** @brief Register a select or radio field with options. */
esp_err_t prsl_add_field_opts(prsl_type_t type, const char *group_id, const char *key,
                              const char *label,
                              const char *options[][2], int option_count,
                              const prsl_field_opts_t *opts);

/* ── Dirty ─────────────────────────────────────────────────── */

/** @brief Developer-driven dirty flag. Set true when AV diverges
 *  from saved values. Parasol clears it after successful on_save. */
void prsl_set_dirty(bool dirty);

/** @brief Query whether any unsaved changes exist. */
bool prsl_is_dirty(void);

/* ── Lifecycle ──────────────────────────────────────────────── */

/** @brief Initialize prsl with a web server and save callback.
 *  @param server   Initialized AsyncWebServer (port 80).
 *  @param on_save  Called on Save after all on_set pass. NULL = no persistence.
 *  @return ESP_OK on success.
 *  @warning All groups and fields MUST be registered BEFORE calling this. */
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save);

/** @brief Start the async web server. */
esp_err_t prsl_start(void);

/** @brief Re-load all persisted values from on_get callbacks and push to browser.
 *  Resets applied values to stored values, discarding unsaved changes. */
esp_err_t prsl_reset(void);

/* ── Runtime value access ──────────────────────────────────── */

/** @brief Typed setters for compile-time safety. Each maps to cJSON type.
 *  Does NOT broadcast. Call prsl_push() or prsl_broadcast_status() after. */
esp_err_t prsl_set_str(const char *path, const char *value);
esp_err_t prsl_set_int(const char *path, int value);
esp_err_t prsl_set_float(const char *path, float value);
esp_err_t prsl_set_bool(const char *path, bool value);
esp_err_t prsl_set_null(const char *path);

const char *prsl_get(const char *path);

/* ── Push / broadcast ──────────────────────────────────────── */

esp_err_t prsl_push(void);
esp_err_t prsl_broadcast_status(void);

#ifdef __cplusplus
}
#endif
