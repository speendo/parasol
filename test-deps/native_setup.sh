#!/usr/bin/env bash
# Fetch cJSON + Unity (single-file libs) for native C tests into test-deps/native/.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_DIR="$SCRIPT_DIR/native"
mkdir -p "$NATIVE_DIR"
[ -f "$NATIVE_DIR/cJSON.c" ] || curl -fsSL -o "$NATIVE_DIR/cJSON.c" https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.c
[ -f "$NATIVE_DIR/cJSON.h" ] || curl -fsSL -o "$NATIVE_DIR/cJSON.h" https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.h
[ -f "$NATIVE_DIR/unity.c" ] || curl -fsSL -o "$NATIVE_DIR/unity.c" https://raw.githubusercontent.com/ThrowTheSwitch/Unity/v2.6.0/src/unity.c
[ -f "$NATIVE_DIR/unity.h" ] || curl -fsSL -o "$NATIVE_DIR/unity.h" https://raw.githubusercontent.com/ThrowTheSwitch/Unity/v2.6.0/src/unity.h
[ -f "$NATIVE_DIR/unity_internals.h" ] || curl -fsSL -o "$NATIVE_DIR/unity_internals.h" https://raw.githubusercontent.com/ThrowTheSwitch/Unity/v2.6.0/src/unity_internals.h
echo "native deps ready in $NATIVE_DIR"