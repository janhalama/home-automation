/* 
Loxone programming block for fetching PV production predictions from Meteoblue API and updating the virtual inputs.

The script should not bet triggered more than once a day to avoid unnecessary API calls and stay withing the free tier limits.

Inputs:
- Input 1: Trigger event to fetch the data
- Text Input 1: MeteoBlue API key

Outputs:
- Output 1: PV production prediction for today
- Output 2: PV production prediction for tomorrow
*/ 

// Define all required constants
#define SERVER_ADDRESS "my.meteoblue.com"
 //TODO: Following constants should be replaced with user inputs
#define LATITUDE "50.6920272"
#define LONGITUDE "15.2203211"
#define KWP "8"
#define SLOPE "45"
#define FACING "100"
#define POWER_EFFICIENCY "0.9"
#define TRACKER "1"

// API endpoint path
#define URL_PATH_FORMAT "/packages/pvpro-1h_pvpro-day?lat=%s&lon=%s&kwp=%s&slope=%s&facing=%s&power_efficiency=%s&tracker=%s&apikey=%s"

// Output indexes
#define OUTPUT_PV_PRODUCTION_TODAY 0
#define OUTPUT_PV_PRODUCTION_TOMORROW 1

// Virtual input connection addresses
#define VI_PV_PRODUCTION_TODAY "VI9"
#define VI_PV_PRODUCTION_TOMMORROW "VI10"

#define PREDICTION_COEFICIENT 0.6 // The prediction is consistently off by 60%

enum nx_json_type {
	NX_JSON_NULL,    // this is null value
	NX_JSON_OBJECT,  // this is an object; properties can be found in child nodes
	NX_JSON_ARRAY,   // this is an array; items can be found in child nodes
	NX_JSON_STRING,  // this is a string; value can be found in text_value field
	NX_JSON_INTEGER, // this is an integer; value can be found in int_value field
	NX_JSON_DOUBLE,  // this is a double; value can be found in dbl_value field
	NX_JSON_BOOL     // this is a boolean; value can be found in int_value field
};

struct nx_json {
	enum nx_json_type type;       // type of json node, see above
	char *key;         // key of the property; for object's children only
	union data {
		char *text_value;  // text value of STRING node
		struct num {
			union value {
				unsigned long u_value;    // the value of INTEGER or BOOL node
				unsigned long s_value;
			};
			double dbl_value;      // the value of DOUBLE node
		} num;
		struct children { // children of OBJECT or ARRAY
			int length;
			struct nx_json *first;
			struct nx_json *last;
		} children;
	};
	struct nx_json *next;    // points to next child
};

#define NX_JSON_CALLOC() calloc(1, sizeof(struct nx_json))
#define NX_JSON_FREE(json) free((void*)(json))
#define NX_JSON_REPORT_ERROR(msg, p) fprintf(stderr, "NXJSON PARSE ERROR (%d): " msg " at %s\n", __LINE__, p)
#define IS_WHITESPACE(c) ((unsigned char)(c)<=(unsigned char)' ')

struct nx_json *create_json(enum nx_json_type type, char *key, struct nx_json *parent) {
	struct nx_json *js = NX_JSON_CALLOC();
	assert(js);
	js->type = type;
	js->key = key;
	if (!parent->children.last) {
		parent->children.first = parent->children.last = js;
	} else {
		parent->children.last->next = js;
		parent->children.last = js;
	}
	parent->children.length++;
	return js;
}

void nx_json_free(struct nx_json *js) {
	if (!js) {
		return;
	}
	if (js->type == NX_JSON_OBJECT || js->type == NX_JSON_ARRAY) {
		struct nx_json *p = js->children.first;
		struct nx_json *p1;
		while (p) {
			p1 = p->next;
			nx_json_free (p);
			p = p1;
		}
	}
	NX_JSON_FREE(js);
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
				char *ps = p - 1;
				int h1, h2, h3, h4;
				if ((h1 = hex_val (p[1])) < 0 || (h2 = hex_val (p[2])) < 0 || (h3 = hex_val (p[3])) < 0 ||
					(h4 = hex_val (p[4])) < 0) {
					NX_JSON_REPORT_ERROR("invalid unicode escape", p - 1);
					return 0;
				}
				unsigned int codepoint = h1 << 12 | h2 << 8 | h3 << 4 | h4;
				if ((codepoint & 0xfc00) == 0xd800) { // high surrogate; need one more unicode to succeed
					p += 6;
					if (p[-1] != '\\' || *p != 'u' || (h1 = hex_val (p[1])) < 0 || (h2 = hex_val (p[2])) < 0 ||
						(h3 = hex_val (p[3])) < 0 || (h4 = hex_val (p[4])) < 0) {
						NX_JSON_REPORT_ERROR("invalid unicode surrogate", ps);
						return 0;
					}
					unsigned int codepoint2 = h1 << 12 | h2 << 8 | h3 << 4 | h4;
					if ((codepoint2 & 0xfc00) != 0xdc00) {
						NX_JSON_REPORT_ERROR("invalid unicode surrogate", ps);
						return 0;
					}
					codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (codepoint2 - 0xdc00);
				}
				if (!unicode_to_utf8(codepoint, d, &d)) {
					NX_JSON_REPORT_ERROR("invalid codepoint", ps);
					return 0;
				}
				p += 5;
				break;
			default:
				// leave untouched
				*d++ = c;
				break;
			}
		} else {
			*d++ = c;
		}
	}
	NX_JSON_REPORT_ERROR("no closing quote for string", s);
	return 0;
}

