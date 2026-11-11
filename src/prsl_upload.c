#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <ctype.h>
#include "prsl_upload.h"

static bool is_ws(char c) {
    return isspace((unsigned char)c) != 0;
}

static bool valid_name(const char *name) {
    size_t i, len;
    if (!name || !name[0]) return false;
    len = strlen(name);
    if (len >= PRSL_UPLOAD_NAME_MAX) return false;
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) return false;
    for (i = 0; i < len; i++) {
        unsigned char c = (unsigned char)name[i];
        if (c == '/' || c == '\\') return false;
        if (c < 0x20 || c == 0x7F) return false;
    }
    return true;
}

/* One trimmed accept entry, not NUL-terminated at len. */
static bool entry_match(const char *entry, size_t len,
                        const char *name, const char *mime) {
    size_t nlen, plen;
    const char *slash;

    if (len == 0) return false;
    if (entry[0] == '.') {
        nlen = strlen(name);
        if (len > nlen) return false;
        return strncasecmp(name + nlen - len, entry, len) == 0;
    }
    if (len == 3 && entry[0] == '*' && entry[1] == '/' && entry[2] == '*')
        return true;
    if (!mime) return false;
    slash = memchr(entry, '/', len);
    if (!slash) return false;
    if (entry[len - 1] == '*') {
        plen = len - 2; /* drop trailing '*' and '/' */
        if (plen == 0) return false;
        return strncasecmp(mime, entry, plen) == 0 && mime[plen] == '/';
    }
    return strlen(mime) == len && strncasecmp(mime, entry, len) == 0;
}

bool prsl_upload_accept_match(const char *accept, const char *name, const char *mime) {
    const char *p, *start, *end;

    if (!accept || !accept[0]) return true;
    if (!name) return false;
    p = accept;
    while (*p) {
        while (is_ws(*p)) p++;
        start = p;
        while (*p && *p != ',') p++;
        end = p;
        while (end > start && is_ws(end[-1])) end--;
        if (entry_match(start, (size_t)(end - start), name, mime)) return true;
        if (*p == ',') p++;
    }
    return false;
}

esp_err_t prsl_upload_validate(const prsl_field_t *field, const char *name,
                               const char *mime, size_t size,
                               char *err, size_t err_sz, int *status) {
    const char *msg;
    int st;

    if (!field || field->type != PRSL_FILE || !field->on_upload) {
        msg = "Invalid field";
        st = 400;
    } else if (!valid_name(name)) {
        msg = "Invalid name";
        st = 400;
    } else if (size == 0) {
        msg = "Empty file";
        st = 400;
    } else if (field->max_size && size > field->max_size) {
        msg = "File too large";
        st = 413;
    } else if (!prsl_upload_accept_match(field->accept, name, mime)) {
        msg = "File type not allowed";
        st = 415;
    } else {
        if (err && err_sz) err[0] = '\0';
        if (status) *status = 0;
        return ESP_OK;
    }

    if (err && err_sz) snprintf(err, err_sz, "%s", msg);
    if (status) *status = st;
    return ESP_ERR_INVALID_ARG;
}

bool prsl_upload_is_active(const prsl_upload_state_t *st) {
    return st && st->active && !st->finished;
}
