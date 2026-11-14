#pragma once
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* True once prsl_stop() has begun and until prsl_init() clears it. */
bool prsl_is_stopping(void);

#ifdef __cplusplus
}
#endif
