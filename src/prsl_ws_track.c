#include "prsl_ws_track.h"
#include <string.h>

static uint32_t s_ids[PRSL_WS_TRACK_MAX];
static size_t s_count;

void prsl_ws_track_reset(void) {
    s_count = 0;
}

bool prsl_ws_track_add(uint32_t id) {
    for (size_t i = 0; i < s_count; i++) {
        if (s_ids[i] == id) return true;
    }
    if (s_count >= PRSL_WS_TRACK_MAX) return false;
    s_ids[s_count++] = id;
    return true;
}

void prsl_ws_track_remove(uint32_t id) {
    for (size_t i = 0; i < s_count; i++) {
        if (s_ids[i] == id) {
            s_ids[i] = s_ids[--s_count];
            return;
        }
    }
}

size_t prsl_ws_track_snapshot(uint32_t *out, size_t cap) {
    size_t n = s_count < cap ? s_count : cap;
    if (n) memcpy(out, s_ids, n * sizeof s_ids[0]);
    return n;
}
