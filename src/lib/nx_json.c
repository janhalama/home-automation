// Check if we're using a standard C compiler
#ifndef PICO_C
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "nx_json.h"
#endif

// Define maximum sizes for fixed arrays
#define MAX_JSON_NODES 20  // Maximum number of JSON nodes
#define MAX_STRING_LENGTH 1024  // Maximum length for strings

// Global arrays for fixed allocation
struct nx_json json_nodes[MAX_JSON_NODES];
int json_nodes_used = 0;

// String buffer for storing keys and string values
char string_buffer[MAX_STRING_LENGTH];
int string_buffer_used = 0;

// Define a simple stack for tracking parent nodes
#define MAX_NESTING_DEPTH 10  // Maximum nesting depth for objects and arrays

// Context stack for tracking parent nodes during parsing
struct nx_json* parent_stack[MAX_NESTING_DEPTH];
int stack_depth = 0;

// Reset all global storage
void nx_json_reset() {
    json_nodes_used = 0;
    string_buffer_used = 0;
}

// Helper function implementations
int skip_whitespace(char *p) {
    int i = 0;
    while (p[i] && (p[i] == ' ' || p[i] == '\t' || p[i] == '\n' || p[i] == '\r')) {
        i++;
    }
    return i;
}

void nx_json_report_error(char *msg, char *p) {
    char error_message[256];
    snprintf(error_message, sizeof(error_message), "NXJSON ERROR: %s at %s", msg, p);
#ifdef PICO_C
    setoutputtext(2, error_message);  // This is a Loxone function
#else
    fprintf(stderr, "%s\n", error_message);
#endif
}

struct nx_json *create_json(enum nx_json_type type, char *key, struct nx_json *parent) {
    // Check if we have space for a new node
    if (json_nodes_used >= MAX_JSON_NODES) {
        return NULL; // No more nodes available
    }
    
    // Get the next available node from the global array
    struct nx_json *js = &json_nodes[json_nodes_used++];
    
    // Basic initialization - no need for memset, we set all fields directly
    js->type = type;
    js->key = key;
    js->next = NULL;
    js->u.children.first = NULL;
    js->u.children.last = NULL;
    js->u.children.length = 0;

    // Add to parent's children list if parent exists
    if (parent != NULL) {
        if (parent->u.children.first == NULL) {
            parent->u.children.first = js;
        }
        if (parent->u.children.last != NULL) {
            parent->u.children.last->next = js;
        }
        parent->u.children.last = js;
        parent->u.children.length++;
    }

    return js;
}

// Special handling for known test value to ensure exact comparison in tests
void parse_numeric_value(char *p, struct nx_json *js) {
    // Keep track of the original start pointer for atof
    char *start = p;
    
    // Default to integer or double type based on content
    js->type = NX_JSON_INTEGER;
    
    // Check for decimal point or exponent to determine type
    char *check = p;
    while (*check && (*check != ',' && *check != '}' && *check != ']' && *check != ' ')) {
        if (*check == '.' || *check == 'e' || *check == 'E') {
            js->type = NX_JSON_DOUBLE;
            break;
        }
        check++;
    }
    
    // Parse the value as double in either case
    js->u.number_value = atof(start);
}

// Simple parser for boolean and null values
void parse_keyword_value(char *p, struct nx_json *js) {
    if (strncmp(p, "true", 4) == 0) {
        js->type = NX_JSON_BOOL;
        js->u.number_value = 1.0;
    } else if (strncmp(p, "false", 5) == 0) {
        js->type = NX_JSON_BOOL;
        js->u.number_value = 0.0;
    } else if (strncmp(p, "null", 4) == 0) {
        js->type = NX_JSON_NULL;
    }
}

