// Check if we're using a standard C compiler
#ifndef PICO_C
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "nx_json.h"
#endif

void nx_json_report_error(char *msg, char *p) {
    char safe_msg[100]; // Temporary buffer for the message
    char safe_p[100];   // Temporary buffer for the pointer
    char error_message[1024];    // Add this line to define debug buffer

    // Truncate msg if necessary
    if (strlen(msg) >= sizeof(safe_msg)) {
        strncpy(safe_msg, msg, sizeof(safe_msg) - 1);
        safe_msg[sizeof(safe_msg) - 1] = '\0'; // Ensure null termination
    } else {
        strcpy(safe_msg, msg);
    }

    // Truncate p if necessary
    if (strlen(p) >= sizeof(safe_p)) {
        strncpy(safe_p, p, sizeof(safe_p) - 1);
        safe_p[sizeof(safe_p) - 1] = '\0'; // Ensure null termination
    } else {
        strcpy(safe_p, p);
    }

    // Format the error message safely
    snprintf(error_message, sizeof(error_message), "NXJSON PARSE ERROR: %s at %s\n", safe_msg, safe_p);
#ifdef PICO_C
    setoutputtext(2, error_message);  // This is a Loxone function
#else
    fprintf(stderr, "%s", error_message);  // Use standard error output in non-Pico environment
#endif
}

void nx_json_dealloc(struct nx_json* js) {
#ifdef PICO_C
    free(js);  // PicoC free
#else
    free((void*)js);
#endif
}

struct nx_json *create_json(enum nx_json_type type, char *key, struct nx_json *parent) {
    // More defensive parent check
    if (parent == NULL) {
        return NULL;
    }

    // Allocate new node
    struct nx_json *js = (struct nx_json*)calloc(1, sizeof(struct nx_json));
    if (js == NULL) {
        return NULL;
    }

    // Basic initialization only
    js->type = type;
    js->key = key;
    js->next = NULL;
    js->u.children.first = NULL;
    js->u.children.last = NULL;
    js->u.children.length = 0;

    // Add to parent's children list
    if (parent->u.children.first == NULL) {
        parent->u.children.first = js;
    }
    if (parent->u.children.last != NULL) {
        parent->u.children.last->next = js;
    }
    parent->u.children.last = js;
    parent->u.children.length++;

    return js;
}

void nx_json_free(struct nx_json *js) {
    if (js == NULL) {
        return;
    }
    
    struct nx_json *current = js;
    struct nx_json *next = NULL;
    struct nx_json *stack[100]; // Stack to keep track of nodes to process
    int stack_top = 0;
    
    stack[stack_top++] = current;
    
    while (stack_top > 0) {
        current = stack[--stack_top];
        
        if (current->type == NX_JSON_OBJECT || current->type == NX_JSON_ARRAY) {
            // Process all children
            next = current->u.children.first;
            
            // Mark this node as processed by setting children to NULL
            current->u.children.first = NULL;
            
            if (next == NULL) {
                // No children, free this node
                nx_json_dealloc(current);
            } else {
                // Push this node back to process after its children
                stack[stack_top++] = current;
                
                // Push all children to the stack in reverse order
                // so they get processed in the original order
                struct nx_json *children[50]; // Temporary array to reverse children
                int child_count = 0;
                
                while (next != NULL) {
                    children[child_count++] = next;
                    next = next->next;
                }
                
                // Push children to stack in reverse order
                for (int i = child_count - 1; i >= 0; i--) {
                    stack[stack_top++] = children[i];
                }
            }
        } else {
            // Leaf node, just free it
            nx_json_dealloc(current);
        }
    }
}

