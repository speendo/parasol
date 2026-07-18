# C sources built from source files (not generated)
set(COMPONENT_SRCS "src/prsl_store.c" "src/prsl_json.c" "src/prsl.cpp" "src/prsl_ws.cpp")

# Asset files to watch for changes (relative to repo root)
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}/../../..")

# Generated asset files
set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(ASSETS_C "${GENERATED_DIR}/prsl_assets.c")
set(ASSETS_H "${GENERATED_DIR}/prsl_assets.h")

# Read always_show_save from config (default false)
set(PRSL_ALWAYS_SHOW_SAVE 0)
if(EXISTS "${CMAKE_SOURCE_DIR}/parasol_config.json")
    file(READ "${CMAKE_SOURCE_DIR}/parasol_config.json" PARASOL_JSON)
    string(JSON _always ERROR_VARIABLE _ GET "${PARASOL_JSON}" always_show_save)
    if(_always)
        set(PRSL_ALWAYS_SHOW_SAVE 1)
    endif()
endif()

add_custom_command(
    OUTPUT ${ASSETS_C} ${ASSETS_H}
    COMMAND ${CMAKE_COMMAND}
        -DASSETS_SRC="${ASSETS_SRC}"
        -DCONFIG_FILE="${CMAKE_SOURCE_DIR}/parasol_config.json"
        -DOUT_DIR="${GENERATED_DIR}"
        -P "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    DEPENDS
        "${ASSETS_SRC}/index.html"
        "${ASSETS_SRC}/app.min.js"
        "${ASSETS_SRC}/pico.jade.min.css"
        "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    COMMENT "Generating parasol assets"
)

idf_component_register(
    SRCS ${COMPONENT_SRCS} ${ASSETS_C}
    INCLUDE_DIRS "include" "src" "dependencies/cJSON" "${GENERATED_DIR}"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
    COMPILE_DEFINITIONS PRSL_ALWAYS_SHOW_SAVE=${PRSL_ALWAYS_SHOW_SAVE}
)
