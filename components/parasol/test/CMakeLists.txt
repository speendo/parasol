idf_component_register(
    SRCS "test_pwui_store.c" "test_pwui_json.c"
    INCLUDE_DIRS "../include" "../src"
    REQUIRES cJSON unity
)
