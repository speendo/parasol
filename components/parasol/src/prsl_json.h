#pragma once
#include "cJSON.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

cJSON *prsl_json_build_settings(prsl_store_t *store);
cJSON *prsl_json_build_status(prsl_store_t *store);
int prsl_json_parse_apply(prsl_store_t *store, const char *json_str,
                          char groups[][32], char keys[][32],
                          char values[][256], int max_changes);
/** @brief Extract a const char* from a cJSON value node.
 *  Returns val->valuestring for strings, formatted buffer for numbers,
 *  "true"/"false" for booleans, NULL for null/missing.
 *  Warning: returned pointer is invalidated by the next call. */
const char *prsl_json_value_str(cJSON *val);
char *prsl_json_fix_attrs_quotes(const char *attrs_str);

#ifdef __cplusplus
}
#endif
