/* 
Loxone programming block for fetching PV production predictions from Forecast.solar API and updating the virtual inputs.

The script should not bet triggered more than once a day to avoid unnecessary API calls and stay within the free tier limits.

Inputs:
- Input 1: Trigger event to fetch the data

Outputs:
- Output 1: PV production prediction for today
- Output 2: PV production prediction for tomorrow
*/ 

#include "../lib/forecast_solar.h"

// Define all required constants
#define SERVER_ADDRESS "api.forecast.solar"

// Panel configuration
#define LATITUDE "50.6920036"
#define LONGITUDE "15.2203556"
#define SLOPE "45"
#define EAST_AZIMUTH "-63"
#define EAST_KWP "5500"
#define WEST_AZIMUTH "113"
#define WEST_KWP "4500"

// API endpoint path format (same for both orientations)
#define URL_PATH_FORMAT "/estimate/watthours/day/%s/%s/%s/%s/%s?time=%s"

// Output indexes
#define OUTPUT_PV_PRODUCTION_TODAY 0
#define OUTPUT_PV_PRODUCTION_TOMORROW 1

// Virtual input connection addresses
#define VI_PV_PRODUCTION_TODAY "VI9"
#define VI_PV_PRODUCTION_TOMORROW "VI10"

// Define debug output indexes
#define DEBUG_OUTPUT_RESPONSE 0
#define DEBUG_OUTPUT_URL 1
#define DEBUG_OUTPUT_DEBUG 2

int nEvents;
char debug[1024];
char urlEast[512];  // Buffer for east panels API URL
char urlWest[512];  // Buffer for west panels API URL
char* responseEast;
char* responseWest;
int initialFetchDone = 0;

while (TRUE) {
    nEvents = getinputevent();
    if ((nEvents & 0xFF) || !initialFetchDone) {
        // Get current date in YYYY-MM-DD format using Loxone time functions
        char todayDate[11], tomorrowDate[11];
        unsigned int currentTime = getcurrenttime();
        unsigned int tomorrowTime = currentTime + (24 * 60 * 60); // Add 24 hours in seconds
        
        // Format today's date (using local time)
        sprintf(todayDate, "%04d-%02d-%02d", 
            getyear(currentTime, 1),
            getmonth(currentTime, 1),
            getday(currentTime, 1));
        
        // Format tomorrow's date (using local time)
        sprintf(tomorrowDate, "%04d-%02d-%02d", 
            getyear(tomorrowTime, 1),
            getmonth(tomorrowTime, 1),
            getday(tomorrowTime, 1));

       // Format URLs for both panel orientations
        sprintf(urlEast, URL_PATH_FORMAT, LATITUDE, LONGITUDE, SLOPE, EAST_AZIMUTH, EAST_KWP, tomorrowDate);
        sprintf(urlWest, URL_PATH_FORMAT, LATITUDE, LONGITUDE, SLOPE, WEST_AZIMUTH, WEST_KWP, tomorrowDate);
        
        // Log URLs
        sprintf(debug, "East URL: %s\nWest URL: %s", urlEast, urlWest);
        setoutputtext(DEBUG_OUTPUT_URL, debug);

        // Fetch and process east panels data
        struct DailyProduction eastProduction;
        char* jsonBody;
        responseEast = httpget(SERVER_ADDRESS, urlEast);
        if (responseEast != NULL) {
            // Log response (show body only)
            jsonBody = skipHeaders(responseEast);
            sprintf(debug, "East response: %s", jsonBody);
            setoutputtext(DEBUG_OUTPUT_RESPONSE, debug);
            
            // Parse east production values
            eastProduction = parseDailyProduction(jsonBody, todayDate, tomorrowDate);

            // Free the east response
            free(responseEast);
        } else {
            sprintf(debug, "Failed to fetch east panel data");
            setoutputtext(DEBUG_OUTPUT_DEBUG, debug);
        }

        // Fetch and process west panels data
        struct DailyProduction westProduction;
        responseWest = httpget(SERVER_ADDRESS, urlWest);
        if (responseWest != NULL) {
            // Log response (show body only)
            jsonBody = skipHeaders(responseWest);
            sprintf(debug, "West response: %s", jsonBody);
            setoutputtext(DEBUG_OUTPUT_RESPONSE, debug);    
            
            // Parse west production values
            westProduction = parseDailyProduction(jsonBody, todayDate, tomorrowDate);

            // Free the west response
            free(responseWest);
        } else {
            sprintf(debug, "Failed to fetch east panel data");
            setoutputtext(DEBUG_OUTPUT_DEBUG, debug);
        }
            
        // Calculate total production (convert to kWh)
        float totalToday = (eastProduction.today + westProduction.today) / 1000.0;
        float totalTomorrow = (eastProduction.tomorrow + westProduction.tomorrow) / 1000.0;

        sprintf(debug, "Total production today: %f, tomorrow: %f", totalToday, totalTomorrow);
        setoutputtext(DEBUG_OUTPUT_DEBUG, debug);

        // Update outputs and virtual inputs
        setoutput(OUTPUT_PV_PRODUCTION_TODAY, totalToday);
        setio(VI_PV_PRODUCTION_TODAY, totalToday);
        
        setoutput(OUTPUT_PV_PRODUCTION_TOMORROW, totalTomorrow);
        setio(VI_PV_PRODUCTION_TOMORROW, totalTomorrow);
        
        initialFetchDone = 1;
    }
    sleep(1000);
}
