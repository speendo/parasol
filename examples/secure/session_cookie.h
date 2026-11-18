#ifndef EXAMPLE_SESSION_COOKIE_H
#define EXAMPLE_SESSION_COOKIE_H

#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <strings.h>

/* Exact match for a prsl_session cookie. Cookie names are case-sensitive;
 * the value stops at ';'. Duplicate cookies are scanned in order. */
static inline bool session_cookie_matches(const char *header,
                                          const char *token) {
    if (!header || !token || !token[0]) return false;
    size_t tlen = strlen(token);
    const char *p = header;
    while (*p) {
        while (*p == ' ' || *p == '\t' || *p == ';') p++;
        const char *name = p;
        while (*p && *p != '=' && *p != ';') p++;
        if (*p != '=') {
            while (*p && *p != ';') p++;
            continue;
        }
        size_t nlen = (size_t)(p - name);
        p++;
        const char *val = p;
        while (*p && *p != ';') p++;
        size_t vlen = (size_t)(p - val);
        if (nlen == 12 && memcmp(name, "prsl_session", 12) == 0 &&
            vlen == tlen && memcmp(val, token, vlen) == 0) return true;
    }
    return false;
}

/* Missing Origin is allowed for non-browser clients. Otherwise the Origin
 * must be exactly http://<Host> or https://<Host>, case-insensitively. */
static inline bool origin_matches(const char *origin, const char *host) {
    if (!origin || !origin[0]) return true;
    if (!host || !host[0]) return false;
    if (strncasecmp(origin, "http://", 7) == 0 &&
        strcasecmp(origin + 7, host) == 0) return true;
    if (strncasecmp(origin, "https://", 8) == 0 &&
        strcasecmp(origin + 8, host) == 0) return true;
    return false;
}

#endif
