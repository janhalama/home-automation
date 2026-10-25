/*
Loxone PicoC programming block for fetching PV production predictions from
the home-automation-api service. Returns aggregated today/tomorrow production
in kWh for both east and west panel orientations combined.

PicoC httpget supports plain HTTP only (no HTTPS). Run the API on a local
device (e.g. TrueNAS Scale Docker) and point Input T2 at host:port.

The script should not be triggered more than once a day to stay within
forecast.solar free-tier rate limits.

Inputs:
- Input 1 (I1): Trigger event to fetch the data
- Input 2 (T1): API key — value of HOME_AUTOMATION_API_KEY
- Input 3 (T2): Server address — e.g. "192.168.1.50:3001"

Outputs:
- Output 1: PV production prediction for today (kWh)
- Output 2: PV production prediction for tomorrow (kWh)
*/

// Input indexes
#define INPUT_TRIGGER  0  // I1 — numeric trigger event
#define INPUT_API_KEY  0  // T1 — first text input
#define INPUT_SERVER   1  // T2 — API host:port (plain HTTP)

// Panel configuration
#define LATITUDE     "50.6920036"
#define LONGITUDE    "15.2203556"
#define SLOPE        "45"
#define EAST_AZIMUTH "-63"
#define EAST_KWP     "5.5"
#define WEST_AZIMUTH "113"
#define WEST_KWP     "4.5"

// URL format — all aggregation and date logic handled by the API
#define URL_FORMAT "/api/pv/production-prediction?lat=%s&lon=%s&slope=%s&eastAzimuth=%s&eastKwp=%s&westAzimuth=%s&westKwp=%s&apiKey=%s"

// Output indexes
#define OUTPUT_TODAY    0
#define OUTPUT_TOMORROW 1

// Virtual input connection addresses
#define VI_TODAY    "VI9"
#define VI_TOMORROW "VI10"

// Debug output indexes
#define DEBUG_URL      0
#define DEBUG_RESPONSE 1
#define DEBUG_STATUS   2

/* Skip HTTP response headers and return pointer to body start. */
char* skipHeaders(char* response) {
    char* body;
    if (response == NULL) return NULL;

    body = strstr(response, "\r\n\r\n");
    if (body != NULL) return body + 4;

    body = strstr(response, "\n\n");
    if (body != NULL) return body + 2;

    return response;
}

/*
Extract a named float value from a "key=value\n" plain-text body.
Returns 0.0 when the key is not present.
*/
float parseNamedFloat(char* body, char* key) {
    char search[32];
    char* pos;

    if (body == NULL || key == NULL) return 0.0;

    sprintf(search, "%s=", key);
    pos = strstr(body, search);
    if (pos == NULL) return 0.0;

    return atof(pos + strlen(search));
}

int nEvents;
int initialFetchDone = 0;
char url[512];
char debug[256];
char* apiKey;
char* serverAddress;
char* response;
char* body;
float todayKwh;
float tomorrowKwh;

while (TRUE) {
    nEvents = getinputevent();
    if ((nEvents & 0xFF) || !initialFetchDone) {
        apiKey = getinputtext(INPUT_API_KEY);
        serverAddress = getinputtext(INPUT_SERVER);

        if (apiKey == NULL || serverAddress == NULL || apiKey[0] == 0 || serverAddress[0] == 0) {
            setoutputtext(DEBUG_STATUS, "error: missing api key or server");
        } else {
            sprintf(url, URL_FORMAT,
                LATITUDE, LONGITUDE, SLOPE,
                EAST_AZIMUTH, EAST_KWP,
                WEST_AZIMUTH, WEST_KWP,
                apiKey);

            setoutputtext(DEBUG_URL, url);

            response = httpget(serverAddress, url);
            if (response == NULL) {
                setoutputtext(DEBUG_STATUS, "error: no response from server");
            } else {
                body = skipHeaders(response);
                setoutputtext(DEBUG_RESPONSE, body);

                if (body == NULL || strstr(body, "today=") == NULL) {
                    setoutputtext(DEBUG_STATUS, "error: unexpected response");
                } else {
                    todayKwh    = parseNamedFloat(body, "today");
                    tomorrowKwh = parseNamedFloat(body, "tomorrow");

                    sprintf(debug, "today=%.3f tomorrow=%.3f", todayKwh, tomorrowKwh);
                    setoutputtext(DEBUG_STATUS, debug);

                    setoutput(OUTPUT_TODAY,    todayKwh);
                    setio(VI_TODAY,            todayKwh);

                    setoutput(OUTPUT_TOMORROW, tomorrowKwh);
                    setio(VI_TOMORROW,         tomorrowKwh);

                    initialFetchDone = 1;
                }

                free(response);
            }
        }
    }
    sleep(1000);
}
