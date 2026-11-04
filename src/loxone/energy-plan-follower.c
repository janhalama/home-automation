/*
 Loxone programming block that pulls the energy plan and holds the live decision.

 This replaces the forecast fetch block. The trigger is not used.
 The block fetches when it starts, and again every 15 minutes.
 A plan older than one hour is no longer fresh.
 - I1: the old trigger. Leave the wire or remove it. Nothing reads it.
 - I2: the solar block. The wire stays. The plan does not read it.
 - T1: API key
 - T2: server address, for example 192.168.1.3:3001

 The old today and tomorrow outputs are gone. Disconnect those wires.

 This block only fetches. The tank block, the car block, and the FVE block
 each keep their own outputs. A constant 1 on "plan connected" is what
 makes a block follow. Until that constant is tied, that block is unchanged.

 Outputs, in order:
 - Output 1: Plan is fresh (1 or 0)
 - Output 2: Tank command. 1 heat, 0 stay off, -1 the tank block keeps its limited rule
 - Output 3: Car command. 1 allow, 0 stay off, -1 the car block keeps its own rule
 - Output 4: Car power cap in kW while the car command is 1
 - Output 5: Battery command. 1 charge, -1 sell, 0 neither
 - Output 6: Battery charge power in kW while output 5 is on
 - Text output 1: Requested address, without the API key
 - Text output 2: Response body
 - Text output 3: Status

 Wiring once this block is saved in Config:
 - Tank block: fresh and the tank command.
 - Car block: fresh, the car command, and the car kW.
 - FVE block: fresh, battery grid-charge, and battery kW.
 - On each of those three, tie a constant 1 to plan connected.
*/

#define INPUT_TRIGGER 0
#define INPUT_SOLAR   1
#define INPUT_API_KEY 0
#define INPUT_SERVER  1

#define OUTPUT_FRESH 0
#define OUTPUT_TANK_COMMAND 1
#define OUTPUT_CAR_COMMAND 2
#define OUTPUT_CAR_KW 3
#define OUTPUT_BATTERY_CHARGE 4
#define OUTPUT_BATTERY_KW 5
#define DEBUG_URL 0
#define DEBUG_RESPONSE 1
#define DEBUG_STATUS 2

#define VI_PLAN_FRESH "VI9"
#define VI_PLAN_TANK "VI10"
#define VI_PLAN_CAR "VI18"
#define VI_PLAN_CAR_KW "VI19"
#define VI_PLAN_BATTERY_CHARGE "VI20"
#define VI_PLAN_BATTERY_KW "VI21"

#define FETCH_SECONDS 900
#define FRESH_SECONDS 3600

char tankFlag[16];
char tankFrom[8];
char tankTo[8];
char carFlag[16];
char carFrom[8];
char carTo[8];
char carKwText[16];
char batteryFlag[24];
char batteryFrom[8];
char batteryTo[8];
char batteryKwText[16];
char batterySellFlag[8];
char batterySellFrom[8];
char batterySellTo[8];
char batterySellKwText[16];
int hasPlan;
int ageSeconds;
char lastError[80];

/* Skip HTTP response headers and return the body. */
char* skipHeaders(char* response) {
    char* body;
    if (response == NULL) return NULL;
    body = strstr(response, "\r\n\r\n");
    if (body != NULL) return body + 4;
    body = strstr(response, "\n\n");
    if (body != NULL) return body + 2;
    return response;
}

/* Copy the text after key= up to the end of the line. */
void copyValue(char* body, char* key, char* dest, int destSize) {
    char search[40];
    char* pos;
    int index;
    dest[0] = 0;
    sprintf(search, "%s=", key);
    pos = body;
    while (pos != NULL) {
        pos = strstr(pos, search);
        if (pos == NULL) return;
        if (pos == body || pos[-1] == '\n') break;
        pos = pos + 1;
    }
    pos = pos + strlen(search);
    index = 0;
    while (pos[0] != 0 && pos[0] != '\n' && pos[0] != '\r' && index < destSize - 1) {
        dest[index] = pos[0];
        index = index + 1;
        pos = pos + 1;
    }
    dest[index] = 0;
}

/* HH:MM to minutes after midnight. An empty clock is -1. */
int clockMinutes(char* clock) {
    int hour;
    int minute;
    if (clock[0] < '0' || clock[1] < '0' || clock[2] != ':' || clock[3] < '0' || clock[4] < '0')
        return -1;
    hour = (clock[0] - '0') * 10 + (clock[1] - '0');
    minute = (clock[3] - '0') * 10 + (clock[4] - '0');
    return hour * 60 + minute;
}

/* A slot that starts later than it ends crosses midnight. */
int insideSlot(int now, char* from, char* to) {
    int start;
    int end;
    start = clockMinutes(from);
    end = clockMinutes(to);
    if (start < 0 || end < 0 || start == end) return 0;
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;
}

