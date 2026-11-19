/*
 Loxone programming block controlling the water tank heating.

 A fresh plan command of 1 heats while the tank is below the threshold.
 A fresh command of 0 stays off. Priority forces heat while the tank is below
 the threshold, in every month.

 The bottom probe sits where cold inlet water arrives. Until a second sensor
 exists, a missing plan does not heat from that reading. The under-40 rule is off.

 Inputs:
 - Input 1: Water tank temperature is below the threshold
 - Inputs 2 to 6: kept so the later inputs stay put. Nothing reads them.
 - Input 7: Enable priority charging
 - Input 8: Bottom tank temperature in C. Shown in the debug text. It does not start the heater. Add it at the end. Do not insert it in front.
 - Plan: fresh is virtual input VI9. Plan: tank is VI10. No wire from the planner.

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
#define INPUT_INVERTER_EXCESS_ENERGY_AVAILABLE 5
#define INPUT_PRIORITY_CHARGING_ENABLED 6
#define INPUT_TANK_TEMPERATURE 7

// Virtual input connection addresses
#define VI_PLAN_FRESH "VI9"
#define VI_PLAN_TANK "VI10"

// Control the heating based on the inputs
void controlHeating() {

    char inputs[1024];
    int temperatureBelowTreshold = getinput(INPUT_WATER_TANK_TEMPERATURE_BELOW_TRESHOLD) == 1;
    int priorityChargingEnabled = getinput(INPUT_PRIORITY_CHARGING_ENABLED) == 1;
    int planFresh = getio(VI_PLAN_FRESH) == 1;
    float planTankCommand = getio(VI_PLAN_TANK);
    float tankTemperature = getinput(INPUT_TANK_TEMPERATURE);
    int heat = 0;

    // Priority and a fresh "on" still follow the threshold slider.
    // Anything else stays off, including a missing plan and a cold bottom reading.
    if (priorityChargingEnabled && temperatureBelowTreshold)
        heat = 1;
    else if (planFresh && planTankCommand >= 1 && temperatureBelowTreshold)
        heat = 1;

    setoutput(OUTPUT_HEATING_ON_OFF, heat);

    sprintf(inputs,
            "Tank below threshold: %d\nTank C: %f\nPlan fresh: %d\nPlan command: %f\nPriority: %d\nHeat: %d",
            temperatureBelowTreshold,
            tankTemperature,
            planFresh,
            planTankCommand,
            priorityChargingEnabled,
            heat);

    // Set text output for debug inputs
    setoutputtext(TEXT_OUTPUT_DEBUG, inputs);
}

// Main loop
while(TRUE) {
    controlHeating();

    sleep(1000);  // Sleep for 1000ms
}
