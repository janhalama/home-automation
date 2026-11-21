/*
 Loxone programming block that pulls the energy plan and holds the live decision.

 This replaces the forecast fetch block. The trigger is not used.
 The block fetches when it starts, and again every 10 minutes.
 A failed fetch tries again after 10 minutes. Retrying every second runs the block out of memory.
 httpget has no timeout, so a fetch is a TCP stream read. Each read waits at most
 15 seconds. A stuck call is given up, and the stored plan stays until a later pull works.
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
 - Output 3: Car command. 1 grid slot, 2 leftover sun, 3 the upper half of the house battery, 0 stay off, -1 the car block keeps its own rule
 - Output 4: Car power cap in kW while the car command is 1
 - Output 5: Battery command. 1 charge, -1 sell, 2 hold so the house takes the grid, 0 neither
 - Output 6: Battery charge power in kW while output 5 is on
 - Text output 1: Requested address, without the API key
 - Text output 2: Response body
 - Text output 3: Status

 Virtual input VI23 is the fetch heartbeat. The thousands digit is the phase,
 and the rest counts seconds while the loop is running.
 - 0: started, no pull yet
 - 1: inside the server call. A number that stays here means the call is stuck
 - 2: the last pull stored a plan
 - 3: the server did not answer
 - 4: the API key or the server address is missing
 - 5: the body was not a plan
 A value that stays 0 means this block is not running.

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
#define VI_PLAN_RESERVE_SOC "VI22"
#define VI_PLAN_FETCH "VI23"
#define FETCH_PHASE_SCALE 1000
#define FETCH_PHASE_START 0
#define FETCH_PHASE_CALLING 1
#define FETCH_PHASE_STORED 2
#define FETCH_PHASE_NO_RESPONSE 3
#define FETCH_PHASE_MISSING 4
#define FETCH_PHASE_UNEXPECTED 5

#define FETCH_SECONDS 600
#define RETRY_SECONDS 600
#define FRESH_SECONDS 3600
#define HTTP_TIMEOUT_MS 15000
#define HTTP_BODY_SIZE 4096
#define HTTP_READ_LIMIT 4

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
char batteryHoldFlag[8];
char batteryHoldFrom[8];
char batteryHoldTo[8];
char reserveSocText[16];
int hasPlan;
int fetchFailed;
int sinceFetch;
int sinceAttempt;
int fetchPhase;
int fetchBeat;
int httpTimedOut;
char httpBody[HTTP_BODY_SIZE];
char lastError[80];
char pollErrorCode[32];

/* Remember the phase and publish it. The beat keeps moving only while this loop does. */
void markFetch(int phase) {
    fetchPhase = phase;
    setio(VI_PLAN_FETCH, phase * FETCH_PHASE_SCALE + (fetchBeat % FETCH_PHASE_SCALE));
}

/* Split a server address into host and port. The port text is 80 when the address has none. */
int copyHostPort(char* server, char* host, int hostSize, char* port, int portSize) {
    char* colon;
    int hostLength;
    int portLength;
    int index;
    colon = strstr(server, ":");
    if (colon == NULL) {
        hostLength = strlen(server);
        if (hostLength <= 0 || hostLength >= hostSize)
            return 0;
        sprintf(host, "%s", server);
        sprintf(port, "80");
        return 1;
    }
    hostLength = colon - server;
    portLength = strlen(colon + 1);
    if (hostLength <= 0 || hostLength >= hostSize || portLength <= 0 || portLength >= portSize)
        return 0;
    index = 0;
    while (index < hostLength) {
        host[index] = server[index];
        index = index + 1;
    }
    host[hostLength] = 0;
    sprintf(port, "%s", colon + 1);
    return 1;
}

/* Byte index of the body, or -1 while the headers are still incomplete. */
int headerBytes(char* text) {
    char* marker;
    marker = strstr(text, "\r\n\r\n");
    if (marker != NULL)
        return (marker - text) + 4;
    marker = strstr(text, "\n\n");
    if (marker != NULL)
        return (marker - text) + 2;
    return -1;
}

/* Bytes the server promised, or -1 when the header does not say. */
int contentLength(char* text) {
    char* marker;
    int value;
    marker = strstr(text, "Content-Length:");
    if (marker == NULL)
        marker = strstr(text, "content-length:");
    if (marker == NULL)
        return -1;
    marker = marker + 15;
    while (marker[0] == ' ')
        marker = marker + 1;
    value = 0;
    if (marker[0] < '0' || marker[0] > '9')
        return -1;
    while (marker[0] >= '0' && marker[0] <= '9') {
        value = value * 10 + (marker[0] - '0');
        marker = marker + 1;
    }
    return value;
}

/* GET one page and stop when the server sends nothing. The buffer is reused and must not be freed. */
char* httpGet(char* serverAddress, char* page) {
    char host[80];
    char port[8];
    char device[112];
    char request[768];
    char hostHeader[96];
    STREAM* stream;
    int got;
    int count;
    int reads;
    int headers;
    int length;

    httpTimedOut = 0;
    if (copyHostPort(serverAddress, host, 80, port, 8) == 0)
        return NULL;
    sprintf(device, "/dev/tcp/%s/%s", host, port);
    stream = stream_create(device, 0, 0);
    if (stream == NULL)
        return NULL;
    if (port[0] == '8' && port[1] == '0' && port[2] == 0)
        sprintf(hostHeader, "%s", host);
    else
        sprintf(hostHeader, "%s:%s", host, port);
    sprintf(request, "GET %s HTTP/1.0\r\nHost: %s\r\nConnection: close\r\n\r\n", page, hostHeader);
    stream_write(stream, request, strlen(request));
    stream_flush(stream);
    got = 0;
    httpBody[0] = 0;
    reads = 0;
    while (reads < HTTP_READ_LIMIT && got < HTTP_BODY_SIZE - 1) {
        count = stream_read(stream, httpBody + got, HTTP_BODY_SIZE - 1 - got, HTTP_TIMEOUT_MS);
        reads = reads + 1;
        if (count <= 0)
            break;
        got = got + count;
        httpBody[got] = 0;
        headers = headerBytes(httpBody);
        length = contentLength(httpBody);
        if (headers >= 0 && length >= 0 && got >= headers + length)
            break;
    }
    stream_close(stream);
    if (got <= 0) {
        httpTimedOut = 1;
        return NULL;
    }
    return httpBody;
}