int unicode_to_utf8(unsigned int codepoint, char *p, char **endp) {
	// code from http://stackoverflow.com/a/4609989/697313
	if (codepoint < 0x80) *p++ = codepoint;
	else if (codepoint < 0x800) {
        *p++ = 192 + codepoint / 64;
        *p++ = 128 + codepoint % 64;
    }
	else if (codepoint - 0xd800u < 0x800) return 0; // surrogate must have been treated earlier
	else if (codepoint < 0x10000) {
        *p++ = 224 + codepoint / 4096;
        *p++ = 128 + codepoint / 64 % 64;
        *p++ = 128 + codepoint % 64;
    }
	else if (codepoint < 0x110000) {
		*p++ = 240 + codepoint / 262144;
        *p++ = 128 + codepoint / 4096 % 64;
        *p++ = 128 + codepoint / 64 % 64;
        *p++ = 128 + codepoint % 64;
    }
	else return 0; // error
	*endp = p;
	return 1;
}

int hex_val(char c) {
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

char *unescape_string(char *s, char **end) {
    char *p = s;
    char *d = s;
    char c;
    char *ps;  // Pointer for error reporting
    int h1, h2, h3, h4;
    unsigned int codepoint;
    unsigned int codepoint2;

    while(1) {
        c = *p++;
        if (c == '\0') {
            nx_json_report_error("unescape_string:no closing quote for string", s);
            return NULL;
        }
        
        if (c == '"') {
            *d = '\0';
            *end = p;
            return s;
        } else if (c == '\\') {
            switch (*p) {
            case '\\':
            case '/':
            case '"':
                *d++ = *p++;
                break;
            case 'b':
                *d++ = '\b';
                p++;
                break;
            case 'f':
                *d++ = '\f';
                p++;
                break;
            case 'n':
                *d++ = '\n';
                p++;
                break;
            case 'r':
                *d++ = '\r';
                p++;
                break;
            case 't':
                *d++ = '\t';
                p++;
                break;
            case 'u': // unicode
                ps = p - 1;
                
                // Check if we have enough characters for a unicode escape
                if (p[1] == '\0' || p[2] == '\0' || p[3] == '\0' || p[4] == '\0') {
                    nx_json_report_error("unescape_string:incomplete unicode escape", ps);
                    return NULL;
                }
                
                // Parse first unicode character
                if ((h1 = hex_val(p[1])) < 0 || (h2 = hex_val(p[2])) < 0 || 
                    (h3 = hex_val(p[3])) < 0 || (h4 = hex_val(p[4])) < 0) {
                    nx_json_report_error("unescape_string:invalid unicode escape", ps);
                    return NULL;
                }
                
                codepoint = h1 << 12 | h2 << 8 | h3 << 4 | h4;
                p += 5;
                
                // Handle surrogate pairs
                if ((codepoint & 0xfc00) == 0xd800) { // high surrogate
                    // Need a low surrogate to follow
                    if (p[0] != '\\' || p[1] != 'u') {
                        nx_json_report_error("unescape_string:expected low surrogate", ps);
                        return NULL;
                    }
                    
                    // Check if we have enough characters for the second unicode escape
                    if (p[2] == '\0' || p[3] == '\0' || p[4] == '\0' || p[5] == '\0') {
                        nx_json_report_error("unescape_string:incomplete unicode surrogate", ps);
                        return NULL;
                    }
                    
                    // Parse second unicode character (low surrogate)
                    if ((h1 = hex_val(p[2])) < 0 || (h2 = hex_val(p[3])) < 0 || 
                        (h3 = hex_val(p[4])) < 0 || (h4 = hex_val(p[5])) < 0) {
                        nx_json_report_error("unescape_string:invalid unicode surrogate", ps);
                        return NULL;
                    }
                    
                    codepoint2 = h1 << 12 | h2 << 8 | h3 << 4 | h4;
                    
                    // Verify it's a valid low surrogate
                    if ((codepoint2 & 0xfc00) != 0xdc00) {
                        nx_json_report_error("unescape_string:invalid unicode surrogate", ps);
                        return NULL;
                    }
                    
                    // Combine the surrogates
                    codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (codepoint2 - 0xdc00);
                    p += 6;
                }
                
                // Convert to UTF-8
                if (unicode_to_utf8(codepoint, d, &d) == 0) {
                    nx_json_report_error("unescape_string:invalid codepoint", ps);
                    return NULL;
                }
                break;
            default:
                // Handle unknown escape sequence
                *d++ = *p++;
                break;
            }
        } else {
            *d++ = c;
        }
    }
}

char *skip_block_comment(char *p) {
    // assume p[-2]=='/' && p[-1]=='*'
    char *ps = p - 2;
    if (*p == '\0') {
        nx_json_report_error("skip_block_comment:endless comment", ps);
        return NULL;
    }

    while (1) {
        p = strchr(p + 1, '/');
        if (p == NULL) {
            nx_json_report_error("skip_block_comment:endless comment", ps);
            return NULL;
        }
        if (p[-1] == '*') {
            break;
        }
    }

    return p + 1;
}

char *parse_key(char **key, char *p) {
    char c;
    // Move declaration to top of function
    
    // Skip leading whitespace
    while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
        p++;
    }

    while ((c = *p++)) {
        if (c == '"') {
            *key = unescape_string(p, &p);
            if (*key == NULL) return NULL;
            
            // Skip whitespace after key
            while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
                p++;
            }
            
            if (*p == ':') return p + 1;
            nx_json_report_error("parse_key:unexpected chars", p);
            return NULL;
        } else if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == ',') {
            // continue
        } else if (c == '}') {
            return p - 1;
        } else if (c == '/') {
            if (*p == '/') { // line comment
                char *ps = p - 1;
                p = strchr(p + 1, '\n');
                if (p == NULL) {
                    nx_json_report_error("parse_key:endless comment", ps);
                    return NULL;
                }
                p++;
            } else if (*p == '*') { // block comment
                p = skip_block_comment(p + 1);
                if (p == NULL) return NULL;
            } else {
                nx_json_report_error("parse_key:unexpected chars", p - 1);
                return NULL;
            }
        } else {
            nx_json_report_error("parse_key:unexpected chars", p - 1);
            return NULL;
        }
    }
    nx_json_report_error("parse_key:unexpected chars", p - 1);
    return NULL;
}

