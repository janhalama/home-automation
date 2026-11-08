/*
 Loxone programming block for calculating ECO charging power based on solar power production and battery SOC.
 
 Inputs:
 Input 1 - User configuration for minimum ECO power when SOC above threshold
 Input 2 - Current PV solar power production
 Input 3 - Battery SOC
 Input 4 - User configuration for SOC threshold to charge with ECO power
 Input 5 - Grid power in kW. Positive while the house exports. Do not insert this in front of the others.
 Input 6 - Battery power in kW. Positive while the battery discharges. Negative while it charges.

 Plan: fresh is VI9, Plan: car is VI18, Plan: car kW is VI19. No wire from the planner.
 Plan car 2 means leftover sun: the battery must be above 30 percent, and the car gets only power the house is not using.
 Plan car 3 means the upper half of the house battery: charge at the plan kW, which is 6, while the battery is above 50 percent, then stop. It starts again only after the battery has climbed back above 52 percent, so it does not nibble the house half. Direct sun on top of the 6 kW may raise the charge up to 11 kW. The grid does not finish that charge. A grid slot stays at the plan kW, up to 11.

 Outputs:
 Output 1 - The result is ECO charging power to be assigned to Wallbox Manager
 Output 2 - Eco charging enabled flag
 Text Output 1 - Debug information
*/

#define SECONDS_IN_A_MINUTE 60
#define SOC_HYSTERESIS_MARGIN 2.0 // Hysteresis margin for SOC to avoid frequent switching charging on/off
#define SURPLUS_SOC 30.0
#define SURPLUS_COMMAND 2.0
#define BATTERY_COMMAND 3.0
#define UPPER_HALF_SOC 50.0
#define CAR_MAX_KW 11.0
#define BATTERY_CAR_KW 6.0
#define SURPLUS_MIN_KW 1.0
#define ONE_SECOND_SLEEP 1000 // Sleep for 1s in the main loop
#define VI_PLAN_FRESH "VI9"
#define VI_PLAN_CAR "VI18"
#define VI_PLAN_CAR_KW "VI19"

float userConfigEcoPower;
float userConfigSocTreshold;
float currentSolarPowerProduction;
float batterySoc;
float solarPowerReadings[SECONDS_IN_A_MINUTE];
int solarPowerReadingsIndex = 0;
float averagePower;
float highSOCPower; // Power to charge the car when SOC is above threshold
int carCharging = 0; // Flag to track if car charging is on
int loopIndex;
char debugOutput[2048];
float ecoPower = 0.0;

// Initialize the readings array
for (loopIndex = 0; loopIndex < SECONDS_IN_A_MINUTE; loopIndex++) {
    solarPowerReadings[loopIndex] = 0.0;
}

