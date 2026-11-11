#pragma once
#include <stdbool.h>
#include <stddef.h>
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
    PRSL_RANGE, PRSL_TEXTAREA, PRSL_RADIO, PRSL_SELECT,
    PRSL_FILE
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

/* ── File upload ───────────────────────────────────────────── */

/** @brief Upload stream event. */
typedef enum {
    PRSL_UPLOAD_META,   /* metadata only, exactly once, before any CHUNK */
    PRSL_UPLOAD_CHUNK,  /* data bytes; zero or more */
    PRSL_UPLOAD_END,    /* body complete; commit here; exactly once */
    PRSL_UPLOAD_ABORT   /* client gone / idle timeout / prsl_stop; cleanup */
} prsl_upload_event_t;

/** @brief One on_upload callback invocation.
 *  @var name    Basename of the uploaded file; never NULL.
 *  @var mime    Declared Content-Type, or NULL when absent.
 *  @var size    Declared Content-Length.
 *  @var offset  Byte offset of data (CHUNK only).
 *  @var data    CHUNK only. Valid ONLY during this call — write or copy it
 *               synchronously.
 *  @var len     CHUNK length; 0 for other events.
 *  @var err     Callback writes an error message here.
 *  @var err_len Size of err, including NUL.
 *  @var status  HTTP status hint on rejection; 0 = library default
 *               (400 for META/CHUNK, 500 for END). Clamped to 400–599.
 *
 *  META is metadata only and is not a chunk: the first data callback is a
 *  separate CHUNK. name/size/mime are valid on every event.
 *
 *  Returning anything other than ESP_OK from META/CHUNK/END rejects the
 *  upload; write a reason to err or the library supplies a generic one.
 *  On ABORT the return value and status are ignored.
 *
 *  ABORT is guaranteed exactly once for every upload that reached META,
 *  unless END returned ESP_OK — including a META/CHUNK rejection, an END
 *  error, a transport drop, an idle timeout, and prsl_stop() during the
 *  upload. It never fires after a successful END and never twice. ABORT is
 *  the only cleanup signal: close/delete temp files and free resources there.
 */
typedef struct {
    prsl_upload_event_t event;
    const char *group_id;   /* registered group, e.g. "audio" */
    const char *key;        /* registered key, e.g. "clip" */
    const char *name;       /* basename of the uploaded file; never NULL */
    const char *mime;       /* declared Content-Type, or NULL */
    size_t size;            /* declared Content-Length */
    size_t offset;          /* byte offset of data (CHUNK only) */
    const uint8_t *data;    /* CHUNK only; valid only during this call */
    size_t len;             /* CHUNK length; 0 for other events */
    char *err;              /* callback writes an error message here */
    size_t err_len;         /* size of err, including NUL */
    int status;             /* HTTP status hint on rejection; 0 = default */
} prsl_upload_t;

/** @brief Called for each upload event of a file field.
 *  Runs in the AsyncTCP task: return promptly and do NOT block (a blocking
 *  callback also blocks prsl_stop()/teardown).
 *  @return ESP_OK to accept, anything else to reject (ignored on ABORT). */
typedef esp_err_t (*prsl_upload_cb_t)(prsl_upload_t *u);

/** @brief Per-file-field options.
 *  @var on_get  Current file label, or NULL. Loaded at init and on reset,
 *               like any other field value.
 *  @var on_upload Required. Runs in the AsyncTCP task; see prsl_upload_cb_t.
 *  @var accept  Optional HTML accept list, e.g. ".bin,application/octet-stream".
 *               A UX/policy filter backed by declared metadata, NOT a security
 *               boundary — content checks belong in on_upload.
 *  @var max_size Device limit; 0 = no limit. Empty files are always rejected.
 *  @var idle_timeout_ms Device inactivity timeout; 0 = default (30000 ms).
 *  @var help   NULL = no help text rendered.
 *  @var attrs  Optional extra HTML attributes JSON. Presentation-only. */
typedef struct {
    prsl_get_cb_t    on_get;
    prsl_upload_cb_t on_upload;
    const char      *accept;
    size_t           max_size;
    uint32_t         idle_timeout_ms;
    const char      *help;
    const char      *attrs;
} prsl_file_opts_t;

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

/** @brief Register a file field. This is the ONLY registration path for
 *  PRSL_FILE; prsl_add_field(PRSL_FILE, ...) returns ESP_ERR_INVALID_ARG.
 *  @param opts Required; opts->on_upload is required. */
esp_err_t prsl_add_file_field(const char *group_id, const char *key,
                              const char *label, const prsl_file_opts_t *opts);

/** @brief True while a file upload is in progress (any file field). */
bool prsl_is_uploading(void);

/* ── Dirty ─────────────────────────────────────────────────── */

/** @brief Developer-driven dirty flag. Set true when AV diverges
 *  from saved values. Parasol clears it after successful on_save.
 *  @warning If firmware never sets it, the Save button never appears
 *  and nothing persists — silently. Call it inside on_set (or wherever
 *  external state changes) after a value is applied. */
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

/** @brief Tear down the library (symmetric with prsl_start/prsl_init).
 *  Closes WebSocket clients, removes the WS handler, stops the server
 *  (server->end()), frees the store and resets globals. Afterwards a fresh
 *  prsl_add_group -> prsl_init -> prsl_start cycle can run again.
 *  @note The AsyncWebServer object is owned by the caller and is not freed;
 *  to re-init on the SAME server object, call server->reset() first to avoid
 *  duplicate route handlers.
 *  @return ESP_ERR_INVALID_STATE if not initialized. */
esp_err_t prsl_stop(void);

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

/** @brief Get a field's current value as a string. Returns NULL for
 *  non-string fields (numbers/bools/null) — use prsl_get_int/float/bool.
 *  Result valid until next prsl_get() call. Copy immediately if you need
 *  to keep or compare across calls. */
const char *prsl_get(const char *path);

/** @brief Strict typed getters. Return ESP_OK and set *out only when the
 *  field exists with a compatible stored type (number for int/float, bool
 *  for bool); ESP_ERR_NOT_FOUND for a missing field, wrong type, or (for
 *  prsl_get_int) a number out of int range. They do NOT parse strings — a
 *  field stored as a string reads back only via prsl_get. */
esp_err_t prsl_get_int(const char *path, int *out);
esp_err_t prsl_get_float(const char *path, float *out);
esp_err_t prsl_get_bool(const char *path, bool *out);

/* ── Push / broadcast ──────────────────────────────────────── */

esp_err_t prsl_push(void);
esp_err_t prsl_broadcast_status(void);

#ifdef __cplusplus
}
#endif
