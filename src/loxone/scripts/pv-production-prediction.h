#ifndef NX_JSON_H
#define NX_JSON_H

#include <stdlib.h>
#include <string.h>
#include <assert.h>

// Define the JSON node types
enum nx_json_type {
    NX_JSON_NULL,
    NX_JSON_OBJECT,
    NX_JSON_ARRAY,
    NX_JSON_STRING,
    NX_JSON_INTEGER,
    NX_JSON_DOUBLE,
    NX_JSON_BOOL
};

// Define the JSON node structure
struct nx_json {
    enum nx_json_type type;
    char *key;
    union data {
        char *text_value;
        struct num {
            union value {
                unsigned long u_value;
                unsigned long s_value;
            };
            double dbl_value;
        } num;
        struct children {
            int length;
            struct nx_json *first;
            struct nx_json *last;
        } children;
    };
    struct nx_json *next;
};

// Function prototypes
struct nx_json *nx_json_parse(char *text);
struct nx_json *nx_json_get(struct nx_json *json, char *key);
struct nx_json *nx_json_item(struct nx_json *json, int idx);
void nx_json_free(struct nx_json *js);

// Error reporting function
void nx_json_report_error(char *msg, char *p);

#endif // NX_JSON_H 