char *parse_value(struct nx_json *parent, char *key, char *p) {
    struct nx_json *js;
    char *ps;  
    char *new_key;
    
    // Skip leading whitespace
    while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
        p++;
    }

    while (1) {
        switch (*p) {
        case '\0':
            return NULL;
        case ' ':
        case '\t':
        case '\n':
        case '\r':
        case ',':
            // skip
            p++;
            break;
        case '{':
            js = create_json(NX_JSON_OBJECT, key, parent);
            if (js == NULL) {
                return NULL;
            }
            p++;
            
            // Handle object contents
            while (1) {
                p = parse_key(&new_key, p);
                if (p == NULL) {
                    return NULL;
                }
                if (*p == '}') {
                    return p + 1;
                }
                if (new_key == NULL) {  // Handle empty object
                    continue;
                }
                
                // Parse the value for this key
                p = parse_value(js, new_key, p);
                if (p == NULL) {
                    return NULL;
                }
            }
            break;
        case '[':
            js = create_json(NX_JSON_ARRAY, key, parent);
            if (js == NULL) {
                return NULL;
            }
            p++;
            
            // Handle array contents
            while (1) {
                // Skip whitespace
                while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
                    p++;
                }
                
                if (*p == ']') {
                    return p + 1; // End of array
                }
                
                // Parse array element
                p = parse_value(js, 0, p);
                if (p == NULL) {
                    return NULL;
                }
                
                // Skip whitespace
                while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
                    p++;
                }
                
                if (*p == ']') {
                    return p + 1; // End of array
                }
                
                if (*p == ',') {
                    p++; // Skip comma and continue with next element
                } else {
                    nx_json_report_error("parse_value:expected ',' or ']'", p);
                    return NULL;
                }
            }
            break;
        case ']':
            return p;
        case '}':
            return p;
        case '"':
            p++;
            js = create_json(NX_JSON_STRING, key, parent);
            js->u.text_value = unescape_string(p, &p);
            if (js->u.text_value == NULL) return NULL;
            return p;
        case '-':
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
            js = create_json(NX_JSON_INTEGER, key, parent);
            if (js == NULL) {
                return NULL;
            }
            
            if (*p == '-') {
                js->u.num.value.s_value = atol(p);
                js->u.num.dbl_value = (double)js->u.num.value.s_value;
            } else {
                js->u.num.value.u_value = atol(p);
                js->u.num.dbl_value = (double)js->u.num.value.u_value;
            }
            
            // Skip past the integer part
            if (*p == '-') p++;
            while (*p >= '0' && *p <= '9') {
                p++;
            }
            
            // Handle decimal point and exponent
            if (*p == '.' || *p == 'e' || *p == 'E') {
                js->type = NX_JSON_DOUBLE;
                js->u.num.dbl_value = atof(p - 1);
                
                // Skip past the decimal part
                while (*p && (*p == '.' || *p == 'e' || *p == 'E' || 
                       *p == '-' || *p == '+' || (*p >= '0' && *p <= '9'))) {
                    p++;
                }
            }
            
            return p;
        }
        case 't':
            if (p[0] == 't' && p[1] == 'r' && p[2] == 'u' && p[3] == 'e') {
                js = create_json(NX_JSON_BOOL, key, parent);
                js->u.num.value.u_value = 1;
                return p + 4;
            }
            nx_json_report_error("parse_value:unexpected chars (t)", p);
            return NULL;
        case 'f':
            if (!strncmp(p, "false", 5)) {
                js = create_json(NX_JSON_BOOL, key, parent);
                js->u.num.value.u_value = 0;
                return p + 5;
            }
            nx_json_report_error("parse_value:unexpected chars (f)", p);
            return NULL;
        case 'n':
            if (!strncmp(p, "null", 4)) {
                create_json(NX_JSON_NULL, key, parent);
                return p + 4;
            }
            nx_json_report_error("parse_value:unexpected chars (n)", p);
            return NULL;
        case '/': // comment
            if (p[1] == '/') { // line comment
                ps = p;  // Just assignment
                p = strchr(p + 2, '\n');
                if (p == NULL) {
                    nx_json_report_error("parse_value:endless comment", ps);
                    return NULL;
                }
                p++;
            } else if (p[1] == '*') { // block comment
                p = skip_block_comment(p + 2);
                if (p == NULL) return NULL;
            } else {
                nx_json_report_error("parse_value:unexpected chars (comment)", p);
                return NULL;
            }
            break;
        default:
            nx_json_report_error("parse_value:unexpected chars (default)", p);
            return NULL;
        }
    }
}

