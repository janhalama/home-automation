#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "../nx_json.h"

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
    char *sample_json = read_file("test/simple-json-samples.json");
    if (!sample_json) {
        fprintf(stderr, "Failed to read JSON file\n");
        return;
    }

    struct nx_json *json = nx_json_parse(sample_json);
    assert(json != NULL);

    // Test scalar values
    struct nx_json *scalar_values = nx_json_get(json, "scalar_values");
    assert(scalar_values != NULL);

    struct nx_json *integer = nx_json_get(scalar_values, "integer");
    assert(integer != NULL);
    assert(integer->type == NX_JSON_INTEGER);
    assert(integer->num.u_value == 42);

    struct nx_json *float_value = nx_json_get(scalar_values, "float");
    assert(float_value != NULL);
    assert(float_value->type == NX_JSON_DOUBLE);
    assert(float_value->num.dbl_value == 3.14159);

    struct nx_json *string = nx_json_get(scalar_values, "string");
    assert(string != NULL);
    assert(string->type == NX_JSON_STRING);
    assert(strcmp(string->text_value, "Hello, World!") == 0);

    struct nx_json *boolean_true = nx_json_get(scalar_values, "boolean_true");
    assert(boolean_true != NULL);
    assert(boolean_true->type == NX_JSON_BOOL);
    assert(boolean_true->num.u_value == 1);

    struct nx_json *boolean_false = nx_json_get(scalar_values, "boolean_false");
    assert(boolean_false != NULL);
    assert(boolean_false->type == NX_JSON_BOOL);
    assert(boolean_false->num.u_value == 0);

    struct nx_json *null_value = nx_json_get(scalar_values, "null_value");
    assert(null_value != NULL);
    assert(null_value->type == NX_JSON_NULL);

    // Test simple object
    struct nx_json *simple_object = nx_json_get(json, "simple_object");
    assert(simple_object != NULL);

    struct nx_json *name = nx_json_get(simple_object, "name");
    assert(name != NULL);
    assert(name->type == NX_JSON_STRING);
    assert(strcmp(name->text_value, "Test Object") == 0);

    struct nx_json *value = nx_json_get(simple_object, "value");
    assert(value != NULL);
    assert(value->type == NX_JSON_INTEGER);
    assert(value->num.u_value == 123);

    struct nx_json *nested_object = nx_json_get(simple_object, "nested_object");
    assert(nested_object != NULL);

    struct nx_json *nested_key = nx_json_get(nested_object, "nested_key");
    assert(nested_key != NULL);
    assert(nested_key->type == NX_JSON_STRING);
    assert(strcmp(nested_key->text_value, "nested_value") == 0);

    // Test simple array
    struct nx_json *simple_array = nx_json_get(json, "simple_array");
    assert(simple_array != NULL);

    for (int i = 0; i < 5; i++) {
        struct nx_json *item = nx_json_item(simple_array, i);
        assert(item != NULL);
        assert(item->type == NX_JSON_INTEGER);
        assert(item->num.u_value == i + 1);
    }

    // Test array of objects
    struct nx_json *array_of_objects = nx_json_get(json, "array_of_objects");
    assert(array_of_objects != NULL);

    struct nx_json *first_object = nx_json_item(array_of_objects, 0);
    assert(first_object != NULL);

    struct nx_json *id1 = nx_json_get(first_object, "id");
    assert(id1 != NULL);
    assert(id1->type == NX_JSON_INTEGER);
    assert(id1->num.u_value == 1);

    struct nx_json *name1 = nx_json_get(first_object, "name");
    assert(name1 != NULL);
    assert(name1->type == NX_JSON_STRING);
    assert(strcmp(name1->text_value, "Object 1") == 0);

    struct nx_json *second_object = nx_json_item(array_of_objects, 1);
    assert(second_object != NULL);

    struct nx_json *id2 = nx_json_get(second_object, "id");
    assert(id2 != NULL);
    assert(id2->type == NX_JSON_INTEGER);
    assert(id2->num.u_value == 2);

    struct nx_json *name2 = nx_json_get(second_object, "name");
    assert(name2 != NULL);
    assert(name2->type == NX_JSON_STRING);
    assert(strcmp(name2->text_value, "Object 2") == 0);

    // Test mixed array
    struct nx_json *mixed_array = nx_json_get(json, "mixed_array");
    assert(mixed_array != NULL);

    struct nx_json *mixed_string = nx_json_item(mixed_array, 0);
    assert(mixed_string != NULL);
    assert(mixed_string->type == NX_JSON_STRING);
    assert(strcmp(mixed_string->text_value, "string") == 0);

    struct nx_json *mixed_integer = nx_json_item(mixed_array, 1);
    assert(mixed_integer != NULL);
    assert(mixed_integer->type == NX_JSON_INTEGER);
    assert(mixed_integer->num.u_value == 100);

    struct nx_json *mixed_boolean = nx_json_item(mixed_array, 2);
    assert(mixed_boolean != NULL);
    assert(mixed_boolean->type == NX_JSON_BOOL);
    assert(mixed_boolean->num.u_value == 1);

    struct nx_json *mixed_null = nx_json_item(mixed_array, 3);
    assert(mixed_null != NULL);
    assert(mixed_null->type == NX_JSON_NULL);

    struct nx_json *mixed_object = nx_json_item(mixed_array, 4);
    assert(mixed_object != NULL);

    struct nx_json *mixed_key = nx_json_get(mixed_object, "key");
    assert(mixed_key != NULL);
    assert(mixed_key->type == NX_JSON_STRING);
    assert(strcmp(mixed_key->text_value, "value") == 0);

    // Clean up
    nx_json_free(json);
    free(sample_json);
    printf("All tests passed!\n");
}

int main() {
    test_nx_json_parse();
    return 0;
} 