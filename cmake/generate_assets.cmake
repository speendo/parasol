# cmake/generate_assets.cmake
# Thin wrapper: invoke the canonical Python generator into the build dir.
if(NOT PYTHON3)
    find_program(PYTHON3 NAMES python3 python REQUIRED)
endif()

if(NOT ASSETS_SRC OR NOT OUT_DIR)
    message(FATAL_ERROR "ASSETS_SRC and OUT_DIR are required")
endif()

get_filename_component(_generator "${ASSETS_SRC}/scripts/generate_assets.py" ABSOLUTE)

execute_process(
    COMMAND "${PYTHON3}" "${_generator}"
        --assets-src "${ASSETS_SRC}"
        --config "${CONFIG_FILE}"
        --out-dir "${OUT_DIR}"
    RESULT_VARIABLE _result
)
if(NOT _result EQUAL 0)
    message(FATAL_ERROR "Asset generation failed (exit ${_result})")
endif()
