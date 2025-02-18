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
			setoutputtext(1, url);

			// Find the end of the headers
			char *body = strstr(response, "\r\n\r\n"); // Look for the end of headers
			if (body != NULL) {
				body += 4; // Move pointer to the start of the body (after the headers)

				// Output the received weather data
				setoutputtext(0, body);
				struct nx_json *json = nx_json_parse(body);

				if (json != NULL) {
					sprintf(debug,"JSON is not NULL.\n");

					struct nx_json *pvPowerTotalJson = nx_json_get(json, "pvpower_total");
					if (pvPowerTotalJson) {
						// Assuming the array is not empty, extract the first two values for today and tomorrow
						pvPowerToday = nx_json_item(pvPowerTotalJson, 0)->num.dbl_value; // First value
						pvPowerTomorrow = nx_json_item(pvPowerTotalJson, 1)->num.dbl_value; // Second value
					}
					// Free the memory allocated for the JSON structure
					nx_json_free(json);
				} else {
					sprintf(debug,"Failed to parse JSON.\n");
				}

				// Set the debug output
				setoutputtext(2, debug); // Output the JSON structure to debug

				// Update the outputs with the fetched data
				setoutput(OUTPUT_PV_PRODUCTION_TODAY, pvPowerToday * PREDICTION_COEFICIENT);
				setio(VI_PV_PRODUCTION_TODAY,pvPowerToday * PREDICTION_COEFICIENT);

				setoutput(OUTPUT_PV_PRODUCTION_TOMORROW, pvPowerTomorrow * PREDICTION_COEFICIENT);
				setio(VI_PV_PRODUCTION_TOMMORROW,pvPowerTomorrow * PREDICTION_COEFICIENT);
				
				initialFetchDone = 1;
			} else {
				// Log error if the response does not contain valid headers
				printf("Invalid HTTP response format.\n");
			}
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
