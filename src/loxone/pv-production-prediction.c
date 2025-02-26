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

char debug[1024];

int nEvents;
char url[512];  // Buffer for the formatted API request URL
char* apiKey;
char* response;
char *start, *end;
float pvPowerToday, pvPowerTomorrow;
int initialFetchDone = 0;


while (TRUE) {
    nEvents = getinputevent();
    if ((nEvents & 0xFF) || !initialFetchDone) {
        apiKey = getinputtext(0);
        if (apiKey == NULL) {
            setoutputtext(2, "No API key provided");
            sleep(1000);
            continue;
        }

        sprintf(url, URL_PATH_FORMAT, LATITUDE, LONGITUDE, KWP, SLOPE, FACING, POWER_EFFICIENCY, TRACKER, apiKey);
        
        // Fetch data using the formatted URL
        response = httpget(SERVER_ADDRESS, url);

        if (response != NULL) {
            setoutputtext(1, url);
            setoutputtext(2, response);
            struct nx_json *json = nx_json_parse(response);
            if (json != NULL) {
                if (json->type == NX_JSON_OBJECT) {
                    struct nx_json *pvPowerTotalJson = nx_json_get(json, "pvpower_total");
                    if (pvPowerTotalJson != NULL && pvPowerTotalJson->type == NX_JSON_ARRAY) {
                        struct nx_json *today = nx_json_item(pvPowerTotalJson, 0);
                        struct nx_json *tomorrow = nx_json_item(pvPowerTotalJson, 1);
                        
                        if (today != NULL && tomorrow != NULL) {
                            // Set initial values to 0
                            pvPowerToday = 0;
                            pvPowerTomorrow = 0;
                            
                            // Only update if we have valid number types
                            if ((today->type == NX_JSON_DOUBLE || today->type == NX_JSON_INTEGER) &&
                                (tomorrow->type == NX_JSON_DOUBLE || tomorrow->type == NX_JSON_INTEGER)) {
                                
                                pvPowerToday = today->u.num.dbl_value;
                                pvPowerTomorrow = tomorrow->u.num.dbl_value;
                                
                                // Ensure values are non-negative
                                if (pvPowerToday >= 0 && pvPowerTomorrow >= 0) {
                                    float adjustedToday = pvPowerToday * PREDICTION_COEFICIENT;
                                    float adjustedTomorrow = pvPowerTomorrow * PREDICTION_COEFICIENT;
                                    
                                    setoutput(OUTPUT_PV_PRODUCTION_TODAY, adjustedToday);
                                    setio(VI_PV_PRODUCTION_TODAY, adjustedToday);
                                    
                                    setoutput(OUTPUT_PV_PRODUCTION_TOMORROW, adjustedTomorrow);
                                    setio(VI_PV_PRODUCTION_TOMMORROW, adjustedTomorrow);
                                    
                                    initialFetchDone = 1;
                                }
                            }
                        }
                    }
                    
                }
                nx_json_free(json);
            }
        }
    }
    sleep(1000);
}
