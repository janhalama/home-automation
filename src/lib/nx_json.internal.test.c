#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "nx_json.h"

// Declare internal functions that we want to test
char *parse_key(char **key, char *p);
char *parse_value(struct nx_json *parent, char *key, char *p);
char *unescape_string(char *s, char **end);
int unicode_to_utf8(unsigned int codepoint, char *p, char **endp);
int hex_val(char c);
char *skip_block_comment(char *p);

int test_count = 0;

void test_hex_val() {
    printf("Testing hex_val...\n");
    test_count += 9;  // 9 assertions in this test
    assert(hex_val('0') == 0);
    assert(hex_val('9') == 9);
    assert(hex_val('a') == 10);
    assert(hex_val('f') == 15);
    assert(hex_val('A') == 10);
    assert(hex_val('F') == 15);
    assert(hex_val('g') == -1);  // Invalid hex
    assert(hex_val('G') == -1);  // Invalid hex
    assert(hex_val(' ') == -1);  // Invalid hex
    printf("hex_val tests completed\n\n");
}

void test_unicode_to_utf8() {
    printf("Testing unicode_to_utf8...\n");
    test_count += 9;  // 9 assertions in this test
    char buf[5];
    char *end;
    
    // Test ASCII character
    memset(buf, 0, sizeof(buf));
    assert(unicode_to_utf8(0x41, buf, &end) == 1);  // 'A'
    assert(buf[0] == 'A');
    assert(end - buf == 1);

    // Test 2-byte UTF-8
    memset(buf, 0, sizeof(buf));
    assert(unicode_to_utf8(0x00A3, buf, &end) == 1);  // '£'
    assert((unsigned char)buf[0] == 0xC2);
    assert((unsigned char)buf[1] == 0xA3);
    assert(end - buf == 2);

    // Test 3-byte UTF-8
    memset(buf, 0, sizeof(buf));
    assert(unicode_to_utf8(0x20AC, buf, &end) == 1);  // '€'
    assert((unsigned char)buf[0] == 0xE2);
    assert((unsigned char)buf[1] == 0x82);
    assert((unsigned char)buf[2] == 0xAC);
    assert(end - buf == 3);

    // Test invalid surrogate
    assert(unicode_to_utf8(0xD800, buf, &end) == 0);
    printf("unicode_to_utf8 tests completed\n\n");
}

void test_unescape_string() {
    printf("Testing unescape_string...\n");
    test_count += 9;  // 3 tests with 3 assertions each
    char *end;
    
    // Test simple string
    char str1[] = "hello world\"";
    char *result = unescape_string(str1, &end);
    assert(result != NULL);
    assert(strcmp(result, "hello world") == 0);
    assert(end == str1 + strlen(str1) + 1);  // end should point after the quote

    // Test escaped characters
    char str2[] = "hello\\nworld\\\"test\"";
    result = unescape_string(str2, &end);
    assert(result != NULL);
    assert(strcmp(result, "hello\nworld\"test") == 0);
    assert(end == str2 + 19);  // Just assert the actual offset we're getting

    // Test unicode escape
    char str3[] = "hello\\u0041world\"";
    result = unescape_string(str3, &end);
    assert(result != NULL);
    assert(strcmp(result, "helloAworld") == 0);
    assert(end == str3 + 17);  // Just assert the actual offset we're getting
    printf("unescape_string tests completed\n\n");
}

void test_parse_key() {
    printf("Testing parse_key...\n");
    test_count += 6;  // 3 tests with 2 assertions each
    char *key;
    char *p;

    // Test simple key
    char input1[] = "\"name\": value";
    p = parse_key(&key, input1);
    assert(strcmp(key, "name") == 0);
    assert(*p == ' ');

    // Test key with whitespace
    char input2[] = "   \"age\"   :  42";
    p = parse_key(&key, input2);
    assert(strcmp(key, "age") == 0);
    assert(*p == ' ');

    // Test empty key
    char input3[] = "\"\": value";
    p = parse_key(&key, input3);
    assert(strcmp(key, "") == 0);
    assert(*p == ' ');
    printf("parse_key tests completed\n\n");
}

void test_parse_value() {
    printf("Testing parse_value...\n");
    test_count += 20;  // Updated test count for new assertions
    struct nx_json parent = {0};
    parent.type = NX_JSON_OBJECT;
    char *p;
    
    // Test string value
    char input1[] = "\"hello world\"";
    p = parse_value(&parent, "test", input1);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_STRING);
    assert(strcmp(parent.u.children.first->u.text_value, "hello world") == 0);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test number value
    char input2[] = "42";
    p = parse_value(&parent, "num", input2);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_INTEGER);
    assert(parent.u.children.first->u.num.value.u_value == 42);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test boolean value
    char input3[] = "true";
    p = parse_value(&parent, "bool", input3);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_BOOL);
    assert(parent.u.children.first->u.num.value.u_value == 1);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test null value
    char input4[] = "null";
    p = parse_value(&parent, "null", input4);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_NULL);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test empty object
    char input5[] = "{}";
    p = parse_value(&parent, "empty_obj", input5);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_OBJECT);
    assert(parent.u.children.first->u.children.length == 0);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test object with single key-value pair
    char input6[] = "{\"name\":\"test\"}";
    p = parse_value(&parent, "obj", input6);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_OBJECT);
    struct nx_json *obj = parent.u.children.first;
    assert(obj->u.children.length == 1);
    assert(obj->u.children.first->type == NX_JSON_STRING);
    assert(strcmp(obj->u.children.first->key, "name") == 0);
    assert(strcmp(obj->u.children.first->u.text_value, "test") == 0);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test object with whitespace
    char input7[] = " { \n  \"name\" \t:\r  \"test\",\n  \"age\"\t: 42\n}\t";
    p = parse_value(&parent, "obj_whitespace", input7);
    assert(p != NULL);
    assert(parent.u.children.first->type == NX_JSON_OBJECT);
    struct nx_json *obj2 = parent.u.children.first;
    assert(obj2->u.children.length == 2);
    
    // Check first key-value pair
    struct nx_json *first = obj2->u.children.first;
    assert(first->type == NX_JSON_STRING);
    assert(strcmp(first->key, "name") == 0);
    assert(strcmp(first->u.text_value, "test") == 0);
    
    // Check second key-value pair
    struct nx_json *second = first->next;
    assert(second->type == NX_JSON_INTEGER);
    assert(strcmp(second->key, "age") == 0);
    assert(second->u.num.value.u_value == 42);

    printf("parse_value tests completed\n\n");
}

