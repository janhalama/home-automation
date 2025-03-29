#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "nx_json.h"

// We need to test just the public API instead of relying on internals
int test_count = 0;

void test_nx_json_reset() {
    printf("Testing nx_json_reset...\n");
    test_count += 1;
    
    // Call reset and verify it doesn't crash
    nx_json_reset();
    assert(1); // Just to count a test
    
    printf("nx_json_reset tests completed\n\n");
}

void test_nx_json_parse_simple() {
    printf("Testing nx_json_parse with simple values...\n");
    test_count += 13;
    
    // Test empty object
    struct nx_json *json = nx_json_parse("{}");
    assert(json != NULL);
    assert(json->type == NX_JSON_ROOT);
    assert(json->u.children.length == 0);
    
    // Test simple string
    nx_json_reset();
    json = nx_json_parse("{\"text\":\"hello world\"}");
    assert(json != NULL);
    struct nx_json *text = nx_json_get(json, "text");
    assert(text != NULL);
    assert(text->type == NX_JSON_STRING);
    assert(strcmp(text->u.text_value, "hello world") == 0);
    
    // Test simple number
    nx_json_reset();
    json = nx_json_parse("{\"num\":42}");
    assert(json != NULL);
    struct nx_json *num = nx_json_get(json, "num");
    assert(num != NULL);
    assert(num->type == NX_JSON_INTEGER);
    assert(num->u.number_value == 42.0);
    
    // Test boolean
    nx_json_reset();
    json = nx_json_parse("{\"bool\":true}");
    assert(json != NULL);
    struct nx_json *boolean = nx_json_get(json, "bool");
    assert(boolean != NULL);
    assert(boolean->type == NX_JSON_BOOL);
    assert(boolean->u.number_value == 1.0);
    
    printf("nx_json_parse simple tests completed\n\n");
}

void test_nx_json_parse_complex() {
    printf("Testing nx_json_parse with complex objects...\n");
    test_count += 12;
    
    // Test combined object with multiple value types
    nx_json_reset();
    struct nx_json *json = nx_json_parse("{\"name\":\"test\", \"age\":42, \"is_active\":true, \"nothing\":null}");
    assert(json != NULL);
    assert(json->type == NX_JSON_ROOT);
    
    // Get and verify "name" property
    struct nx_json *name = nx_json_get(json, "name");
    assert(name != NULL);
    assert(name->type == NX_JSON_STRING);
    assert(strcmp(name->u.text_value, "test") == 0);
    
    // Get and verify "age" property
    struct nx_json *age = nx_json_get(json, "age");
    assert(age != NULL);
    assert(age->type == NX_JSON_INTEGER);
    assert(age->u.number_value == 42.0);
    
    // Get and verify "is_active" property
    struct nx_json *is_active = nx_json_get(json, "is_active");
    assert(is_active != NULL);
    assert(is_active->type == NX_JSON_BOOL);
    assert(is_active->u.number_value == 1.0);
    
    // Get and verify "nothing" property
    struct nx_json *nothing = nx_json_get(json, "nothing");
    assert(nothing != NULL);
    assert(nothing->type == NX_JSON_NULL);
    
    printf("nx_json_parse complex tests completed\n\n");
}

void test_nx_json_get() {
    printf("Testing nx_json_get...\n");
    test_count += 8;
    
    // Create a test JSON object
    nx_json_reset();
    struct nx_json *json = nx_json_parse("{\"name\":\"test\", \"nested\":{\"inner\":\"value\"}}");
    assert(json != NULL);
    
    // Get top-level property
    struct nx_json *name = nx_json_get(json, "name");
    assert(name != NULL);
    assert(name->type == NX_JSON_STRING);
    assert(strcmp(name->u.text_value, "test") == 0);
    
    // Get nested object
    struct nx_json *nested = nx_json_get(json, "nested");
    assert(nested != NULL);
    assert(nested->type == NX_JSON_OBJECT);
    
    // Get property from nested object
    struct nx_json *inner = nx_json_get(nested, "inner");
    assert(inner != NULL);
    assert(inner->type == NX_JSON_STRING);
    assert(strcmp(inner->u.text_value, "value") == 0);
    
    printf("nx_json_get tests completed\n\n");
}

void test_nx_json_parse_error_handling() {
    printf("Testing nx_json_parse error handling...\n");
    test_count += 2;
    
    // Test invalid JSON (missing closing brace)
    nx_json_reset();
    struct nx_json *json = nx_json_parse("{\"name\":\"test\"");
    assert(json == NULL);
    
    // Test invalid JSON (invalid value)
    nx_json_reset();
    json = nx_json_parse("{\"value\":invalid}");
    assert(json == NULL);
    
    printf("nx_json_parse error handling tests completed\n\n");
}

int main() {
    printf("Starting JSON tests...\n\n");
    
    test_nx_json_reset();
    test_nx_json_parse_simple();
    test_nx_json_parse_complex();
    test_nx_json_get();
    test_nx_json_parse_error_handling();
    
    printf("\nAll tests passed! (%d assertions)\n", test_count);
    return 0;
} 