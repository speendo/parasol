#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Fixed-size id tracking for the WebSocket clients. The server's client list
 * can erase an element from inside close(), so closing must walk a snapshot,
 * never the live list. This module is intentionally lock-free; the caller
 * serializes access. */
#define PRSL_WS_TRACK_MAX 16

#ifdef __cplusplus
extern "C" {
#endif

void prsl_ws_track_reset(void);
bool prsl_ws_track_add(uint32_t id);
void prsl_ws_track_remove(uint32_t id);
size_t prsl_ws_track_snapshot(uint32_t *out, size_t cap);

#ifdef __cplusplus
}
#endif
