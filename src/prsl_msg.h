#pragma once
#include "prsl.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Build the outbound prsl_message frame. Caller frees *out.
 * On failure *out is NULL. ESP_ERR_INVALID_ARG for NULL/oversized,
 * ESP_ERR_NO_MEM when the frame cannot be built. */
esp_err_t prsl_msg_build(prsl_msg_level_t level, const char *message, char **out);

#ifdef __cplusplus
}
#endif
