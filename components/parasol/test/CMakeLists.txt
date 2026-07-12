idf_component_register(
    SRCS "test_prsl_store.c" "test_prsl_json.c"
    INCLUDE_DIRS "../include" "../src"
    REQUIRES cJSON unity
)
