#pragma once

/* Stub for host-side unit tests — no-op mutex operations */
typedef void* SemaphoreHandle_t;
static inline SemaphoreHandle_t xSemaphoreCreateMutex(void) { return (SemaphoreHandle_t)1; }
static inline void vSemaphoreDelete(SemaphoreHandle_t xSemaphore) { (void)xSemaphore; }
static inline int xSemaphoreTake(SemaphoreHandle_t xSemaphore, unsigned int xTicksToWait) { (void)xSemaphore; (void)xTicksToWait; return 1; }
static inline int xSemaphoreGive(SemaphoreHandle_t xSemaphore) { (void)xSemaphore; return 1; }
static inline int xSemaphoreTakeRecursive(SemaphoreHandle_t xSemaphore, unsigned int xTicksToWait) { (void)xSemaphore; (void)xTicksToWait; return 1; }
static inline int xSemaphoreGiveRecursive(SemaphoreHandle_t xSemaphore) { (void)xSemaphore; return 1; }

#ifndef portMAX_DELAY
#define portMAX_DELAY 0xffffffffUL
#endif