/* Tell the API why this pull failed. A short code keeps the key's request small. */
void reportPollError(char* serverAddress, char* apiKey) {
    char url[512];
    if (pollErrorCode[0] == 0)
        return;
    sprintf(url, "/api/energy/plan-log?apiKey=%s&error=%s", apiKey, pollErrorCode);
    httpGet(serverAddress, url);
}

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
    markFetch(FETCH_PHASE_CALLING);
    response = httpGet(serverAddress, url);
    if (response == NULL) {
        if (httpTimedOut)
            sprintf(lastError, "error: timed out");
        else
            sprintf(lastError, "error: no response from server");
        if (httpTimedOut)
            sprintf(pollErrorCode, "timeout");
        else
            sprintf(pollErrorCode, "no_response");
        markFetch(FETCH_PHASE_NO_RESPONSE);
        setoutputtext(DEBUG_RESPONSE, "");
        return 0;
    }
    body = skipHeaders(response);
    if (body == NULL) {
        sprintf(lastError, "error: no response from server");
        sprintf(pollErrorCode, "no_response");
        markFetch(FETCH_PHASE_NO_RESPONSE);
        setoutputtext(DEBUG_RESPONSE, "");
        return 0;
    }
    setoutputtext(DEBUG_RESPONSE, body);
    if (strstr(body, "tank=") == NULL) {
        sprintf(lastError, "error: unexpected response");
        sprintf(pollErrorCode, "unexpected_response");
        markFetch(FETCH_PHASE_UNEXPECTED);
        return 0;
    }
    lastError[0] = 0;
    pollErrorCode[0] = 0;
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
    copyValue(body, "batteryHold", batteryHoldFlag, 8);
    copyValue(body, "batteryHoldFrom", batteryHoldFrom, 8);
    copyValue(body, "batteryHoldTo", batteryHoldTo, 8);
    copyValue(body, "reserveSoc", reserveSocText, 16);
    hasPlan = 1;
    markFetch(FETCH_PHASE_STORED);
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
    fresh = hasPlan && sinceFetch <= FRESH_SECONDS;
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
    if (fresh && carFlag[0] == 's')
        carCommand = 2;
    if (fresh && carFlag[0] == 'b') {
        carCommand = 3;
        carKw = atof(carKwText);
    }
    if (fresh && batteryFlag[0] == 'g' && insideSlot(now, batteryFrom, batteryTo)) {
        float room;
        batteryCharge = 1;
        batteryKw = atof(batteryKwText);
        // 1 kW stays free for the house. The car is the short load, so the battery
        // only slows down while that slot, and the tank slot, are actually on.
        room = 16.0;
        if (tankCommand == 1)
            room = room - 2.5;
        if (carCommand == 1)
            room = room - carKw;
        if (room < 0)
            room = 0;
        if (batteryKw > room)
            batteryKw = room;
    } else if (fresh && batterySellFlag[0] == '1' && insideSlot(now, batterySellFrom, batterySellTo)) {
        batteryCharge = -1;
        batteryKw = atof(batterySellKwText);
    } else if (fresh && batteryHoldFlag[0] == '1' && insideSlot(now, batteryHoldFrom, batteryHoldTo)) {
        batteryCharge = 2;
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
    setio(VI_PLAN_RESERVE_SOC, atof(reserveSocText));
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

float solarKwh;
int waitSeconds;
char* apiKey;
char* serverAddress;

hasPlan = 0;
fetchFailed = 0;
sinceFetch = FRESH_SECONDS + 1;
sinceAttempt = FETCH_SECONDS;
fetchPhase = FETCH_PHASE_START;
fetchBeat = 0;
lastError[0] = 0;
pollErrorCode[0] = 0;
tankFlag[0] = 0;
carFlag[0] = 0;
batteryFlag[0] = 0;

while (TRUE) {
    solarKwh = getinput(INPUT_SOLAR);
    waitSeconds = FETCH_SECONDS;
    if (fetchFailed)
        waitSeconds = RETRY_SECONDS;
    if (sinceAttempt >= waitSeconds) {
        apiKey = getinputtext(INPUT_API_KEY);
        serverAddress = getinputtext(INPUT_SERVER);
        if (apiKey == NULL || serverAddress == NULL || apiKey[0] == 0 || serverAddress[0] == 0) {
            sprintf(lastError, "error: missing api key or server");
            sprintf(pollErrorCode, "missing_config");
            markFetch(FETCH_PHASE_MISSING);
            setoutputtext(DEBUG_URL, "");
            setoutputtext(DEBUG_RESPONSE, "");
            fetchFailed = 1;
        } else if (pullPlan(serverAddress, apiKey)) {
            sinceFetch = 0;
            fetchFailed = 0;
        } else {
            fetchFailed = 1;
            reportPollError(serverAddress, apiKey);
        }
        sinceAttempt = 0;
    }
    publishPlan();
    markFetch(fetchPhase);
    fetchBeat = fetchBeat + 1;
    sinceFetch = sinceFetch + 1;
    sinceAttempt = sinceAttempt + 1;
    sleep(1000);
}
