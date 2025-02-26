// Check if we're using a standard C compiler
#ifndef PICO_C
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <errno.h>
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
    sprintf(error_message, "NXJSON PARSE ERROR: %s at %s\n", safe_msg, safe_p);
#ifdef PICO_C
    setoutputtext(2, error_message);  // This is a Loxone function
#else
    fprintf(stderr, "%s", error_message);  // Use standard error output in non-Pico environment
#endif
}

struct nx_json* nx_json_alloc(void) {
    return (struct nx_json*)calloc(1, sizeof(struct nx_json));
}

void nx_json_dealloc(struct nx_json* js) {
    free((void*)js);
}

struct nx_json *create_json(enum nx_json_type type, char *key, struct nx_json *parent) {
    // More defensive parent check
    if (parent == NULL) {
        return NULL;
    }

    // Allocate new node
    struct nx_json *js = nx_json_alloc();
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
    if (js->type == NX_JSON_OBJECT || js->type == NX_JSON_ARRAY) {
        struct nx_json *p = js->u.children.first;
        struct nx_json *p1;
        while (p) {
            p1 = p->next;
            nx_json_free(p);
            p = p1;
        }
    }
    nx_json_dealloc(js);
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
    char *ps;  // For error reporting
    int h1, h2, h3, h4;
    unsigned int codepoint;
    unsigned int codepoint2;

    while ((c = *p++)) {
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
                if ((h1 = hex_val(p[1])) < 0 || (h2 = hex_val(p[2])) < 0 || 
                    (h3 = hex_val(p[3])) < 0 || (h4 = hex_val(p[4])) < 0) {
                    nx_json_report_error("invalid unicode escape", p - 1);
                    return 0;
                }
                codepoint = h1 << 12 | h2 << 8 | h3 << 4 | h4;
                
                if ((codepoint & 0xfc00) == 0xd800) { // high surrogate
                    p += 6;
                    if (p[-1] != '\\' || *p != 'u' || (h1 = hex_val(p[1])) < 0 || 
                        (h2 = hex_val(p[2])) < 0 || (h3 = hex_val(p[3])) < 0 || 
                        (h4 = hex_val(p[4])) < 0) {
                        nx_json_report_error("invalid unicode surrogate", ps);
                        return 0;
                    }
                    codepoint2 = h1 << 12 | h2 << 8 | h3 << 4 | h4;
                    
                    if ((codepoint2 & 0xfc00) != 0xdc00) {
                        nx_json_report_error("invalid unicode surrogate", ps);
                        return 0;
                    }
                    codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (codepoint2 - 0xdc00);
                }
                
                if (!unicode_to_utf8(codepoint, d, &d)) {
                    nx_json_report_error("invalid codepoint", ps);
                    return 0;
                }
                p += 5;
                break;
            default:
                *d++ = c;
                break;
            }
        } else {
            *d++ = c;
        }
    }
    nx_json_report_error("no closing quote for string", s);
    return 0;
}

char *skip_block_comment(char *p) {
    // assume p[-2]=='/' && p[-1]=='*'
    char *ps = p - 2;
    if (!*p) {
        nx_json_report_error("endless comment", ps);
        return 0;
    }

    while (1) {
        p = strchr(p + 1, '/');
        if (!p) {
            nx_json_report_error("endless comment", ps);
            return 0;
        }
        if (p[-1] == '*') {
            break;
        }
    }

    return p + 1;
}

char *parse_key(char **key, char *p) {
    // Skip leading whitespace
    while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
        p++;
    }

    char c;
    while ((c = *p++)) {
        if (c == '"') {
            *key = unescape_string(p, &p);
            if (!*key) return 0;
            
            // Skip whitespace after key
            while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
                p++;
            }
            
            if (*p == ':') return p + 1;
            nx_json_report_error("unexpected chars", p);
            return 0;
        } else if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == ',') {
            // continue
        } else if (c == '}') {
            return p - 1;
        } else if (c == '/') {
            if (*p == '/') { // line comment
                char *ps = p - 1;
                p = strchr(p + 1, '\n');
                if (!p) {
                    nx_json_report_error("endless comment", ps);
                    return 0; // error
                }
                p++;
            } else if (*p == '*') { // block comment
                p = skip_block_comment(p + 1);
                if (!p) return 0;
            } else {
                nx_json_report_error("unexpected chars", p - 1);
                return 0; // error
            }
        } else {
            nx_json_report_error("unexpected chars", p - 1);
            return 0; // error
        }
    }
    nx_json_report_error("unexpected chars", p - 1);
    return 0; // error
}