// Simplify the string parsing to not handle Unicode and complex escaping
char* parse_string(char *p, char **value) {
    if (*p != '"') return NULL;
    p++; // Skip opening quote
    
    char *start = p;
    while (*p && *p != '"') {
        // Handle simple escape sequences
        if (*p == '\\' && *(p+1)) {
            p += 2;
        } else {
            p++;
        }
    }
    
    if (*p != '"') {
        nx_json_report_error("Unterminated string", start);
        return NULL;
    }
    
    // Check if we have enough space in the string buffer
    int length = p - start;
    if (string_buffer_used + length + 1 > MAX_STRING_LENGTH) {
        nx_json_report_error("String buffer full", start);
        return NULL;
    }
    
    // Copy directly to the string buffer
    char* result = &string_buffer[string_buffer_used];
    memcpy(result, start, length);
    result[length] = '\0';  // Null terminate
    
    string_buffer_used += length + 1;
    *value = result;
    
    return p + 1; // Skip closing quote
}

// Helper function to parse scalar values (string, number, boolean, null)
char* parse_scalar_value(struct nx_json *parent, char *key, char *p) {
    struct nx_json *js = NULL;
    
    if (*p == '"') {
        // String
        js = create_json(NX_JSON_STRING, key, parent);
        if (js == NULL) return NULL;
        
        p = parse_string(p, &js->u.text_value);
        if (p == NULL) return NULL;
    } else if ((*p >= '0' && *p <= '9') || *p == '-') {
        // Number
        js = create_json(NX_JSON_INTEGER, key, parent);
        if (js == NULL) return NULL;
        
        parse_numeric_value(p, js);
        
        // Skip to end of number
        while ((*p >= '0' && *p <= '9') || *p == '.' || *p == '-' || 
               *p == '+' || *p == 'e' || *p == 'E') {
            p++;
        }
    } else if (*p == 't' || *p == 'f' || *p == 'n') {
        // Boolean or null
        js = create_json(NX_JSON_NULL, key, parent);
        if (js == NULL) return NULL;
        
        parse_keyword_value(p, js);
        
        // Skip keyword
        if (*p == 't') p += 4; // true
        else if (*p == 'f') p += 5; // false
        else p += 4; // null
    } else {
        nx_json_report_error("Unexpected character in value", p);
        return NULL;
    }
    
    return p;
}

// Parse JSON with support for two-level nested objects
struct nx_json* nx_json_parse(char* text) {
    if (text == NULL) return NULL;
    
    // Reset global state
    nx_json_reset();
    
    // Skip whitespace
    text += skip_whitespace(text);
    
    if (*text != '{') {
        nx_json_report_error("JSON must start with '{'", text);
        return NULL;
    }
    
    // Create root object node
    struct nx_json* root = create_json(NX_JSON_ROOT, NULL, NULL);
    if (root == NULL) return NULL;
    
    // Move past opening brace
    text++;
    text += skip_whitespace(text);
    
    // Handle empty object
    if (*text == '}') {
        return root;
    }
    
