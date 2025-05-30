cmake_minimum_required(VERSION 3.10)
project(LoxonePVProductionPrediction)

# Set the C standard
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

# Add compiler flags to enable all warnings and treat them as errors
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(-Wall -Wextra)
endif()

# Define the output file for the bundled code
set(BUNDLED_FILE ${CMAKE_BINARY_DIR}/pv-production-prediction.bundled.c)

# Add a custom command to bundle the source files
add_custom_command(
    OUTPUT ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E echo "// Bundled C code" > ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/lib/picoc.h >> ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/lib/nx_json.h >> ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/lib/nx_json.c >> ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/lib/forecast_solar.h >> ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/lib/forecast_solar.c >> ${BUNDLED_FILE}
    COMMAND ${CMAKE_COMMAND} -E cat ${CMAKE_SOURCE_DIR}/src/loxone/pv-production-prediction.c >> ${BUNDLED_FILE}
    DEPENDS 
        ${CMAKE_SOURCE_DIR}/src/lib/picoc.h
        ${CMAKE_SOURCE_DIR}/src/lib/nx_json.h
        ${CMAKE_SOURCE_DIR}/src/lib/nx_json.c
        ${CMAKE_SOURCE_DIR}/src/lib/forecast_solar.h
        ${CMAKE_SOURCE_DIR}/src/lib/forecast_solar.c
        ${CMAKE_SOURCE_DIR}/src/loxone/pv-production-prediction.c
    COMMENT "Bundling source files into a single file"
)

# Add a custom target to build the bundled file 
add_custom_target(bundle ALL DEPENDS ${BUNDLED_FILE})

# Include directories
include_directories(src/lib)

# Add the nx_json library
add_library(nx_json src/lib/nx_json.c)

# Add the forecast_solar library
add_library(forecast_solar src/lib/forecast_solar.c)
target_link_libraries(forecast_solar nx_json)

# Add the test executable for nx_json
add_executable(test_nx_json src/lib/nx_json.test.c)
target_link_libraries(test_nx_json nx_json)
target_compile_definitions(test_nx_json PRIVATE 
    MOCK_JSON_PATH="${CMAKE_SOURCE_DIR}/src/lib/mocks/simple-json-samples.json")

# Add the internal test executable for nx_json
add_executable(test_nx_json_internal src/lib/nx_json.internal.test.c)
target_link_libraries(test_nx_json_internal nx_json)

# Add the internal test executable for forecast_solar
add_executable(test_forecast_solar src/lib/forecast_solar.test.c)
target_link_libraries(test_forecast_solar forecast_solar nx_json)
target_compile_definitions(test_forecast_solar PRIVATE 
    MOCK_RESPONSE_FILE="${CMAKE_SOURCE_DIR}/src/lib/mocks/forecast_solar_response.txt"
    MOCK_RESPONSE_BODY_FILE="${CMAKE_SOURCE_DIR}/src/lib/mocks/forecast_solar_response_body.json"
    MOCK_RESPONSE_BODY_ONELINE_FILE="${CMAKE_SOURCE_DIR}/src/lib/mocks/forecast_solar_response_body_oneline.json")