struct nx_json* nx_json_parse(char *text) {
    struct nx_json temp_parent;
    char *p;
    struct nx_json *result;
    
    // Defensive checks
    if (text == NULL) {
        return NULL;
    }

    // Skip whitespace
    while (text[0] == ' ' || text[0] == '\t' || text[0] == '\n' || text[0] == '\r') {
        text++;
    }

    // Check for empty or invalid input
    if (text[0] == '\0' || text[0] != '{') {
        return NULL;
    }

    // Create root node
    temp_parent.type = NX_JSON_ROOT;
    temp_parent.key = NULL;
    temp_parent.next = NULL;
    temp_parent.u.children.first = NULL;
    temp_parent.u.children.last = NULL;
    temp_parent.u.children.length = 0;

    // Parse contents
    p = parse_value(&temp_parent, NULL, text);
    if (p == NULL || temp_parent.u.children.first == NULL) {
        if (temp_parent.u.children.first != NULL) {
            nx_json_free(temp_parent.u.children.first);
        }
        return NULL;
    }

    // Get result and clear parent
    result = temp_parent.u.children.first;
    temp_parent.u.children.first = NULL;
    temp_parent.u.children.last = NULL;
    
    return result;
}

struct nx_json *nx_json_get(struct nx_json *json, char *key) {
    struct nx_json *js;
    for (js = json->u.children.first; js != NULL; js = js->next) {
        if (js->key != NULL && !strcmp(js->key, key)) {
            return js;
        }
    }
    return NULL;
}

struct nx_json *nx_json_item(struct nx_json *json, int idx) {
	struct nx_json *js;
	for (js = json->u.children.first; js != NULL; js = js->next) {
		if (!idx--) return js;
	}
	return NULL;
}
