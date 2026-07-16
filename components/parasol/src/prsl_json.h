#pragma once
#include "cJSON.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

cJSON *prsl_json_build_settings(prsl_store_t *store);
cJSON *prsl_json_build_status(prsl_store_t *store);
/** @brief Extract a const char* from a cJSON value node.
 *  Returns val->valuestring for strings, formatted buffer for numbers,
 *  "true"/"false" for booleans, NULL for null/missing.
 *  @param buf  Caller-owned buffer used to format number values
 *  @param buf_size  Size of buf */
const char *prsl_json_value_str(cJSON *val, char *buf, size_t buf_size);
char *prsl_json_fix_attrs_quotes(const char *attrs_str);

#ifdef __cplusplus
}
#endif
