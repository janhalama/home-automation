#ifndef NX_JSON_H
#define NX_JSON_H

// Check if we're using a standard C compiler
#ifndef PICO_C
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#endif

// Define the JSON node types
enum nx_json_type {
    NX_JSON_NULL,
    NX_JSON_OBJECT,
    NX_JSON_ARRAY,
    NX_JSON_STRING,
    NX_JSON_INTEGER,
    NX_JSON_DOUBLE,
    NX_JSON_BOOL,
    NX_JSON_ROOT
};

// Define the JSON node structure
struct nx_json {
    enum nx_json_type type;
    char *key;
    union json_value {
        char *text_value;
        double number_value;
        struct children_value {
            int length;
            struct nx_json *first;
            struct nx_json *last;
        } children;
    } u;
    struct nx_json *next;
};

// Function prototypes
struct nx_json *nx_json_parse(char *text);
struct nx_json *nx_json_get(struct nx_json *json, char *key);
struct nx_json *nx_json_item(struct nx_json *json, int idx);
void nx_json_dealloc(struct nx_json* js);
void nx_json_reset();

// Error reporting function
void nx_json_report_error(char *msg, char *p);


#endif // NX_JSON_H
