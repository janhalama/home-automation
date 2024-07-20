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

         = getinputtext(0)
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
                        setoutput(OUTPUT_PV_PRODUCTION_TODAY, pvPowerToday);
						setio(VI_PV_PRODUCTION_TODAY,pvPowerToday);
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
                            setoutput(OUTPUT_PV_PRODUCTION_TOMORROW, pvPowerTomorrow);
							setio(VI_PV_PRODUCTION_TOMMORROW,pvPowerTomorrow);
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
