/*
 Loxone programming block for managing the state of a Wattsonic inverter based on spot prices, SOC, predicted PV production, and various thresholds.

 Inputs:
 - Input 1: Current spot price
 - Input 2: Minimum spot price today
 - Input 3: Maximum spot price today
 - Input 4: Spot price threshold to charge from grid
 - Input 5: Spot price threshold to discharge battery to grid
 - Input 6: SOC treshold to discharge battery to grid and or postpone PV charging in the morning
 - Input 7: Current inverter working mode
 - Input 8: Predicted PV production today
 - Input 9: Predicted PV production tomorrow
 - Input 10: Predicted PV production treshold to push to grid
 - Input 11: Spot price threshold to enable PV push to grid
 - Input 12: SOC

 Outputs:
 - Output 1: Inverter working mode
 - Output 2: Battery mode
 - Output 3: Charge & Discharge periods
 - Output 4: Battery Charge By
 - Output 5: Battery Charge & Discharge Power Limit
 - Output 6: Grid Injection Power Limit
 - Text Output 1: Current inverter working mode
 - Text Output 2: Inverter state
 - Text Output 3: Debug information

Wattsonic inverter G3 Modbus registers documentation:
https://smarthome.exposed/wattsonic-hybrid-inverter-gen3-modbus-rtu-protocol
*/

// Define constants for inverter modes
#define INVERTER_GENERAL_MODE 257
#define INVERTER_ECONOMIC_MODE 258
#define INVERTER_UPS_MODE 259

// Define battery modes
#define BATTERY_NO_MODE 0
#define BATTERY_CHARGE_MODE 1
#define BATTERY_DISCHARGE_MODE 2

// Constants for inverter state
#define MORNING_HOURS_TILL 12
#define BATTERY_POWER_LIMIT_MAX 80
#define BATTERY_POWER_LIMIT_OFF 0
#define GRID_INJECTION_POWER_LIMIT_MAX 80
#define GRID_INJECTION_POWER_LIMIT_OFF 0

// Constants for output indexes
#define OUTPUT_MODE 0
#define OUTPUT_BATTERY_MODE 1
#define OUTPUT_PERIOD_ENABLED 2
#define OUTPUT_BATTERY_CHARGE_BY 3
#define OUTPUT_BATTERY_CHARGE_DISCHARGE_LIMIT 4
#define OUTPUT_GRID_INJECTION_LIMIT 5

// Constants for text output indexes
#define TEXT_OUTPUT_MODE 0
#define TEXT_OUTPUT_INVERTER_STATE 1
#define TEXT_OUTPUT_DEBUG_INPUTS 2

// Virtual input connection addresses
#define VI_PV_PRODUCTION_TODAY "VI1"
#define VI_PV_PRODUCTION_TOMMORROW "VI2"

// Define input indexes as constants
#define INPUT_CURRENT_SPOT_PRICE 0
#define INPUT_MIN_SPOT_PRICE 1
#define INPUT_MAX_SPOT_PRICE 2
#define INPUT_CHARGE_THRESHOLD 3
#define INPUT_DISCHARGE_THRESHOLD 4
#define INPUT_SOC_THRESHOLD 5
#define INPUT_CURRENT_INVERTER_MODE 6
#define INPUT_PREDICTED_PV_TODAY 7
#define INPUT_PREDICTED_PV_TOMORROW 8
#define INPUT_PV_PRODUCTION_THRESHOLD 9
#define INPUT_SPOT_PRICE_THRESHOLD 10
#define INPUT_SOC 11

// Function to map inverter mode to a human-readable string
char* mapInverterMode(float mode) {
    if(mode == INVERTER_GENERAL_MODE) {
        return "General mode";
    } else if(mode == INVERTER_ECONOMIC_MODE) {
        return "Economic mode";
    } else if(mode == INVERTER_UPS_MODE) {
        return "UPS mode";
    } else {
        return "Unknown mode";
    }
}

