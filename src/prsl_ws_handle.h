#pragma once
#include <stddef.h>
#include "prsl_store.h"

typedef struct {
    char *to_sender;  /* ack or sync reply for the requester; NULL = none */
    char *to_all;     /* settings broadcast; NULL = none */
    char *error;      /* uncorrelated error payload; NULL = none */
} prsl_ws_reply_t;

#ifdef __cplusplus
extern "C" {
#endif
/* Handle one WS text frame. Always initializes all three reply pointers
 * (caller may pass a zeroed struct; it is overwritten). Returns 0 when the
 * frame was handled, -1 when the JSON could not be parsed. The caller owns
 * and must free() every non-NULL pointer with free(). */
int prsl_ws_handle(const char *json, size_t len, prsl_store_t *store,
                   prsl_ws_reply_t *out);
#ifdef __cplusplus
}
#endif