char *skip_block_comment(char *p) {
    // assume p[-2]=='/' && p[-1]=='*'
    char *ps = p - 2;
    if (!*p) {
        NX_JSON_REPORT_ERROR("endless comment", ps);
        return 0;
    }

    while (1) {
        p = strchr(p + 1, '/');
        if (!p) {
            NX_JSON_REPORT_ERROR("endless comment", ps);
            return 0;
        }
        if (p[-1] == '*') {
            break;
        }
    }

    return p + 1;
}

char *parse_key(char **key, char *p) {
	// on '}' return with *p=='}'
	char c;
	while ((c = *p++)) {
		if (c == '"') {
			*key = unescape_string (p, &p);
			if (!*key) return 0; // propagate error
			while (*p && IS_WHITESPACE(*p)) p++;
			if (*p == ':') return p + 1;
			NX_JSON_REPORT_ERROR("unexpected chars", p);
			return 0;
		} else if (IS_WHITESPACE(c) || c == ',') {
			// continue
		} else if (c == '}') {
			return p - 1;
		} else if (c == '/') {
			if (*p == '/') { // line comment
				char *ps = p - 1;
				p = strchr (p + 1, '\n');
				if (!p) {
					NX_JSON_REPORT_ERROR("endless comment", ps);
					return 0; // error
				}
				p++;
			} else if (*p == '*') { // block comment
				p = skip_block_comment (p + 1);
				if (!p) return 0;
			} else {
				NX_JSON_REPORT_ERROR("unexpected chars", p - 1);
				return 0; // error
			}
		} else {
			NX_JSON_REPORT_ERROR("unexpected chars", p - 1);
			return 0; // error
		}
	}
	NX_JSON_REPORT_ERROR("unexpected chars", p - 1);
	return 0; // error
}

char *parse_value(struct nx_json *parent, char *key, char *p) {
	struct nx_json *js;
	while (1) {
		switch (*p) {
		case '\0':
			NX_JSON_REPORT_ERROR("unexpected end of text", p);
			return 0; // error
		case ' ':
		case '\t':
		case '\n':
		case '\r':
		case ',':
			// skip
			p++;
			break;
		case '{':
			js = create_json (NX_JSON_OBJECT, key, parent);
			p++;
			while (1) {
				char *new_key;
				p = parse_key (&new_key, p);
				if (!p) return 0; // error
				if (*p == '}') return p + 1; // end of object
				p = parse_value (js, new_key, p);
				if (!p) return 0; // error
			}
		case '[':
			js = create_json (NX_JSON_ARRAY, key, parent);
			p++;
			while (1) {
				p = parse_value (js, 0, p);
				if (!p) return 0; // error
				if (*p == ']') return p + 1; // end of array
			}
		case ']':
			return p;
		case '"':
			p++;
			js = create_json (NX_JSON_STRING, key, parent);
			js->text_value = unescape_string (p, &p);
			if (!js->text_value) return 0; // propagate error
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
			js = create_json (NX_JSON_INTEGER, key, parent);
			char *pe;
			if (*p == '-') {
				js->num.s_value = (unsigned long) strtoll (p, &pe, 0);
			} else {
				js->num.u_value = (unsigned long) strtoull (p, &pe, 0);
			}
			if (pe == p || errno == ERANGE) {
				NX_JSON_REPORT_ERROR("invalid number", p);
				return 0; // error
			}
			if (*pe == '.' || *pe == 'e' || *pe == 'E') { // double value
				js->type = NX_JSON_DOUBLE;
				js->num.dbl_value = strtod (p, &pe);
				if (pe == p || errno == ERANGE) {
					NX_JSON_REPORT_ERROR("invalid number", p);
					return 0; // error
				}
			} else {
				if (*p == '-') {
					js->num.dbl_value = js->num.s_value;
				} else {
					js->num.dbl_value = js->num.u_value;
				}
			}
			return pe;
		}
		case 't':
			if (!strncmp (p, "true", 4)) {
				js = create_json (NX_JSON_BOOL, key, parent);
				js->num.u_value = 1;
				return p + 4;
			}
			NX_JSON_REPORT_ERROR("unexpected chars", p);
			return 0; // error
		case 'f':
			if (!strncmp (p, "false", 5)) {
				js = create_json (NX_JSON_BOOL, key, parent);
				js->num.u_value = 0;
				return p + 5;
			}
			NX_JSON_REPORT_ERROR("unexpected chars", p);
			return 0; // error
		case 'n':
			if (!strncmp (p, "null", 4)) {
				create_json (NX_JSON_NULL, key, parent);
				return p + 4;
			}
			NX_JSON_REPORT_ERROR("unexpected chars", p);
			return 0; // error
		case '/': // comment
			if (p[1] == '/') { // line comment
				char *ps = p;
				p = strchr (p + 2, '\n');
				if (!p) {
					NX_JSON_REPORT_ERROR("endless comment", ps);
					return 0; // error
				}
				p++;
			} else if (p[1] == '*') { // block comment
				p = skip_block_comment (p + 2);
				if (!p) return 0;
			} else {
				NX_JSON_REPORT_ERROR("unexpected chars", p);
				return 0; // error
			}
			break;
		default:
			NX_JSON_REPORT_ERROR("unexpected chars", p);
			return 0; // error
		}
	}
}

