#!/usr/bin/env bash
# Verify include/prsl.h compiles standalone as C and C++ (audit Issues 2/3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cons.c" <<'EOF'
#include "prsl.h"
int main(void) { return 0; }
EOF
cp "$TMP/cons.c" "$TMP/cons.cpp"
# Minimal esp_err.h + cJSON.h stubs (no sdkconfig / cJSON source dependency)
mkdir -p "$TMP/stub"
cat > "$TMP/stub/esp_err.h" <<'EOF'
#pragma once
#include <stdint.h>
typedef int32_t esp_err_t;
#define ESP_OK 0
#define ESP_ERR_INVALID_ARG (-1)
#define ESP_ERR_INVALID_STATE (-2)
#define ESP_ERR_NO_MEM (-3)
#define ESP_ERR_NOT_FOUND (-4)
#define ESP_FAIL (-5)
EOF
cat > "$TMP/stub/cJSON.h" <<'EOF'
#pragma once
typedef struct cJSON cJSON;
EOF
echo "== C ==";  gcc  -std=gnu11   -I"$TMP/stub" -I"$ROOT/include" -c "$TMP/cons.c"   -o "$TMP/cons_c.o"
echo "== C++ =="; g++ -std=gnu++17 -I"$TMP/stub" -I"$ROOT/include" -c "$TMP/cons.cpp" -o "$TMP/cons_cpp.o"
echo "OK: prsl.h compiles standalone in C and C++"