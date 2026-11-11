#!/usr/bin/env bash
# Build and run native C unit tests (store + json + body). Requires test-deps/native deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
bash test-deps/native_setup.sh
DEPS="$ROOT/test-deps/native"
COMMON=( "$ROOT/src/prsl_store.c" "$ROOT/src/prsl_json.c" "$ROOT/src/prsl_upload.c" "$DEPS/cJSON.c" "$DEPS/unity.c" )
# -Wno-unused-function: recovered test_prsl_store.c defines an unused static
# helper (get_persisted_val2) — kept verbatim per plan; suppress the class.
# -DUNITY_INCLUDE_DOUBLE: type-preservation tests compare doubles exactly.
FLAGS=( -DHOST_TEST -DUNITY_INCLUDE_DOUBLE -Wall -Wno-unused-function -I"$ROOT/tests/native/stub" -I"$ROOT/include" -I"$ROOT/src" -I"$DEPS" )
for t in store json body save_body upload; do
  TF="$ROOT/tests/native/test_prsl_$t.c"
  [ "$t" = save_body ] && TF="$ROOT/tests/native/test_save_body.c"
  gcc "${FLAGS[@]}" "${COMMON[@]}" \
    "$ROOT/src/prsl_body.c" \
    "$TF" -o "/tmp/prsl_native_$t"
  echo "== $t =="; "/tmp/prsl_native_$t"
done

cat > "$ROOT/tests/native/check_store_api.cpp" <<'EOF'
#include "prsl.h"
#include "prsl_store.h"
#include "cJSON.h"
// Mirrors prsl.cpp: prsl_build_settings_payload(store) must be visible via
// prsl_store.h (moved out of the public header per Decision 6) and accept a
// non-const store.
int main(void) {
    prsl_store_t store = {0};
    prsl_field_t f = {0};
    f.group_id = "g"; f.key = "k"; f.label = "L"; f.type = PRSL_TEXT;
    bool dirty = prsl_store_is_dirty(&store);
    (void)dirty;
    (void)f;
    cJSON *(*payload)(prsl_store_t *) = prsl_build_settings_payload;
    (void)payload;
    return 0;
}
EOF
g++ -std=gnu++17 -DHOST_TEST -I"$ROOT/tests/native/stub" -I"$ROOT/include" -I"$ROOT/src" -I"$DEPS" \
  -c "$ROOT/tests/native/check_store_api.cpp" -o /tmp/prsl_check_store_api.o
rm -f "$ROOT/tests/native/check_store_api.cpp"
echo "== C++ store-API check: OK =="