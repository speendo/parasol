#pragma once
#include <stdbool.h>
#include "esp_err.h"

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

typedef enum {
    PRSL_VAL_STRING,
    PRSL_VAL_NUMBER,
    PRSL_VAL_BOOL,
    PRSL_VAL_NULL
} prsl_val_kind_t;

/** @brief Discriminated value passed to on_set callbacks and prsl_set_val.
 *  kind == PRSL_VAL_NULL means "no value". u.str points into the parsed
 *  message body and is only valid for the duration of the callback call —
 *  copy it (e.g. via prsl_set_val) if you need it beyond that. */
typedef struct {
    prsl_val_kind_t kind;
    union {
        const char *str;   /* PRSL_VAL_STRING */
        double      num;   /* PRSL_VAL_NUMBER */
        bool        b;     /* PRSL_VAL_BOOL */
    } u;
} prsl_val_t;

/** @brief Called once per field at prsl_init time.
 *  @return Persisted value string, or NULL.
 *          For PRSL_CHECKBOX: NULL = indeterminate (third state).
 *          For all other types: NULL = start empty. */
typedef const char *(*prsl_get_cb_t)(void);

/** @brief Called on every value change (blur/change via WS) and on Save.
 *  The callback OWNS persistence: it must accept the value by writing it
 *  back via prsl_set_val (or a prsl_set_* typed setter), may transform it
 *  before writing a different value, or may write nothing to discard it.
 *  Parasol does NOT auto-store when on_set is registered.
 *  @param group_id Group ID, e.g. "wifi".
 *  @param key      Field key, e.g. "ssid".
 *  @param value    Typed value; never NULL. kind == PRSL_VAL_NULL when the
 *                  incoming value is null/absent (cleared/indeterminate).
 *                  The callback pointer is valid only for the duration of
 *                  the call.
 *  @return ESP_OK to accept, anything else to reject (Save aborts). */
typedef esp_err_t (*prsl_set_cb_t)(const char *group_id, const char *key,
                                   const prsl_val_t *value);

/** @brief Save callback. Reads AV via prsl_get(), persists to storage.
 *  @return ESP_OK on success (parasol clears dirty, pushes to clients),
 *          ESP_ERR_* on failure (dirty stays true). */
typedef esp_err_t (*prsl_save_cb_t)(void);

/** @brief Reset callback. Reload saved values into AV via prsl_set_*().
 *  @return ESP_OK on success. May be NULL — if so, Reset button hidden. */
typedef esp_err_t (*prsl_reset_cb_t)(void);

/** @brief Reboot callback. Performs pre-reboot cleanup then calls esp_restart().
 *  @return ESP_OK on success (never reached if esp_restart() is called).
 *          May be NULL — if so, Reboot option hidden. */
typedef esp_err_t (*prsl_reboot_cb_t)(void);

/** @brief Per-field options. All fields are required; pass NULL to opt out.
 *  @var is_status false by default (via designated initializer). true = read-only status field.
 *  @var on_get    NULL = type-dependent (checkbox→indeterminate, else empty).
 *  @var on_set    NULL = auto-accept any value (returns ESP_OK).
 *  @var help      NULL = no help text rendered.
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
 *                 Must NOT start with '_' — the '_' prefix is reserved for
 *                 protocol meta keys (_dirty, _show_reset, _show_reboot);
 *                 registration fails with ESP_ERR_INVALID_ARG.
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

bool prsl_has_reset(void);
bool prsl_has_reboot(void);

/** @brief Initialize prsl with a web server, save callback, and optional reset/reboot callbacks.
 *  @param server   Initialized AsyncWebServer (port 80).
 *  @param on_save  Called on Save after all on_set pass. NULL = no persistence.
 *  @param on_reset Called on Reset. NULL = no Reset button (hidden).
 *  @param on_reboot Called on Reboot. NULL = no Reboot option (hidden).
 *  @return ESP_OK on success.
 *  @warning All groups and fields MUST be registered BEFORE calling this. */
esp_err_t prsl_init(AsyncWebServer *server, prsl_save_cb_t on_save,
                    prsl_reset_cb_t on_reset, prsl_reboot_cb_t on_reboot);

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

/** @brief Store a typed value as-is (the "accept" one-liner for on_set).
 *  Maps kind to cJSON: STRING/NUMBER/BOOL/NULL. Does NOT broadcast; does
 *  NOT set dirty (the callback decides dirty semantics). */
esp_err_t prsl_set_val(const char *path, const prsl_val_t *value);

/** @brief Get a field's current value. Result valid until next prsl_get()
 *         call. Copy immediately if you need to keep or compare across calls. */
const char *prsl_get(const char *path);

/** @brief Strict typed getters. Return ESP_OK and set *out only when the
 *  field exists with a compatible stored type (number for int/float, bool
 *  for bool); ESP_ERR_NOT_FOUND for a missing field OR wrong type. They do
 *  NOT parse strings — a field stored as a string reads back only via
 *  prsl_get. */
esp_err_t prsl_get_int(const char *path, int *out);
esp_err_t prsl_get_float(const char *path, float *out);
esp_err_t prsl_get_bool(const char *path, bool *out);

/* ── Push / broadcast ──────────────────────────────────────── */

esp_err_t prsl_push(void);
esp_err_t prsl_broadcast_status(void);

#ifdef __cplusplus
}
#endif
