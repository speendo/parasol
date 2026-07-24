# cmake/generate_assets.cmake
find_program(GZIP gzip REQUIRED)

# Default values
set(PARASOL_TITLE "PARASOL")
set(PARASOL_LOGO "/logo.png")
set(PARASOL_FAVICON "/favicon.ico")
set(PARASOL_ALWAYS_SHOW_SAVE "0")

# Read config if present
if(EXISTS "${CONFIG_FILE}")
    file(READ "${CONFIG_FILE}" PARASOL_JSON)
    string(JSON PARASOL_TITLE ERROR_VARIABLE _ GET "${PARASOL_JSON}" title)
    string(JSON PARASOL_LOGO ERROR_VARIABLE _ GET "${PARASOL_JSON}" logo)
    string(JSON PARASOL_FAVICON ERROR_VARIABLE _ GET "${PARASOL_JSON}" favicon)
    string(JSON _always ERROR_VARIABLE _ GET "${PARASOL_JSON}" always_show_save)
    if(_always)
        set(PARASOL_ALWAYS_SHOW_SAVE "1")
    endif()
endif()

# Read and inject config into HTML
file(READ "${ASSETS_SRC}/index.html" HTML_CONTENT)
string(REPLACE "{{TITLE}}" "${PARASOL_TITLE}" HTML_CONTENT "${HTML_CONTENT}")
string(REPLACE "{{LOGO}}" "${PARASOL_LOGO}" HTML_CONTENT "${HTML_CONTENT}")
string(REPLACE "{{FAVICON}}" "${PARASOL_FAVICON}" HTML_CONTENT "${HTML_CONTENT}")
string(REPLACE "{{ALWAYS_SHOW_SAVE}}" "${PARASOL_ALWAYS_SHOW_SAVE}" HTML_CONTENT "${HTML_CONTENT}")

# Read JS and CSS
file(READ "${ASSETS_SRC}/app.min.js" JS_CONTENT)
file(READ "${ASSETS_SRC}/pico.jade.min.css" CSS_CONTENT)

# Gzip each piece
foreach(PAIR IN ITEMS
    "html;${HTML_CONTENT};index_html_gz"
    "js;${JS_CONTENT};app_min_js_gz"
    "css;${CSS_CONTENT};pico_jade_min_css_gz"
)
    list(GET PAIR 0 TYPE)
    list(GET PAIR 1 CONTENT)
    list(GET PAIR 2 VARNAME)

    file(WRITE "${OUT_DIR}/tmp_${VARNAME}.tmp" "${CONTENT}")

    execute_process(
        COMMAND ${GZIP} -9 -c "${OUT_DIR}/tmp_${VARNAME}.tmp"
        OUTPUT_FILE "${OUT_DIR}/tmp_${VARNAME}.gz"
        RESULT_VARIABLE GZIP_RESULT
    )
    if(NOT GZIP_RESULT EQUAL 0)
        message(FATAL_ERROR "gzip failed for ${VARNAME}")
    endif()

    file(READ "${OUT_DIR}/tmp_${VARNAME}.gz" GZIPPED HEX)
    file(REMOVE "${OUT_DIR}/tmp_${VARNAME}.tmp" "${OUT_DIR}/tmp_${VARNAME}.gz")

    set("${VARNAME}_DATA" "${GZIPPED}")
endforeach()

# Write prsl_assets.h
file(WRITE "${OUT_DIR}/prsl_assets.h" [=[
#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *path;
    const char *mime;
    const uint8_t *data;
    size_t len;
} prsl_asset_t;

extern const prsl_asset_t prsl_assets[];
extern const size_t prsl_assets_count;
]=])

# Write prsl_assets.c
set(OUT_C "${OUT_DIR}/prsl_assets.c")
file(WRITE "${OUT_C}" [=[#include "prsl_assets.h"]

]=])

function(write_byte_array VARNAME HEX_DATA OUT_FILE)
    file(APPEND "${OUT_FILE}" "const uint8_t ${VARNAME}[] = {\n")
    set(COL 0)
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
const prsl_asset_t prsl_assets[] = {
    {"/", "text/html", index_html_gz, index_html_gz_len},
    {"/app.min.js", "application/javascript", app_min_js_gz, app_min_js_gz_len},
    {"/pico.jade.min.css", "text/css", pico_jade_min_css_gz, pico_jade_min_css_gz_len},
};
const size_t prsl_assets_count = 3;
]=])
