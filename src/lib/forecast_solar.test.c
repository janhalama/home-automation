#include "forecast_solar.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

// Helper function to read file content
char* read_file(const char* filename) {
    FILE* file = fopen(filename, "rb");
    if (file == NULL) {
        printf("Failed to open file: %s\n", filename);
        return NULL;
    }

    fseek(file, 0, SEEK_END);
    long file_size = ftell(file);
    fseek(file, 0, SEEK_SET);

    char* buffer = (char*)malloc(file_size + 1);
    if (buffer == NULL) {
        fclose(file);
        return NULL;
    }

    size_t read_size = fread(buffer, 1, file_size, file);
    buffer[read_size] = '\0';

    fclose(file);
    return buffer;
}

void test_skip_headers() {
    printf("Testing skipHeaders function...\n");
    
    // Test with headers
    char* response = read_file(MOCK_RESPONSE_FILE);
    assert(response != NULL);
    
    char* body = skipHeaders(response);
    assert(body != NULL);
    assert(strstr(body, "{") == body);
    printf("✓ Successfully skipped HTTP headers\n");
    
    // Test with no headers (using just the JSON part)
    char* json_start = strstr(response, "{");
    assert(json_start != NULL);
    body = skipHeaders(json_start);
    assert(body != NULL);
    assert(body == json_start);
    printf("✓ Correctly handled response without headers\n");
    
    // Test with NULL input
    body = skipHeaders(NULL);
    assert(body == NULL);
    printf("✓ Correctly handled NULL input\n");

      free(response);
}

void test_parse_daily_production() {
    printf("\nTesting parseDailyProduction function...\n");
    
    const char* TODAY = "2025-02-27";
    const char* TOMORROW = "2025-02-28";
    
    // Test parsing mocked response body from the forecast.solar API
    char* json_response = read_file(MOCK_RESPONSE_BODY_FILE);
    assert(json_response != NULL);
    
    struct DailyProduction prod2 = parseDailyProduction(
        json_response, 
        (char*)TODAY, 
        (char*)TOMORROW
    );
    assert(prod2.today == 4674.362);
    assert(prod2.tomorrow == 4774.208);
    printf("✓ Successfully parsed json response with line breaks\n");
    
    free(json_response);
    
    // Test with one-line response
    char* json_response_oneline = read_file(MOCK_RESPONSE_BODY_ONELINE_FILE);
    struct DailyProduction prod_oneline = parseDailyProduction(json_response_oneline, (char*)TODAY, (char*)TOMORROW);
    assert(prod_oneline.today == 4674.362);
    assert(prod_oneline.tomorrow == 4774.208);
    printf("✓ Successfully parsed json response without line breaks\n");
    
    // Test with NULL input
    struct DailyProduction prod3 = parseDailyProduction(NULL, (char*)TODAY, (char*)TOMORROW);
    assert(prod3.today == 0);
    assert(prod3.tomorrow == 0);
    printf("✓ Correctly handled NULL input\n");
}

int main() {
    printf("Running forecast_solar tests...\n\n");
    
    test_skip_headers();
    test_parse_daily_production();
    
    printf("\nAll tests passed! ✓\n");
    return 0;
} 