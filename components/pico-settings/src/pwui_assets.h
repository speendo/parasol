#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *path;
    const char *mime;
    const uint8_t *data;
    size_t len;
} pwui_asset_t;

extern const pwui_asset_t pwui_assets[];
extern const size_t pwui_assets_count;
