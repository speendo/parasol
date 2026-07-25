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
 *   - Falls back to prsl_set_str if no on_set.
 * Aborts on first on_set rejection — remaining fields skipped.
 *
 * @param body       cJSON object (the "data" key from a settings message).
 * @param store      The settings store.
 * @param rejection  If non-NULL, populated with the first rejected field.
 *                   Caller checks rejection->group_id != NULL.
 * @return Number of fields successfully applied.
 */
int prsl_apply_body(cJSON *body, prsl_store_t *store, prsl_rejection_t *rejection);

#ifdef __cplusplus
}
#endif
