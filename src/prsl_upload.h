#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "prsl.h"
#include "prsl_store.h"

#define PRSL_UPLOAD_NAME_MAX 128
#define PRSL_UPLOAD_MIME_MAX 64
#define PRSL_UPLOAD_ERR_MAX 128

typedef struct {
    bool active;
    bool meta_sent;
    bool finished;
    bool aborted;
    bool has_mime;       /* mime[0] != '\0' */
    prsl_field_t *field;
    char name[PRSL_UPLOAD_NAME_MAX];
    char mime[PRSL_UPLOAD_MIME_MAX];
    size_t size;
    size_t offset;
    char err[PRSL_UPLOAD_ERR_MAX];
    int status;          /* callback override, 0 = unset */
    int default_status;  /* 400 for META/CHUNK, 500 for END */
    esp_err_t result;
} prsl_upload_state_t;

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t prsl_upload_validate(const prsl_field_t *field, const char *name,
                               const char *mime, size_t size,
                               char *err, size_t err_sz, int *status);
bool prsl_upload_accept_match(const char *accept, const char *name, const char *mime);
bool prsl_upload_is_active(const prsl_upload_state_t *st);

#ifdef __cplusplus
}
#endif