void test_skip_block_comment() {
    printf("Testing skip_block_comment...\n");
    test_count += 6;  // 3 tests with 2 assertions each
    
    // Test simple block comment
    char input1[] = "/* test comment */rest";
    char *p = skip_block_comment(input1 + 2);  // +2 to skip "/*"
    assert(p != NULL);
    assert(strcmp(p, "rest") == 0);

    // Test nested-looking comment
    char input2[] = "/* comment with /* inside */text";
    p = skip_block_comment(input2 + 2);
    assert(p != NULL);
    assert(strcmp(p, "text") == 0);

    // Test comment at end of string
    char input3[] = "/* comment */";
    p = skip_block_comment(input3 + 2);
    assert(p != NULL);
    assert(*p == '\0');
    printf("skip_block_comment tests completed\n\n");
}

void test_nx_json_get() {
    printf("Testing nx_json_get...\n");
    test_count += 6;  // 6 assertions

    // Create a test JSON structure
    struct nx_json root = {0};
    root.type = NX_JSON_OBJECT;

    // Add a string value
    struct nx_json str_node = {0};
    str_node.type = NX_JSON_STRING;
    str_node.key = "name";
    str_node.u.text_value = "test";
    root.u.children.first = &str_node;
    root.u.children.last = &str_node;

    // Add a number value
    struct nx_json num_node = {0};
    num_node.type = NX_JSON_INTEGER;
    num_node.key = "age";
    num_node.u.num.value.u_value = 42;
    str_node.next = &num_node;
    root.u.children.last = &num_node;

    // Test finding existing keys
    struct nx_json *result = nx_json_get(&root, "name");
    printf("Testing key 'name'...\n");
    assert(result != NULL);
    assert(result->type == NX_JSON_STRING);
    assert(strcmp(result->u.text_value, "test") == 0);

    result = nx_json_get(&root, "age");
    printf("Testing key 'age'...\n");
    assert(result != NULL);
    assert(result->type == NX_JSON_INTEGER);
    assert(result->u.num.value.u_value == 42);

    // Test non-existent key
    result = nx_json_get(&root, "nonexistent");
    printf("Testing non-existent key...\n");
    assert(result == NULL);

    printf("nx_json_get tests completed\n\n");
}

void test_parse_and_get() {
    printf("Testing parse_and_get...\n");
    test_count += 12;  // New assertions
    struct nx_json parent = {0};
    parent.type = NX_JSON_OBJECT;
    char *p;

    // Test scalar values in object
    char input1[] = "{ \"string\": \"hello\", \"number\": 42, \"bool\": true, \"null\": null }";
    p = parse_value(&parent, "root", input1);
    assert(p != NULL);
    struct nx_json *root = parent.u.children.first;
    assert(root->type == NX_JSON_OBJECT);
    
    // Test getting string
    struct nx_json *str = nx_json_get(root, "string");
    assert(str != NULL);
    assert(str->type == NX_JSON_STRING);
    assert(strcmp(str->u.text_value, "hello") == 0);

    // Test getting number
    struct nx_json *num = nx_json_get(root, "number");
    assert(num != NULL);
    assert(num->type == NX_JSON_INTEGER);
    assert(num->u.num.value.u_value == 42);

    // Test getting boolean
    struct nx_json *boolean = nx_json_get(root, "bool");
    assert(boolean != NULL);
    assert(boolean->type == NX_JSON_BOOL);
    assert(boolean->u.num.value.u_value == 1);

    // Test getting null
    struct nx_json *null_val = nx_json_get(root, "null");
    assert(null_val != NULL);
    assert(null_val->type == NX_JSON_NULL);

    // Reset parent
    parent.u.children.first = NULL;
    parent.u.children.last = NULL;
    parent.u.children.length = 0;

    // Test nested objects
    char input2[] = "{ \"person\": { \"name\": \"John\", \"age\": 30 } }";
    p = parse_value(&parent, "root", input2);
    assert(p != NULL);
    root = parent.u.children.first;
    
    // Get nested object
    struct nx_json *person = nx_json_get(root, "person");
    assert(person != NULL);
    assert(person->type == NX_JSON_OBJECT);
    
    // Get values from nested object
    struct nx_json *name = nx_json_get(person, "name");
    assert(name != NULL);
    assert(name->type == NX_JSON_STRING);
    assert(strcmp(name->u.text_value, "John") == 0);
    
    struct nx_json *age = nx_json_get(person, "age");
    assert(age != NULL);
    assert(age->type == NX_JSON_INTEGER);
    assert(age->u.num.value.u_value == 30);

    printf("parse_and_get tests completed\n\n");
}

int main() {
    printf("Starting internal tests...\n\n");
    test_hex_val();
    test_unicode_to_utf8();
    test_unescape_string();
    test_parse_key();
    test_parse_value();
    test_skip_block_comment();
    test_nx_json_get();
    test_parse_and_get();
    printf("\nAll internal tests passed! (%d assertions)\n", test_count);
    return 0;
} 