// Function to determine the correct inverter state
void updateInverterState() {

    float currentSpotPrice = getinput(INPUT_CURRENT_SPOT_PRICE);
    float minSpotPrice = getinput(INPUT_MIN_SPOT_PRICE);
    float maxSpotPrice = getinput(INPUT_MAX_SPOT_PRICE);
    float chargeSpotPriceThreshold = getinput(INPUT_CHARGE_THRESHOLD);
    float dischargeSpotPriceThreshold = getinput(INPUT_DISCHARGE_THRESHOLD);
    float socTreshold = getinput(INPUT_SOC_THRESHOLD);
    float currentInverterMode = getinput(INPUT_CURRENT_INVERTER_MODE);
    float predictedPVToday = getinput(INPUT_PREDICTED_PV_TODAY);
    float predictedPVTommorrow = getinput(INPUT_PREDICTED_PV_TOMORROW);
    float pvProductionThreshold = getinput(INPUT_PV_PRODUCTION_THRESHOLD);
    float spotPriceTreshold = getinput(INPUT_SPOT_PRICE_THRESHOLD);
    float soc = getinput(INPUT_SOC);
    float newMode = currentInverterMode;
    int batteryMode = BATTERY_NO_MODE;
    int batteryChargeDischargePowerLimit = BATTERY_POWER_LIMIT_OFF;
    int gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_OFF;
    int hourNow = gethour(getcurrenttime(), 1);
    char inverterState[512];
    char inputs[1024];

    // Determine the inverter mode and battery operation

    if (currentSpotPrice < chargeSpotPriceThreshold) {
        newMode = INVERTER_ECONOMIC_MODE;
        batteryMode = BATTERY_CHARGE_MODE; // Charge from grid
        batteryChargeDischargePowerLimit = BATTERY_POWER_LIMIT_MAX; // Limit battery charging power to max allowed value
        sprintf(inverterState, "Charging from grid");
    } else if (fabs(maxSpotPrice - currentSpotPrice) <= 0.5 && // Spot price is close to max
               currentSpotPrice >= dischargeSpotPriceThreshold && // Spot price is above discharge threshold
               soc > socTreshold) { // SOC is above threshold
        newMode = INVERTER_ECONOMIC_MODE;
        batteryMode = BATTERY_DISCHARGE_MODE; // Discharge to grid
        batteryChargeDischargePowerLimit = BATTERY_POWER_LIMIT_MAX; // Limit discharging power to max allowed value
        gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_MAX; // Allow maximum allowed power to be injected to grid
        sprintf(inverterState, "Discharging to grid");
    } else if (1 == 0 && // Disable morning PV push to grid mode for now, the battery is being discharged to grid, need to figure out how to handle this
               currentSpotPrice > spotPriceTreshold && 
               predictedPVToday > pvProductionThreshold &&
               soc > socTreshold &&
               hourNow < MORNING_HOURS_TILL) { //only in morning hours
        newMode = INVERTER_ECONOMIC_MODE;
        batteryMode = BATTERY_NO_MODE; // None - do not charge & discharge
        batteryChargeDischargePowerLimit = BATTERY_POWER_LIMIT_OFF; // Switch off battery discharging by setting limit to 0
        gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_MAX; // Allow maximum allowed power to be injected to grid
        sprintf(inverterState, "Morning push to grid");
    } else {
        newMode = INVERTER_GENERAL_MODE;
        if(currentSpotPrice > spotPriceTreshold) {
            gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_MAX; // Allow maximum allowed power to be injected to grid
            sprintf(inverterState, "Grid injection enabled");
        } else {
            gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_OFF; // Do not inject power to grid
            sprintf(inverterState, "Grid injection disabled");
        }
    }

    setoutput(OUTPUT_MODE, newMode);
    setoutput(OUTPUT_BATTERY_MODE, batteryMode);
    setoutput(OUTPUT_PERIOD_ENABLED, 1); // Period 1 is enabled
    setoutput(OUTPUT_BATTERY_CHARGE_BY, 1); // Battery charges by PV+Grid
    setoutput(OUTPUT_BATTERY_CHARGE_DISCHARGE_LIMIT, batteryChargeDischargePowerLimit * 10); // Battery Charge&Discharge Power Limit
    setoutput(OUTPUT_GRID_INJECTION_LIMIT, gridInjectionPowerLimit * 10); // Set grid injection power limit based on current spot price

    // Set text output for inverter mode
    setoutputtext(TEXT_OUTPUT_MODE, mapInverterMode(newMode));

    // Set text output for inverter state
    setoutputtext(TEXT_OUTPUT_INVERTER_STATE, inverterState);

    sprintf(inputs,
            "Current spot price: %f\nMin spot price today: %f\nMax spot price today: %f\nCharge threshold: %f\nDischarge threshold: %f\nSOC threshold: %f\nCurrent inverter mode: %s\nPredicted PV today: %f\nPredicted PV tomorrow: %f\nPV production prediction threshold to discharge to grid or postpone morning production: %f\nSpot price threshold to push to grid: %f\nSOC: %f\nHour: %f\nBattery charge/discharge power limit: %d kW\nGrid injection power limit: %d kW\n",
            currentSpotPrice,
            minSpotPrice,
            maxSpotPrice,
            chargeSpotPriceThreshold,
            dischargeSpotPriceThreshold,
            socTreshold,
            mapInverterMode(currentInverterMode),
            predictedPVToday, 
            predictedPVTommorrow,
            pvProductionThreshold,
            spotPriceTreshold,
            soc,
            hourNow,
            batteryChargeDischargePowerLimit,
            gridInjectionPowerLimit);

    // Set text output for debug inputs
    setoutputtext(TEXT_OUTPUT_DEBUG_INPUTS, inputs);
}

// Main loop
while(TRUE) {
    updateInverterState();

    sleep(1000);  // Sleep for 1000ms
}