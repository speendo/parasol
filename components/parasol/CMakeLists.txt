# C sources built from source files (not generated)
set(COMPONENT_SRCS "src/pwui_store.c" "src/pwui_json.c" "src/pwui.cpp" "src/pwui_ws.cpp")

# Asset files to watch for changes (relative to repo root)
set(ASSETS_SRC "${CMAKE_CURRENT_LIST_DIR}/../../..")

# Generated asset files
set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(ASSETS_C "${GENERATED_DIR}/pwui_assets.c")
set(ASSETS_H "${GENERATED_DIR}/pwui_assets.h")

add_custom_command(
    OUTPUT ${ASSETS_C} ${ASSETS_H}
    COMMAND ${CMAKE_COMMAND}
        -DASSETS_SRC="${ASSETS_SRC}"
        -DCONFIG_FILE="${CMAKE_SOURCE_DIR}/pico_config.json"
        -DOUT_DIR="${GENERATED_DIR}"
        -P "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    DEPENDS
        "${ASSETS_SRC}/index.html"
        "${ASSETS_SRC}/app.min.js"
        "${ASSETS_SRC}/pico.jade.min.css"
        "${CMAKE_CURRENT_LIST_DIR}/cmake/generate_assets.cmake"
    COMMENT "Generating pico-website assets"
)

idf_component_register(
    SRCS ${COMPONENT_SRCS} ${ASSETS_C}
    INCLUDE_DIRS "include" "src" "dependencies/cJSON" "${GENERATED_DIR}"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
)
