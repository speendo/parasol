#pragma once
#include "prsl_store.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Describes a rejected field. Pointers into body's cJSON strings. */
typedef struct {
    const char *group_id;  /* NULL if no rejection */
    const char *key;
} prsl_rejection_t;

/**
 * @brief Apply a JSON settings body to the store.
 *
 * Iterates body's groups and fields in order. For each field:
 *   - Calls on_set if registered (passing val_str).
 *   - Falls back to a direct store write if no on_set.
 * Aborts on first on_set rejection — remaining fields skipped.
 *
 * @param body       cJSON object (the "data" key from a settings message).
 * @param store      The settings store.
 * @param rejection  If non-NULL, populated with the first rejected field.
 *                   Caller checks rejection->group_id != NULL.
 * @return Number of fields successfully applied.
 */
int prsl_apply_body(cJSON *body, prsl_store_t *store, prsl_rejection_t *rejection);

typedef enum {
    PRSL_SAVE_APPLIED = 1,
    PRSL_SAVE_INVALID_JSON = 0,
    PRSL_SAVE_REJECTED = -1
} prsl_save_status_t;

/** @brief Parse + apply a raw save body (no "data" wrapper). Single code path
 *  shared by the HTTP handler and host tests.
 *  @param json  NUL-terminated full body.
 *  @param len   Length of the body (parse limited to this).
 *  @param err   Out buffer for "Invalid JSON" / "on_set rejected X.Y".
 *  @return PRSL_SAVE_APPLIED, PRSL_SAVE_INVALID_JSON, or PRSL_SAVE_REJECTED. */
prsl_save_status_t prsl_apply_save_body(const char *json, size_t len,
                                        prsl_store_t *store,
                                        char *err, size_t err_sz);

#ifdef __cplusplus
}
#endif