/* One pull. A body that contains tank= replaces the stored plan. */
int pullPlan(char* serverAddress, char* apiKey) {
    char url[256];
    char* response;
    char* body;
    sprintf(url, "/api/energy/plan?apiKey=%s", apiKey);
    setoutputtext(DEBUG_URL, "/api/energy/plan");
    response = httpget(serverAddress, url);
    if (response == NULL) {
        sprintf(lastError, "error: no response from server");
        setoutputtext(DEBUG_RESPONSE, "");
        return 0;
    }
    body = skipHeaders(response);
    if (body == NULL) {
        sprintf(lastError, "error: no response from server");
        setoutputtext(DEBUG_RESPONSE, "");
        free(response);
        return 0;
    }
    setoutputtext(DEBUG_RESPONSE, body);
    if (strstr(body, "tank=") == NULL) {
        sprintf(lastError, "error: unexpected response");
        free(response);
        return 0;
    }
    lastError[0] = 0;
    copyValue(body, "tank", tankFlag, 16);
    copyValue(body, "tankFrom", tankFrom, 8);
    copyValue(body, "tankTo", tankTo, 8);
    copyValue(body, "car", carFlag, 16);
    copyValue(body, "carFrom", carFrom, 8);
    copyValue(body, "carTo", carTo, 8);
    copyValue(body, "carKw", carKwText, 16);
    copyValue(body, "battery", batteryFlag, 24);
    copyValue(body, "batteryFrom", batteryFrom, 8);
    copyValue(body, "batteryTo", batteryTo, 8);
    copyValue(body, "batteryKw", batteryKwText, 16);
    copyValue(body, "batterySell", batterySellFlag, 8);
    copyValue(body, "batterySellFrom", batterySellFrom, 8);
    copyValue(body, "batterySellTo", batterySellTo, 8);
    copyValue(body, "batterySellKw", batterySellKwText, 16);
    hasPlan = 1;
    free(response);
    return 1;
}

/* Write the decision for this minute. The key never leaves the block. */
void publishPlan() {
    int now;
    int fresh;
    int tankCommand;
    int carCommand;
    int batteryCharge;
    float carKw;
    float batteryKw;
    char status[256];
    now = gethour(getcurrenttime(), 1) * 60 + getminute(getcurrenttime(), 1);
    fresh = hasPlan && ageSeconds <= FRESH_SECONDS;
    tankCommand = -1;
    carCommand = -1;
    carKw = 0;
    batteryCharge = 0;
    batteryKw = 0;
    if (fresh && tankFlag[0] == '0')
        tankCommand = 0;
    if (fresh && tankFlag[0] == '1')
        tankCommand = insideSlot(now, tankFrom, tankTo);
    if (fresh && carFlag[0] == '0')
        carCommand = 0;
    if (fresh && carFlag[0] == '1') {
        carCommand = insideSlot(now, carFrom, carTo);
        if (carCommand)
            carKw = atof(carKwText);
    }
    if (fresh && batteryFlag[0] == 'g' && insideSlot(now, batteryFrom, batteryTo)) {
        batteryCharge = 1;
        batteryKw = atof(batteryKwText);
    } else if (fresh && batterySellFlag[0] == '1' && insideSlot(now, batterySellFrom, batterySellTo)) {
        batteryCharge = -1;
        batteryKw = atof(batterySellKwText);
    }
    setoutput(OUTPUT_FRESH, fresh);
    setoutput(OUTPUT_TANK_COMMAND, tankCommand);
    setoutput(OUTPUT_CAR_COMMAND, carCommand);
    setoutput(OUTPUT_CAR_KW, carKw);
    setoutput(OUTPUT_BATTERY_CHARGE, batteryCharge);
    setoutput(OUTPUT_BATTERY_KW, batteryKw);
    setio(VI_PLAN_FRESH, fresh);
    setio(VI_PLAN_TANK, tankCommand);
    setio(VI_PLAN_CAR, carCommand);
    setio(VI_PLAN_CAR_KW, carKw);
    setio(VI_PLAN_BATTERY_CHARGE, batteryCharge);
    setio(VI_PLAN_BATTERY_KW, batteryKw);
    if (lastError[0] != 0)
        sprintf(status, "%s", lastError);
    else if (!hasPlan)
        sprintf(status, "no plan yet");
    else if (!fresh)
        sprintf(status, "plan is stale");
    else
        sprintf(status, "fresh tank=%s car=%s battery=%s", tankFlag, carFlag, batteryFlag);
    setoutputtext(DEBUG_STATUS, status);
}

int ticks;
float solarKwh;
char* apiKey;
char* serverAddress;

hasPlan = 0;
ageSeconds = FRESH_SECONDS + 1;
lastError[0] = 0;
ticks = 0;
tankFlag[0] = 0;
carFlag[0] = 0;
batteryFlag[0] = 0;

while (TRUE) {
    solarKwh = getinput(INPUT_SOLAR);
    if (ticks == 0 || ageSeconds >= FETCH_SECONDS) {
        apiKey = getinputtext(INPUT_API_KEY);
        serverAddress = getinputtext(INPUT_SERVER);
        if (apiKey == NULL || serverAddress == NULL || apiKey[0] == 0 || serverAddress[0] == 0) {
            sprintf(lastError, "error: missing api key or server");
            setoutputtext(DEBUG_URL, "");
            setoutputtext(DEBUG_RESPONSE, "");
        } else if (pullPlan(serverAddress, apiKey)) {
            ageSeconds = 0;
        }
        ticks = 1;
    }
    publishPlan();
    ageSeconds = ageSeconds + 1;
    sleep(1000);
}
