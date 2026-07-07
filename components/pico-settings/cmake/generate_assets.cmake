# cmake/generate_assets.cmake
# Called from CMakeLists.txt via add_custom_command.
# Reads static source files, injects config from pico_config.json,
# gzips everything, writes pwui_assets.c and pwui_assets.h.
#
# Parameters (passed via -D):
#   ASSETS_SRC   — repo root with index.html, app.min.js, pico.jade.min.css
#   CONFIG_FILE  — path to pico_config.json in the downstream project
#   OUT_DIR      — output directory for pwui_assets.c / pwui_assets.h

find_program(GZIP gzip REQUIRED)

# Default title
set(PICO_TITLE "ESP32 Config")

# Read config if present
if(EXISTS "${CONFIG_FILE}")
    file(READ "${CONFIG_FILE}" PICO_JSON)
    string(JSON PICO_TITLE GET "${PICO_JSON}" title)
endif()

# Read and inject title into HTML
file(READ "${ASSETS_SRC}/index.html" HTML_CONTENT)
string(REPLACE "{{TITLE}}" "${PICO_TITLE}" HTML_CONTENT "${HTML_CONTENT}")

# Read JS and CSS (title injection not needed)
file(READ "${ASSETS_SRC}/app.min.js" JS_CONTENT)
file(READ "${ASSETS_SRC}/pico.jade.min.css" CSS_CONTENT)

# Helper: gzip content and store hex in a variable
function(gzip_asset VARNAME CONTENT OUT_DIR)
    set(TMP "${OUT_DIR}/tmp_${VARNAME}.tmp")
    file(WRITE "${TMP}" "${CONTENT}")
    execute_process(
        COMMAND ${GZIP} -9 -c "${TMP}"
        OUTPUT_FILE "${OUT_DIR}/tmp_${VARNAME}.gz"
        RESULT_VARIABLE GZIP_RESULT
    )
    if(NOT GZIP_RESULT EQUAL 0)
        message(FATAL_ERROR "gzip failed for ${VARNAME}")
    endif()
    file(READ "${OUT_DIR}/tmp_${VARNAME}.gz" GZIPPED HEX)
    file(REMOVE "${TMP}" "${OUT_DIR}/tmp_${VARNAME}.gz")
    set("${VARNAME}_DATA" "${GZIPPED}" PARENT_SCOPE)
endfunction()

gzip_asset("index_html_gz" "${HTML_CONTENT}" "${OUT_DIR}")
gzip_asset("app_min_js_gz" "${JS_CONTENT}" "${OUT_DIR}")
gzip_asset("pico_jade_min_css_gz" "${CSS_CONTENT}" "${OUT_DIR}")

# Write pwui_assets.h
file(WRITE "${OUT_DIR}/pwui_assets.h" [=[
#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *path;
    const char *mime;
    const uint8_t *data;
    size_t len;
} pwui_asset_t;

extern const pwui_asset_t pwui_assets[];
extern const size_t pwui_assets_count;
]=])

# Write pwui_assets.c
set(OUT_C "${OUT_DIR}/pwui_assets.c")
file(WRITE "${OUT_C}" [=[#include "pwui_assets.h"

]=])

# Define byte arrays (convert hex string to C array)
function(write_byte_array VARNAME HEX_DATA OUT_FILE)
    file(APPEND "${OUT_FILE}" "const uint8_t ${VARNAME}[] = {\n")
    set(COL 0)
    set(LINE_COUNT 0)
    while(HEX_DATA)
        string(SUBSTRING "${HEX_DATA}" 0 2 BYTE)
        string(SUBSTRING "${HEX_DATA}" 2 -1 HEX_DATA)
        if(COL EQUAL 0)
            file(APPEND "${OUT_FILE}" "    ")
        endif()
        file(APPEND "${OUT_FILE}" "0x${BYTE}")
        math(EXPR COL "${COL} + 1")
        if(HEX_DATA AND COL LESS 12)
            file(APPEND "${OUT_FILE}" ",")
        elseif(HEX_DATA)
            file(APPEND "${OUT_FILE}" ",\n")
            set(COL 0)
        endif()
    endwhile()
    file(APPEND "${OUT_FILE}" "\n};\n")
endfunction()

macro(write_count VARNAME HEX_DATA OUT_FILE)
    string(LENGTH "${HEX_DATA}" HEX_LEN)
    math(EXPR BYTE_LEN "${HEX_LEN} / 2")
    file(APPEND "${OUT_FILE}" "const size_t ${VARNAME} = ${BYTE_LEN};\n\n")
endmacro()

write_byte_array("index_html_gz" "${index_html_gz_DATA}" "${OUT_C}")
write_count("index_html_gz_len" "${index_html_gz_DATA}" "${OUT_C}")
write_byte_array("app_min_js_gz" "${app_min_js_gz_DATA}" "${OUT_C}")
write_count("app_min_js_gz_len" "${app_min_js_gz_DATA}" "${OUT_C}")
write_byte_array("pico_jade_min_css_gz" "${pico_jade_min_css_gz_DATA}" "${OUT_C}")
write_count("pico_jade_min_css_gz_len" "${pico_jade_min_css_gz_DATA}" "${OUT_C}")

file(APPEND "${OUT_C}" [=[
const pwui_asset_t pwui_assets[] = {
    {"/", "text/html", index_html_gz, index_html_gz_len},
    {"/app.min.js", "application/javascript", app_min_js_gz, app_min_js_gz_len},
    {"/pico.jade.min.css", "text/css", pico_jade_min_css_gz, pico_jade_min_css_gz_len},
};
const size_t pwui_assets_count = 3;
]=])
