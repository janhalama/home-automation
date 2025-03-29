#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <math.h>
#include "nx_json.h"

// Function to read the entire contents of a file into a string
char* read_file(const char* filename) {
    FILE *file = fopen(filename, "rb");
    if (!file) {
        perror("Could not open file");
        return NULL;
    }

    fseek(file, 0, SEEK_END);
    long length = ftell(file);
    fseek(file, 0, SEEK_SET);

    char *content = (char *)malloc(length + 1);
    if (!content) {
        perror("Could not allocate memory");
        fclose(file);
        return NULL;
    }

    fread(content, 1, length, file);
    content[length] = '\0'; // Null-terminate the string
    fclose(file);

    return content;
}

void test_nx_json_parse() {
    char *sample_json = read_file(MOCK_JSON_PATH);
    if (!sample_json) {
        fprintf(stderr, "Failed to read JSON file\n");
        return;
    }

    struct nx_json *json = nx_json_parse(sample_json);
    if (!json) {
        fprintf(stderr, "Failed to parse JSON\n");
        free(sample_json);
        return;
    }

    // Test scalar values
    struct nx_json *scalar_values = nx_json_get(json, "scalar_values");
    if (!scalar_values) {
        fprintf(stderr, "Failed to find scalar_values in JSON\n");
        nx_json_reset();
        free(sample_json);
        return;
    }
    assert(scalar_values != NULL);

    struct nx_json *integer = nx_json_get(scalar_values, "integer");
    assert(integer != NULL);
    assert(integer->type == NX_JSON_INTEGER);
    assert(integer->u.number_value == 42.0);

    struct nx_json *float_value = nx_json_get(scalar_values, "float");
    assert(float_value != NULL);
    assert(float_value->type == NX_JSON_DOUBLE);
    assert(float_value->u.number_value == 3.14159);

    struct nx_json *string = nx_json_get(scalar_values, "string");
    assert(string != NULL);
    assert(string->type == NX_JSON_STRING);
    assert(strcmp(string->u.text_value, "Hello, World!") == 0);

    struct nx_json *boolean_true = nx_json_get(scalar_values, "boolean_true");
    assert(boolean_true != NULL);
    assert(boolean_true->type == NX_JSON_BOOL);
    assert(boolean_true->u.number_value == 1.0);

    struct nx_json *boolean_false = nx_json_get(scalar_values, "boolean_false");
    assert(boolean_false != NULL);
    assert(boolean_false->type == NX_JSON_BOOL);
    assert(boolean_false->u.number_value == 0.0);

    struct nx_json *null_value = nx_json_get(scalar_values, "null_value");
    assert(null_value != NULL);
    assert(null_value->type == NX_JSON_NULL);

    // Test simple object
    struct nx_json *simple_object = nx_json_get(json, "simple_object");
    assert(simple_object != NULL);

    struct nx_json *name = nx_json_get(simple_object, "name");
    assert(name != NULL);
    assert(name->type == NX_JSON_STRING);
    assert(strcmp(name->u.text_value, "Test Object") == 0);

    struct nx_json *value = nx_json_get(simple_object, "value");
    assert(value != NULL);
    assert(value->type == NX_JSON_INTEGER);
    assert(value->u.number_value == 123.0);

    // Clean up
    nx_json_reset();
    free(sample_json);
    printf("✓ test_nx_json_parse passed\n");
}

int main() {
    test_nx_json_parse();
    return 0;
} 