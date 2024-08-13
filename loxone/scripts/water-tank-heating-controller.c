/*
 Loxone programming block controlling the water tank heating.

 Inputs:
 - Input 1: Water tank temperature is bellow treshold, and should be charged
 - Input 2: The spot price is very low
 - Input 3: PV production prediction for today
 - Input 4: PV production prediction for tomorrow

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

// Virtual input connection addresses
#define VI_PV_POWER_NOW "AMQ125"

#define PV_POWER_THRESHOLD_IN_KW 2.5 // This is exactly the power the water heater consumes
#define PV_LOW_PRODUCTION_THRESHOLD_IN_KW 15 // This is the minimum power the PV should produce to charge the water tank and supply the house


// Control the heating based on the inputs
void controlHeating() {

    char inputs[1024];
    float temperatureBelowTreshold = getinput(INPUT_WATER_TANK_TEMPERATURE_BELOW_TRESHOLD);
    float spotPriceIsVeryLow = getinput(INPUT_SPOT_PRICE_VLOW);
    float predictedPVToday = getinput(INPUT_PREDICTED_PV_TODAY);
    float predictedPVTommorrow = getinput(INPUT_PREDICTED_PV_TOMORROW);
    float pwPowerNow = getio(VI_PV_POWER_NOW);
    int hourNow = gethour(getcurrenttime(), 1);

    if(temperatureBelowTreshold) {
        if(hourNow >= 6 && hourNow <= 20) { // During the day
            if(spotPriceIsVeryLow && (predictedPVToday < PV_LOW_PRODUCTION_THRESHOLD_IN_KW)) { // Charge even though the PV power now is low, when the prediction for todays production is low
                setoutput(OUTPUT_HEATING_ON_OFF, 1);
            } else { // The PV power is high enough, charge only if there is enough PV production at the moment
                if (spotPriceIsVeryLow && (pwPowerNow > PV_POWER_THRESHOLD_IN_KW)) {
                    setoutput(OUTPUT_HEATING_ON_OFF, 1);
                } else { // Do not charge if the PV production is not high enough or the spot price is not very low
                    setoutput(OUTPUT_HEATING_ON_OFF, 0);
                }
            }
        } else { // During the night
            if(spotPriceIsVeryLow && (predictedPVTommorrow < PV_LOW_PRODUCTION_THRESHOLD_IN_KW)) { // Charge the water tank during the night if the PV production prediction for tomorrow is low and the spot price is very low
                setoutput(OUTPUT_HEATING_ON_OFF, 1);
            } else {
                setoutput(OUTPUT_HEATING_ON_OFF, 0);
            }
        }
    } else {
        setoutput(OUTPUT_HEATING_ON_OFF, 0);
    }

    sprintf(inputs,
            "Inputs:\n - Water tank temperature below treshold: %f\n - Spot price is very low: %f\n - Predicted PV production for tomorrow: %f\n - Predicted PV production for today: %f\n - Current PV production: %f\n",
            temperatureBelowTreshold,
            spotPriceIsVeryLow,
            predictedPVTommorrow,
            predictedPVToday,
            pwPowerNow);

    // Set text output for debug inputs
    setoutputtext(TEXT_OUTPUT_DEBUG, inputs);
}

// Main loop
while(TRUE) {
    controlHeating();

    sleep(1000);  // Sleep for 1000ms
}
