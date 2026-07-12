#pragma once
#include "cJSON.h"
#include "pwui_store.h"

#ifdef __cplusplus
extern "C" {
#endif

cJSON *pwui_json_build_settings(pwui_store_t *store);
cJSON *pwui_json_build_status(pwui_store_t *store);
int pwui_json_parse_apply(pwui_store_t *store, const char *json_str,
                          char comps[][32], char keys[][32],
                          char values[][256], int max_changes);
char *pwui_json_fix_attrs_quotes(const char *attrs_str);

#ifdef __cplusplus
}
#endif
