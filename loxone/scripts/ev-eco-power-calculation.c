/*
 Loxone programming block for calculating ECO charging power based on solar power production and battery SOC.
 
 Inputs:
 Input 1 - User configuration for minimum ECO power when SOC above threshold
 Input 2 - Current PV solar power production
 Input 3 - Battery SOC
 Input 4 - User configuration for SOC threshold to charge with ECO power

 Outputs:
 Output 1 - The result is ECO charging power to be assigned to Wallbox Manager
 Output 2 - Eco charging enabled flag
 Text Output 1 - Debug information
*/

#define SECONDS_IN_A_MINUTE 60
#define SOC_HYSTERESIS_MARGIN 2.0 // Hysteresis margin for SOC to avoid frequent switching charging on/off
#define ONE_SECOND_SLEEP 1000 // Sleep for 1s in the main loop

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
    userConfigEcoPower = getinput(0);
    currentSolarPowerProduction = getinput(1);
    batterySoc = getinput(2);
    userConfigSocTreshold = getinput(3);

    solarPowerReadings[solarPowerReadingsIndex] = currentSolarPowerProduction;
    solarPowerReadingsIndex = (solarPowerReadingsIndex + 1) % SECONDS_IN_A_MINUTE;

    if (solarPowerReadingsIndex == 0) {  // Every minute
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
