idf_component_register(
    SRCS "src/pwui_store.c" "src/pwui_json.c" "src/pwui.cpp" "src/pwui_ws.cpp" "src/pwui_assets.c"
    INCLUDE_DIRS "include" "src" "dependencies/cJSON"
    REQUIRES cJSON
    PRIV_REQUIRES AsyncTCP ESPAsyncWebServer
)
