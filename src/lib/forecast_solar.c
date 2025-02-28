// Check if we're using a standard C compiler
#ifndef PICO_C
#include "forecast_solar.h"
#include "nx_json.h"
#include <string.h>
#endif

// Function to skip HTTP headers and return pointer to response body
char* skipHeaders(char* response) {
    if (response == NULL) return NULL;
    
    char* body = strstr(response, "\r\n\r\n");
    if (body != NULL) {
        return body + 4; // Skip the delimiter itself
    }
    
    body = strstr(response, "\n\n");
    if (body != NULL) {
        return body + 2;
    }
    
    return response; // If no headers found, return original response
}

// Function to parse daily production from JSON response
struct DailyProduction parseDailyProduction(char* jsonBody, char* todayDate, char* tomorrowDate) {
    struct DailyProduction production;
    production.today = 0;  // Initialize today to 0
    production.tomorrow = 0;  // Initialize tomorrow to 0
    
    struct nx_json *json = nx_json_parse(jsonBody);
    if (json != NULL) {
        struct nx_json *result = nx_json_get(json, "result");
        if (result != NULL) {
            struct nx_json *todayProd = nx_json_get(result, todayDate);
            struct nx_json *tomorrowProd = nx_json_get(result, tomorrowDate);
            
            if (todayProd != NULL && (todayProd->type == NX_JSON_INTEGER || todayProd->type == NX_JSON_DOUBLE)) {
                production.today = (int)todayProd->u.num.dbl_value;
            }
            if (tomorrowProd != NULL && (tomorrowProd->type == NX_JSON_INTEGER || tomorrowProd->type == NX_JSON_DOUBLE)) {
                production.tomorrow = (int)tomorrowProd->u.num.dbl_value;
            }
        }
        nx_json_free(json);
        
    }
    return production;
} 