while (TRUE) {
    int planFresh;
    float planCarCommand;
    userConfigEcoPower = getinput(0);
    currentSolarPowerProduction = getinput(1);
    batterySoc = getinput(2);
    userConfigSocTreshold = getinput(3);
    planFresh = getio(VI_PLAN_FRESH) == 1;
    planCarCommand = getio(VI_PLAN_CAR);

    solarPowerReadings[solarPowerReadingsIndex] = currentSolarPowerProduction;
    solarPowerReadingsIndex = (solarPowerReadingsIndex + 1) % SECONDS_IN_A_MINUTE;

    if (planFresh && planCarCommand >= BATTERY_COMMAND) {
        int socAllows;
        float gridKw;
        float batteryKw;
        float fromBattery;
        float direct;
        if (carCharging)
            socAllows = batterySoc >= UPPER_HALF_SOC;
        else
            socAllows = batterySoc >= UPPER_HALF_SOC + SOC_HYSTERESIS_MARGIN;
        if (socAllows) {
            gridKw = getinput(4);
            batteryKw = getinput(5);
            fromBattery = getio(VI_PLAN_CAR_KW);
            if (fromBattery < 1)
                fromBattery = BATTERY_CAR_KW;
            if (fromBattery > CAR_MAX_KW)
                fromBattery = CAR_MAX_KW;
            direct = gridKw - batteryKw + ecoPower;
            if (direct < 0)
                direct = 0;
            ecoPower = fromBattery + direct;
            if (ecoPower > CAR_MAX_KW)
                ecoPower = CAR_MAX_KW;
            carCharging = 1;
        } else {
            ecoPower = 0;
            carCharging = 0;
        }
        setoutput(0, ecoPower);
        setoutput(1, carCharging);
    } else if (planFresh && planCarCommand >= SURPLUS_COMMAND) {
        float gridKw;
        float batteryKw;
        float surplus;
        float minimumKw;
        int socAllows;
        gridKw = getinput(4);
        batteryKw = getinput(5);
        surplus = gridKw - batteryKw + ecoPower;
        if (surplus < 0)
            surplus = 0;
        if (surplus > CAR_MAX_KW)
            surplus = CAR_MAX_KW;
        minimumKw = userConfigEcoPower;
        if (minimumKw < SURPLUS_MIN_KW)
            minimumKw = SURPLUS_MIN_KW;
        if (carCharging)
            socAllows = batterySoc >= SURPLUS_SOC - SOC_HYSTERESIS_MARGIN;
        else
            socAllows = batterySoc >= SURPLUS_SOC;
        if (socAllows && surplus >= minimumKw) {
            ecoPower = surplus;
            carCharging = 1;
        } else {
            ecoPower = 0;
            carCharging = 0;
        }
        setoutput(0, ecoPower);
        setoutput(1, carCharging);
    } else if (planFresh && planCarCommand >= 0) {
        if (planCarCommand >= 1) {
            ecoPower = getio(VI_PLAN_CAR_KW);
            carCharging = 1;
        } else {
            ecoPower = 0;
            carCharging = 0;
        }
        setoutput(0, ecoPower);
        setoutput(1, carCharging);
    } else if (solarPowerReadingsIndex == 0) {  // Every minute
        float sum = 0.0;
        for (loopIndex = 0; loopIndex < SECONDS_IN_A_MINUTE; loopIndex++) {
            sum += solarPowerReadings[loopIndex];
        }
        averagePower = sum / SECONDS_IN_A_MINUTE;

        // Choose the higher of the two values as the power to charge the car in case SOC is above threshold
        if(averagePower > userConfigEcoPower) {
            highSOCPower = averagePower;
        } else {
            highSOCPower = userConfigEcoPower;
        }

        if (carCharging) {
            // If car is already charging, use lower SOC threshold (threshold - SOC_HYSTERESIS_MARGIN)
            if (batterySoc >= userConfigSocTreshold - SOC_HYSTERESIS_MARGIN) {
                ecoPower = highSOCPower;
            } else {
                ecoPower = 0;
                carCharging = 0;
            }
        } else {
            // If car is not charging, use higher SOC threshold
            if (batterySoc >= userConfigSocTreshold) {
                ecoPower = highSOCPower;
                carCharging = 1;
            }
        }

        setoutput(0, ecoPower);
        setoutput(1, carCharging);
    }

     sprintf(debugOutput,
             "Inputs\n\nUser config ECO Power: %f kW\nSolar Power: %f kW\nBattery SOC: %f percent\nSOC Threshold: %f percent\n\nState\n\nHigh SOC Power: %f kW\nAverage Power: %f kW\n\nOutputs\n\nCar Charging Enabled: %d\nECO Power: %f kW\n\n",
             userConfigEcoPower,
             currentSolarPowerProduction,
             batterySoc,
             userConfigSocTreshold,
             highSOCPower,
             averagePower,
             carCharging,
             ecoPower);

     setoutputtext(0, debugOutput);

    sleep(ONE_SECOND_SLEEP);
}
