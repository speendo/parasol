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

/* Non-zero callback status wins over the default, clamped to 400..599. */
static int clamp_status(int status) {
    if (status < 400) return 400;
    if (status > 599) return 599;
    return status;
}

static void clear_state(prsl_upload_state_t *st) {
    st->active = false;
    st->meta_sent = false;
    st->finished = false;
    st->aborted = false;
    st->has_mime = false;
    st->field = NULL;
    st->name[0] = '\0';
    st->mime[0] = '\0';
    st->size = 0;
    st->offset = 0;
    st->err[0] = '\0';
    st->status = 0;
    st->default_status = 400;
    st->result = ESP_OK;
}

/* Record a core-detected failure (callback already rejected or not called). */
static void set_failure(prsl_upload_state_t *st, esp_err_t result, int status,
                        const char *msg) {
    st->result = result;
    st->status = status;
    st->default_status = status;
    snprintf(st->err, sizeof(st->err), "%s", msg);
}

/* Fill the callback view; META and ABORT carry no data. */
static void fill_event(prsl_upload_t *u, prsl_upload_state_t *st,
                       prsl_upload_event_t event, const uint8_t *data,
                       size_t len, size_t offset) {
    u->event = event;
    u->group_id = st->field ? st->field->group_id : NULL;
    u->key = st->field ? st->field->key : NULL;
    u->name = st->name;
    u->mime = st->has_mime ? st->mime : NULL;
    u->size = st->size;
    u->offset = offset;
    u->data = data;
    u->len = len;
    u->err = st->err;
    u->err_len = sizeof(st->err);
    u->status = 0;
}

esp_err_t prsl_upload_begin(prsl_upload_state_t *st, prsl_field_t *field,
                            const char *name, const char *mime, size_t size) {
    prsl_upload_t u;
    esp_err_t err;

    if (!st || prsl_upload_is_active(st)) return ESP_ERR_INVALID_STATE;

    /* Clear first so a completed or aborted upload cannot leak flags. */
    clear_state(st);

    err = prsl_upload_validate(field, name, mime, size,
                               st->err, sizeof(st->err), &st->status);
    if (err != ESP_OK) {
        st->default_status = st->status;
        st->result = err;
        return err;
    }

    st->field = field;
    snprintf(st->name, sizeof(st->name), "%s", name);
    st->has_mime = mime && mime[0];
    if (st->has_mime) snprintf(st->mime, sizeof(st->mime), "%s", mime);
    st->size = size;
    st->offset = 0;
    st->active = true;
    st->meta_sent = true;
    st->err[0] = '\0';
    st->status = 0;
    st->default_status = 400;

    fill_event(&u, st, PRSL_UPLOAD_META, NULL, 0, 0);
    err = field->on_upload(&u);
    if (err != ESP_OK) {
        st->result = err;
        if (!st->err[0]) snprintf(st->err, sizeof(st->err), "Upload rejected");
        st->status = u.status ? clamp_status(u.status) : 0;
        prsl_upload_abort(st);
        return err;
    }
    st->result = ESP_OK;
    return ESP_OK;
}

esp_err_t prsl_upload_chunk(prsl_upload_state_t *st, const uint8_t *data,
                            size_t len, size_t offset) {
    prsl_upload_t u;
    esp_err_t err;
    size_t max;

    if (!st || !prsl_upload_is_active(st)) return ESP_ERR_INVALID_STATE;

    if (offset != st->offset) {
        set_failure(st, ESP_ERR_INVALID_ARG, 400, "Invalid offset");
        prsl_upload_abort(st);
        return ESP_ERR_INVALID_ARG;
    }
    max = st->field ? st->field->max_size : 0;
    /* Subtraction only: offset + len may overflow size_t. */
    if (offset > st->size || len > st->size - offset ||
        (max && (offset > max || len > max - offset))) {
        set_failure(st, ESP_ERR_INVALID_ARG, 413, "File too large");
        prsl_upload_abort(st);
        return ESP_ERR_INVALID_ARG;
    }

    fill_event(&u, st, PRSL_UPLOAD_CHUNK, data, len, offset);
    st->status = 0;
    st->err[0] = '\0';
    err = st->field->on_upload(&u);
    if (err != ESP_OK) {
        st->result = err;
        if (!st->err[0]) snprintf(st->err, sizeof(st->err), "Upload rejected");
        st->status = u.status ? clamp_status(u.status) : 0;
        st->default_status = 400;
        prsl_upload_abort(st);
        return err;
    }
    st->offset = offset + len;
    return ESP_OK;
}

esp_err_t prsl_upload_end(prsl_upload_state_t *st) {
    prsl_upload_t u;
    esp_err_t err;

    if (!st || !st->active || st->finished) return ESP_ERR_INVALID_STATE;
    if (st->offset != st->size) {
        set_failure(st, ESP_ERR_INVALID_ARG, 400, "Incomplete upload");
        prsl_upload_abort(st);
        return ESP_ERR_INVALID_ARG;
    }

    fill_event(&u, st, PRSL_UPLOAD_END, NULL, 0, st->offset);
    st->status = 0;
    st->err[0] = '\0';
    st->default_status = 500;
    err = st->field->on_upload(&u);
    if (err != ESP_OK) {
        st->result = err;
        if (!st->err[0]) snprintf(st->err, sizeof(st->err), "Upload rejected");
        st->status = u.status ? clamp_status(u.status) : 0;
        prsl_upload_abort(st);
        return err;
    }
    st->finished = true;
    st->active = false;
    st->result = ESP_OK;
    return ESP_OK;
}

void prsl_upload_abort(prsl_upload_state_t *st) {
    prsl_upload_t u;

    if (!st || !st->active || st->finished || st->aborted) return;
    st->aborted = true; /* before the callback: exactly-once guard */
    if (st->meta_sent) {
        fill_event(&u, st, PRSL_UPLOAD_ABORT, NULL, 0, st->offset);
        (void)st->field->on_upload(&u);
    }
    st->active = false;
}
