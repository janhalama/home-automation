#ifndef FORECAST_SOLAR_H
#define FORECAST_SOLAR_H

// Structure to hold production values
struct DailyProduction {
    double today;
    double tomorrow;
};

// Function to skip HTTP headers and return pointer to response body
char* skipHeaders(char* response);

// Function to parse daily production from JSON response
struct DailyProduction parseDailyProduction(char* response, char* todayDate, char* tomorrowDate);

#endif // FORECAST_SOLAR_H 