#pragma once
#include "cJSON.h"
#include "prsl_store.h"

#ifdef __cplusplus
extern "C" {
#endif

cJSON *prsl_json_build_settings(prsl_store_t *store);
cJSON *prsl_json_build_status(prsl_store_t *store);
char *prsl_json_fix_attrs_quotes(const char *attrs_str);

#ifdef __cplusplus
}
#endif