char *parse_value(struct nx_json *parent, char *key, char *p) {
    struct nx_json *js;

    // Skip leading whitespace
    while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
        p++;
    }

    while (1) {
        switch (*p) {
        case '\0':
            return 0;
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
            if (!js) {
                return 0;
            }
            p++;
            while (1) {
                char *new_key;
                p = parse_key(&new_key, p);
                if (!p) {
                    return 0;
                }
                if (*p == '}') {
                    return p + 1;
                }
                if (!new_key) {  // Handle empty object
                    continue;
                }
                p = parse_value(js, new_key, p);
                if (!p) {
                    return 0;
                }
            }
            break;
        case '[':
            js = create_json(NX_JSON_ARRAY, key, parent);
            p++;
            while (1) {
                p = parse_value(js, 0, p);
                if (!p) return 0; // error
                if (*p == ']') return p + 1; // end of array
            }
            break;
        case ']':
            return p;
        case '"':
            p++;
            js = create_json(NX_JSON_STRING, key, parent);
            js->u.text_value = unescape_string(p, &p);
            if (!js->u.text_value) return 0; // propagate error
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
            char *pe;
            if (*p == '-') {
                js->u.num.value.s_value = (unsigned long) strtoll(p, &pe, 0);
            } else {
                js->u.num.value.u_value = (unsigned long) strtoull(p, &pe, 0);
            }
            if (pe == p || errno == ERANGE) {
                nx_json_report_error("invalid number", p);
                return 0; // error
            }
            if (*pe == '.' || *pe == 'e' || *pe == 'E') { // double value
                js->type = NX_JSON_DOUBLE;
                js->u.num.dbl_value = strtod(p, &pe);
                if (pe == p || errno == ERANGE) {
                    nx_json_report_error("invalid number", p);
                    return 0; // error
                }
            } else {
                if (*p == '-') {
                    js->u.num.dbl_value = js->u.num.value.s_value;
                } else {
                    js->u.num.dbl_value = js->u.num.value.u_value;
                }
            }
            return pe;
        }
        case 't':
            if (!strncmp(p, "true", 4)) {
                js = create_json(NX_JSON_BOOL, key, parent);
                js->u.num.value.u_value = 1;
                return p + 4;
            }
            nx_json_report_error("unexpected chars", p);
            return 0; // error
        case 'f':
            if (!strncmp(p, "false", 5)) {
                js = create_json(NX_JSON_BOOL, key, parent);
                js->u.num.value.u_value = 0;
                return p + 5;
            }
            nx_json_report_error("unexpected chars", p);
            return 0; // error
        case 'n':
            if (!strncmp(p, "null", 4)) {
                create_json(NX_JSON_NULL, key, parent);
                return p + 4;
            }
            nx_json_report_error("unexpected chars", p);
            return 0; // error
        case '/': // comment
            if (p[1] == '/') { // line comment
                char *ps = p;
                p = strchr(p + 2, '\n');
                if (!p) {
                    nx_json_report_error("endless comment", ps);
                    return 0; // error
                }
                p++;
            } else if (p[1] == '*') { // block comment
                p = skip_block_comment(p + 2);
                if (!p) return 0;
            } else {
                nx_json_report_error("unexpected chars", p);
                return 0; // error
            }
            break;
        default:
            nx_json_report_error("unexpected chars", p);
            return 0; // error
        }
    }
}

struct nx_json *nx_json_parse(char *text) {
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
    static struct nx_json temp_parent;
    temp_parent.type = NX_JSON_ROOT;
    temp_parent.key = NULL;
    temp_parent.next = NULL;
    temp_parent.u.children.first = NULL;
    temp_parent.u.children.last = NULL;
    temp_parent.u.children.length = 0;


    // Parse contents
    char *p = parse_value(&temp_parent, NULL, text);
    if (p == NULL || temp_parent.u.children.first == NULL) {
        if (temp_parent.u.children.first != NULL) {
            nx_json_free(temp_parent.u.children.first);
        }
        return NULL;
    }

    // Get result and clear parent
    struct nx_json *result = temp_parent.u.children.first;
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
