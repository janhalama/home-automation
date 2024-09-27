/*
 Loxone programming block controlling the water tank heating.

 Inputs:
 - Input 1: Water tank temperature is bellow treshold, and should be charged
 - Input 2: The spot price is very low
 - Input 3: PV production prediction for today
 - Input 4: PV production prediction for tomorrow
 - Input 5: Inverter working mode
 - Input 6: Morning push to grid enabled
 - Input 7: Enable priority charging (charges whenever the temperature is below treshold)

 Outputs:
 - Output 1: Heating On / Off
 - Text Output 1: Debug information

*/

// Constants for output indexes
#define OUTPUT_HEATING_ON_OFF 0

// Constants for text output indexes
#define TEXT_OUTPUT_DEBUG 0

// Define input indexes as constants
#define INPUT_WATER_TANK_TEMPERATURE_BELOW_TRESHOLD 0
#define INPUT_SPOT_PRICE_VLOW 1
#define INPUT_PREDICTED_PV_TODAY 2
#define INPUT_PREDICTED_PV_TOMORROW 3
#define INPUT_INVERTER_MODE 4
#define INPUT_MORNING_PUSH_TO_GRID_ENABLED 5
#define INPUT_PRIORITY_CHARGING_ENABLED 6

// Virtual input connection addresses
#define VI_PV_POWER_NOW "AMQ125"

// This is exactly the power the water heater consumes when heating on
#define PV_POWER_THRESHOLD_IN_KW 2.5

// This is the minimum power the PV should produce to charge the water tank and supply the house during the day
#define PV_LOW_PRODUCTION_THRESHOLD_IN_KW 15

// Define constants for inverter modes
#define INVERTER_GENERAL_MODE 257
#define INVERTER_ECONOMIC_MODE 258
#define INVERTER_UPS_MODE 259


// Control the heating based on the inputs
void controlHeating() {

    char inputs[1024];
    int temperatureBelowTreshold = getinput(INPUT_WATER_TANK_TEMPERATURE_BELOW_TRESHOLD) == 1;
    int spotPriceIsVeryLow = getinput(INPUT_SPOT_PRICE_VLOW) == 1;
    float predictedPVToday = getinput(INPUT_PREDICTED_PV_TODAY);
    float predictedPVTomorrow = getinput(INPUT_PREDICTED_PV_TOMORROW);
    int inverterMode = getinput(INPUT_INVERTER_MODE);
    int morningPushToGridEnabled = getinput(INPUT_MORNING_PUSH_TO_GRID_ENABLED) == 1;
    int priorityChargingEnabled = getinput(INPUT_PRIORITY_CHARGING_ENABLED) == 1;
    float pwPowerNow = getio(VI_PV_POWER_NOW);
    int hourNow = gethour(getcurrenttime(), 1);
    int canCharge = 0;
    int sufficientPVPowerNow = pwPowerNow > PV_POWER_THRESHOLD_IN_KW;
    int sufficientPVProductionToday = predictedPVToday > PV_LOW_PRODUCTION_THRESHOLD_IN_KW;
    int sufficientPVProductionTomorrow = predictedPVTomorrow > PV_LOW_PRODUCTION_THRESHOLD_IN_KW;
    
    // TODO: use better algorithm to determine that the hour is during the day (sunrise to sunset)
    if(hourNow >= 6 && hourNow < 21) {
        // During the day
        canCharge = !sufficientPVProductionToday || (sufficientPVPowerNow && spotPriceIsVeryLow);
    } else {
        // During the night
        canCharge = !sufficientPVProductionTomorrow && spotPriceIsVeryLow;
    }

    // Do not charge the water tank if the morning push to grid is enabled, it may cause charging the water tank with grid power
    setoutput(OUTPUT_HEATING_ON_OFF, (priorityChargingEnabled || canCharge) && temperatureBelowTreshold && !morningPushToGridEnabled);

    sprintf(inputs,
            "Inputs:\n - Water tank temperature below treshold: %d\n - Spot price is very low: %d\n - Predicted PV production for tomorrow: %f\n - Predicted PV production for today: %f\n - Current PV production: %f\n - Can charge: %d\n - Morning push to grid enabled: %d",
            temperatureBelowTreshold,
            spotPriceIsVeryLow,
            predictedPVTomorrow,
            predictedPVToday,
            pwPowerNow,
            canCharge,
            morningPushToGridEnabled);

    // Set text output for debug inputs
    setoutputtext(TEXT_OUTPUT_DEBUG, inputs);
}

// Main loop
while(TRUE) {
    controlHeating();

    sleep(1000);  // Sleep for 1000ms
}