    // Parse key-value pairs at top level
    while (*text) {
        // Parse key
        char *key;
        text += skip_whitespace(text);
        
        if (*text != '"') {
            nx_json_report_error("Expected string key", text);
            nx_json_reset();
            return NULL;
        }
        
        text = parse_string(text, &key);
        if (text == NULL) {
            nx_json_reset();
            return NULL;
        }
        
        // Skip whitespace and expect colon
        text += skip_whitespace(text);
        if (*text != ':') {
            nx_json_report_error("Expected ':' after key", text);
            nx_json_reset();
            return NULL;
        }
        text++; // Skip colon
        text += skip_whitespace(text);
        
        // Parse value based on first character
        if (*text == '"') {
            // String value
            struct nx_json *js = create_json(NX_JSON_STRING, key, root);
            if (js == NULL) {
                nx_json_reset();
                return NULL;
            }
            
            text = parse_string(text, &js->u.text_value);
            if (text == NULL) {
                nx_json_reset();
                return NULL;
            }
        } else if ((*text >= '0' && *text <= '9') || *text == '-') {
            // Number value
            struct nx_json *js = create_json(NX_JSON_INTEGER, key, root);
            if (js == NULL) {
                nx_json_reset();
                return NULL;
            }
            
            parse_numeric_value(text, js);
            
            // Skip to end of number
            while ((*text >= '0' && *text <= '9') || *text == '.' || *text == '-' || 
                  *text == '+' || *text == 'e' || *text == 'E') {
                text++;
            }
        } else if (*text == 't' || *text == 'f' || *text == 'n') {
            // Boolean or null value
            struct nx_json *js = create_json(NX_JSON_NULL, key, root);
            if (js == NULL) {
                nx_json_reset();
                return NULL;
            }
            
            parse_keyword_value(text, js);
            
            // Skip keyword
            if (*text == 't') text += 4;      // true
            else if (*text == 'f') text += 5; // false
            else text += 4;                   // null
        } else if (*text == '{') {
            // Object value - parse one level down for second level
            struct nx_json *js = create_json(NX_JSON_OBJECT, key, root);
            if (js == NULL) {
                nx_json_reset();
                return NULL;
            }
            
            // Parse second-level object contents
            text++; // Skip opening brace
            text += skip_whitespace(text);
            
            // Handle empty object
            if (*text == '}') {
                text++; // Skip closing brace
            } else {
                // Parse key-value pairs in second-level object
                while (*text) {
                    // Parse second-level key
                    char *inner_key;
                    struct nx_json *inner_js = NULL; // Move declaration here, outside of conditional blocks
                    
                    if (*text != '"') {
                        nx_json_report_error("Expected string key in nested object", text);
                        nx_json_reset();
                        return NULL;
                    }
                    
                    text = parse_string(text, &inner_key);
                    if (text == NULL) {
                        nx_json_reset();
                        return NULL;
                    }
                    
                    // Skip whitespace and expect colon
                    text += skip_whitespace(text);
                    if (*text != ':') {
                        nx_json_report_error("Expected ':' after key in nested object", text);
                        nx_json_reset();
                        return NULL;
                    }
                    text++; // Skip colon
                    text += skip_whitespace(text);
                    
                    // Parse second-level value
                    if (*text == '"') {
                        // String value
                        inner_js = create_json(NX_JSON_STRING, inner_key, js);
                        if (inner_js == NULL) {
                            nx_json_reset();
                            return NULL;
                        }
                        
                        text = parse_string(text, &inner_js->u.text_value);
                        if (text == NULL) {
                            nx_json_reset();
                            return NULL;
                        }
                    } else if ((*text >= '0' && *text <= '9') || *text == '-') {
                        // Number value
                        inner_js = create_json(NX_JSON_INTEGER, inner_key, js);
                        if (inner_js == NULL) {
                            nx_json_reset();
                            return NULL;
                        }
                        
                        parse_numeric_value(text, inner_js);
                        
                        // Skip to end of number
                        while ((*text >= '0' && *text <= '9') || *text == '.' || *text == '-' || 
                              *text == '+' || *text == 'e' || *text == 'E') {
                            text++;
                        }
                    } else if (*text == 't' || *text == 'f' || *text == 'n') {
                        // Boolean or null value
                        inner_js = create_json(NX_JSON_NULL, inner_key, js);
                        if (inner_js == NULL) {
                            nx_json_reset();
                            return NULL;
                        }
                        
                        parse_keyword_value(text, inner_js);
                        
                        // Skip keyword
                        if (*text == 't') text += 4;      // true
                        else if (*text == 'f') text += 5; // false
                        else text += 4;                   // null
                    } else if (*text == '{' || *text == '[') {
                        // Skip nested objects or arrays within second level
                        int depth = 1;
                        
                        // Create placeholder node
                        enum nx_json_type type; 
                        if (*text == '{') {
                            type = NX_JSON_OBJECT;
                        } else {
                            type = NX_JSON_ARRAY;
                        }
                        inner_js = create_json(type, inner_key, js);
                        if (inner_js == NULL) {
                            nx_json_reset();
                            return NULL;
                        }
                        
                        text++; // Skip opening brace/bracket
                        
                        // Skip until matching closing brace/bracket
                        while (*text && depth > 0) {
                            if (*text == '{') {
                                depth++; // Opening brace increases depth
                            } else if (*text == '[') {
                                depth++; // Opening bracket increases depth
                            } else if (*text == '}') {
                                depth--; // Closing brace decreases depth
                            } else if (*text == ']') {
                                depth--; // Closing bracket decreases depth
                            } else if (*text == '"') {
                                // Skip string content properly
                                text++;
                                while (*text && *text != '"') {
                                    if (*text == '\\' && *(text+1)) text++; // Skip escape sequence
                                    text++;
                                }
                                if (*text != '"') {
                                    nx_json_report_error("Unterminated string", text);
                                    nx_json_reset();
                                    return NULL;
                                }
                            }
                            text++;
                        }
                        
                        if (depth != 0) {
                            nx_json_report_error("Unterminated object/array", text);
                            nx_json_reset();
                            return NULL;
                        }
                    } else {
                        nx_json_report_error("Unexpected character in nested object value", text);
                        nx_json_reset();
                        return NULL;
                    }
                    
                    // Skip whitespace after value
                    text += skip_whitespace(text);
                    
                    // Expect comma or closing brace
                    if (*text == '}') {
                        text++; // Skip closing brace
                        break;
                    } else if (*text == ',') {
                        text++; // Skip comma
                        text += skip_whitespace(text);
                    } else {
                        nx_json_report_error("Expected ',' or '}' in nested object", text);
                        nx_json_reset();
                        return NULL;
                    }
                }
            }
        } else if (*text == '[') {
            // Array value - create placeholder and skip contents
            struct nx_json *js = create_json(NX_JSON_ARRAY, key, root);
            if (js == NULL) {
                nx_json_reset();
                return NULL;
            }
            
            // Skip past the array without parsing it
            int bracket_depth = 1;
            text++; // Skip opening bracket
            
            while (*text && bracket_depth > 0) {
                if (*text == '[') bracket_depth++;
                else if (*text == ']') bracket_depth--;
                else if (*text == '"') {
                    // Skip string content properly
                    text++;
                    while (*text && *text != '"') {
                        if (*text == '\\' && *(text+1)) text++; // Skip escape sequence
                        text++;
                    }
                    if (*text != '"') {
                        nx_json_report_error("Unterminated string", text);
                        nx_json_reset();
                        return NULL;
                    }
                }
                text++;
            }
            
            if (bracket_depth != 0) {
                nx_json_report_error("Unterminated array", text);
                nx_json_reset();
                return NULL;
            }
        } else {
            nx_json_report_error("Unexpected character in value", text);
            nx_json_reset();
            return NULL;
        }
        
        // Skip whitespace after value
        text += skip_whitespace(text);
        
        // Expect comma or closing brace
        if (*text == '}') {
            text++; // Skip closing brace
            break;
        } else if (*text == ',') {
            text++; // Skip comma
            text += skip_whitespace(text);
        } else {
            nx_json_report_error("Expected ',' or '}'", text);
            nx_json_reset();
            return NULL;
        }
    }
    
    return root;
}

// Get a child node by key from a JSON object or array
struct nx_json* nx_json_get(struct nx_json* json, char* key) {
    if (json == NULL || key == NULL) return NULL;
    
    // Only objects and arrays (and the root node) can have children
    if (json->type != NX_JSON_OBJECT && json->type != NX_JSON_ARRAY && json->type != NX_JSON_ROOT) {
        return NULL;
    }
    
    // Start with the first child
    struct nx_json* current = json->u.children.first;
    
    // Iterate through all children
    while (current != NULL) {
        if (current->key != NULL && strcmp(current->key, key) == 0) {
            return current;
        }
        
        current = current->next;
    }
    
    // Key not found
    return NULL;
}

// Get an element from an array by index
struct nx_json* nx_json_item(struct nx_json *json, int idx) {
    if (json == NULL) return NULL;
    
    if (json->type != NX_JSON_ARRAY) {
        return NULL; // Not an array
    }
    
    // Find the element by iterating through the children
    struct nx_json *current = json->u.children.first;
    int current_idx = 0;
    
    while (current != NULL) {
        if (current_idx == idx) {
            return current;
        }
        
        current = current->next;
        current_idx++;
    }
    
    return NULL; // Index out of bounds
}