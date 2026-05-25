cmake_minimum_required(VERSION 3.10)
project(LoxonePVProductionPrediction)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(-Wall -Wextra)
endif()

# Bundle the Loxone script into a single deployable file
set(BUNDLED_FILE ${CMAKE_BINARY_DIR}/pv-production-prediction.bundled.c)

add_custom_command(
    OUTPUT ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E echo "// Bundled C code" > ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/lib/picoc.h >> ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/loxone/pv-production-prediction.c >> ${BUNDLED_FILE}
    DEPENDS
        ${CMAKE_SOURCE_DIR}/src/lib/picoc.h
        ${CMAKE_SOURCE_DIR}/src/loxone/pv-production-prediction.c
    COMMENT "Bundling source files into a single file"
)

add_custom_target(bundle ALL DEPENDS ${BUNDLED_FILE})

include_directories(src/lib)

# Regression test for the Wattsonic inverter state manager (unrelated to PV prediction)
add_executable(test_wattsonic_inverter_state_manager src/lib/wattsonic_inverter_state_manager.test.c)
target_compile_definitions(test_wattsonic_inverter_state_manager PRIVATE
    WATTSONIC_STATE_MANAGER_PATH="${CMAKE_SOURCE_DIR}/src/loxone/wattsonic-inverter-state-manager.c")
