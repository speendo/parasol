#!/usr/bin/env bash
# Build and run native C unit tests (store + json + body). Requires test-deps/native deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
bash test-deps/native_setup.sh
DEPS="$ROOT/test-deps/native"
COMMON=( "$ROOT/src/prsl_store.c" "$ROOT/src/prsl_json.c" "$DEPS/cJSON.c" "$DEPS/unity.c" )
# -Wno-unused-function: recovered test_prsl_store.c defines an unused static
# helper (get_persisted_val2) — kept verbatim per plan; suppress the class.
FLAGS=( -DHOST_TEST -Wall -Wno-unused-function -I"$ROOT/tests/native/stub" -I"$ROOT/include" -I"$ROOT/src" -I"$DEPS" )
for t in store json body save_body; do
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
// Mirrors prsl.cpp: prsl_build_settings_payload(store) must accept a
// non-const store and call prsl_store_is_dirty without const mismatch.
cJSON *prsl_build_settings_payload(prsl_store_t *store);
int main(void) {
    prsl_store_t store = {0};
    bool dirty = prsl_store_is_dirty(&store);
    (void)dirty;
    return 0;
}
EOF
g++ -std=gnu++17 -DHOST_TEST -I"$ROOT/tests/native/stub" -I"$ROOT/include" -I"$ROOT/src" -I"$DEPS" \
  -c "$ROOT/tests/native/check_store_api.cpp" -o /tmp/prsl_check_store_api.o
rm -f "$ROOT/tests/native/check_store_api.cpp"
echo "== C++ store-API check: OK =="