struct nx_json *nx_json_parse(char *text) {
	memset(&js, 0, sizeof(js));  // Manually zero-initialize the struct
	if (!parse_value (&js, 0, text)) {
		if (js.children.first) nx_json_free (js.children.first);
		return 0;
	}
	return js.children.first;
}

struct nx_json *nx_json_get(struct nx_json *json, char *key) {
	nx_json *js;
	for (js = json->children.first; js; js = js->next) {
		if (js->key && !strcmp (js->key, key)) return js;
	}
	return NULL;
}

struct nx_json *nx_json_item(struct nx_json *json, int idx) {
	struct nx_json *js;
	for (js = json->children.first; js; js = js->next) {
		if (!idx--) return js;
	}
	return NULL;
}

int nEvents;
char url[512];  // Buffer for the formatted API request URL
char* apiKey;
char* response;
char *start, *end;
float pvPowerToday, pvPowerTomorrow;
int initialFetchDone = 0;


while (TRUE) {
    // Check for input event and respond to any input event
    nEvents = getinputevent();
    if (nEvents & 0xFF || !initialFetchDone) {  // Mask 0xFF to respond to any input event

        // Fetch the API key from the text input
        apiKey = getinputtext(0);

        // Format the full URL using sprintf
        sprintf(url, URL_PATH_FORMAT, LATITUDE, LONGITUDE, KWP, SLOPE, FACING, POWER_EFFICIENCY, TRACKER, apiKey);
        
        // Fetch data using the formatted URL
        response = httpget(SERVER_ADDRESS, url);

        if (response != NULL) {
            // Output the received weather data
            setoutputtext(0, response);
            printf(response); // Also output to console if needed for debugging
            
            // Following is poor man's JSON parsing to extract the PV power predictions, we don't have a JSON parser in Loxone available
            // Find the start of the "pvpower_total" key
            start = strstr(response, "\"pvpower_total\":[");
            if (start != NULL) {
                start = strstr(start, "[");
                if (start != NULL) {
                    start++; // Move past the '['

                    // Find the end of the first number
                    end = strstr(start, ",");
                    if (end != NULL) {
                        *end = '\0';
                        pvPowerToday = atof(start);  // Convert the substring to a float
                        setoutput(OUTPUT_PV_PRODUCTION_TODAY, pvPowerToday * PREDICTION_COEFICIENT);
						setio(VI_PV_PRODUCTION_TODAY,pvPowerToday * PREDICTION_COEFICIENT);
                        printf("First PV Power Prediction for Today: %.3f kW\n", pvPowerToday);
                        
                        // Reset the start pointer to fetch the next prediction
                        start = end + 1; // Move past the ','
                        end = strstr(start, ",");  // Find the next comma
                        if (end == NULL) {
                            end = strstr(start, "]");
                        }
                        if (end != NULL) {
                            *end = '\0';
                            pvPowerTomorrow = atof(start);  // Convert the next substring to a float
                            setoutput(OUTPUT_PV_PRODUCTION_TOMORROW, pvPowerTomorrow * PREDICTION_COEFICIENT);
							setio(VI_PV_PRODUCTION_TOMMORROW,pvPowerTomorrow * PREDICTION_COEFICIENT);
                            printf("Second PV Power Prediction for Tomorrow: %.3f kW\n", pvPowerTomorrow);
                        }
                    }
                }
            }
			initialFetchDone = 1;
            // Free the memory allocated by httpget
            free(response);
        } else {
            // Log error if the httpget call failed
            printf("Failed to fetch weather data.\n");
        }
    }

    // Wait before the next input check to reduce CPU usage
    sleep(1000);  // Wait for 1 second
}
