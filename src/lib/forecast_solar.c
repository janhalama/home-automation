// Check if we're using a standard C compiler
#ifndef PICO_C
#include "forecast_solar.h"
#include "nx_json.h"
#include <string.h>
#include <stdio.h>  // Add this for printf function
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

//void fetchDailyProduction(char* jsonBody, char* todayDate, char* tomorrowDate) {TBD...

// Function to parse daily production from JSON response with debug logging
struct DailyProduction parseDailyProduction(char* jsonBody, char* todayDate, char* tomorrowDate) {
    struct DailyProduction production;
    production.today = 0;  // Initialize today to 0
    production.tomorrow = 0;  // Initialize tomorrow to 0
    
    // Skip HTTP headers if present
    char* body = skipHeaders(jsonBody);
    if (body == NULL) {
        return production;
    }
    
    // Parse the JSON response
    struct nx_json *json = nx_json_parse(body);
    if (json == NULL) {
        return production;
    }
    
    // Extract the result object which contains the dates
    struct nx_json *result = nx_json_get(json, "result");
    if (result == NULL) {
        nx_json_reset();
        return production;
    }
    
    // Get production values for today and tomorrow by date key
    struct nx_json *todayProd = nx_json_get(result, todayDate);

    if (todayProd != NULL) {
        if (todayProd->type == NX_JSON_INTEGER || todayProd->type == NX_JSON_DOUBLE) {
            // Convert to Wh
            production.today = todayProd->u.number_value / 1000.0;
        }

    }
    
    // Get tomorrow's production value
    struct nx_json *tomorrowProd = nx_json_get(result, tomorrowDate);
    
    if (tomorrowProd != NULL) {
        if (tomorrowProd->type == NX_JSON_INTEGER || tomorrowProd->type == NX_JSON_DOUBLE) {
            // Convert to Wh
            production.tomorrow = tomorrowProd->u.number_value / 1000.0;
        }

    }
    
    // Clean up our node allocation
    nx_json_reset();
    
    return production;
} 