# Fix C/C++ Compatibility Issues in pico-settings

**Goal:** Make pico-settings buildable when compiled alongside C++ code (e.g., Arduino/PlatformIO projects).

**Context:** pico-settings headers are included from both C (`pwui_store.c`, `pwui_json.c`) and C++ (`pwui.cpp`, `pwui_ws.cpp`) compilation units. Three issues were discovered during integration into [FlushFM-2.0](https://github.com/anomalyco/FlushFM-2.0).

---

### Fix 1: `AsyncWebServer` forward declaration in `pwui.h`

`pwui.h` forward-declares `AsyncWebServer` only for C++ (`class AsyncWebServer`). When compiled as C, the forward declaration is missing and `pwui_init(AsyncWebServer *server, ...)` fails with "unknown type name".

**File:** `include/pwui.h`

**Change:** Add C-compatible opaque struct typedef in the `#else` branch:

```c
#ifdef __cplusplus
class AsyncWebServer;
#else
typedef struct AsyncWebServer AsyncWebServer;
#endif
```

### Fix 2: Duplicate `pwui_type_t` enum in `pwui_store.h`

`pwui_store.h` independently defines `pwui_type_t` which is already declared in `pwui.h`. When both headers are included in the same compilation unit (e.g., from `pwui.cpp`), the compiler sees conflicting typedefs.

**File:** `src/pwui_store.h`

**Changes:**

1. Add `#include "pwui.h"` after existing includes
2. Remove lines 9–13 (the duplicate `typedef enum { PWUI_TEXT, ... } pwui_type_t;`)

### Fix 3: Missing `extern "C"` on internal headers

`pwui_store.h`, `pwui_json.h`, and `pwui_ws.h` declare functions that are defined in C (`pwui_store.c`, `pwui_json.c`) and called from C++ (`pwui.cpp`, `pwui_ws.cpp`). Without `extern "C"` guards, C++ mangles the function names and the linker produces "undefined reference".

**Files:** `src/pwui_store.h`, `src/pwui_json.h`, `src/pwui_ws.h`

**Change:** Wrap all function declarations in each header with `extern "C"`:

```c
#ifdef __cplusplus
extern "C" {
#endif

/* existing function declarations */

#ifdef __cplusplus
}
#endif
```

Type declarations (structs, typedefs, enums) can remain outside the guard.

---

## Verification

```bash
npm run build
npm test
```

No regressions expected — these are additive compatibility guards.
