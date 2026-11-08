/*
 Loxone programming block controlling the water tank heating.

 A fresh plan command of 1 heats while the tank is below the threshold.
 A fresh command of 0 stays off. Priority forces heat while the tank is below
 the threshold, in every month.

 With no fresh plan the tank heats only below 40°C. May through August also
 require 06:00 to 21:00 and panels producing more than the heater's 2.5 kW.
 September through April may heat that cold tank at any hour. The 65°C slider
 is not that cold line. Price and the forecast are not read.

 Inputs:
 - Input 1: Water tank temperature is below the threshold
 - Inputs 2 to 6: kept so the later inputs stay put. Nothing reads them.
 - Input 7: Enable priority charging
 - Input 8: Aktuální teplota bojleru, in °C. Add it at the end. Do not insert it in front.
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
#define VI_PV_POWER_NOW "AMQ125"
#define VI_PLAN_FRESH "VI9"
#define VI_PLAN_TANK "VI10"

// The heater draws this much. May through August a missing plan heats only while the panels cover it.
#define PV_POWER_THRESHOLD_IN_KW 2.5
#define HARD_LOW_C 40.0

// Control the heating based on the inputs
void controlHeating() {

    char inputs[1024];
    int temperatureBelowTreshold = getinput(INPUT_WATER_TANK_TEMPERATURE_BELOW_TRESHOLD) == 1;
    int priorityChargingEnabled = getinput(INPUT_PRIORITY_CHARGING_ENABLED) == 1;
    int planFresh = getio(VI_PLAN_FRESH) == 1;
    float planTankCommand = getio(VI_PLAN_TANK);
    float pvPowerNow = getio(VI_PV_POWER_NOW);
    int hourNow = gethour(getcurrenttime(), 1);
    int monthNow = getmonth(getcurrenttime(), 1);
    int summer = monthNow >= 5 && monthNow <= 8;
    int day = hourNow >= 6 && hourNow < 21;
    int sunCoversHeater = pvPowerNow > PV_POWER_THRESHOLD_IN_KW;
    float tankTemperature = getinput(INPUT_TANK_TEMPERATURE);
    int tankCold = tankTemperature > 0 && tankTemperature < HARD_LOW_C;
    int heatOffline = tankCold;
    if (summer)
        heatOffline = tankCold && day && sunCoversHeater;

    // A fresh plan owns the heater. Without one, heat only below 40°C.
    // Summer also waits for the day's sun. Priority still follows the 65°C slider.
    if (priorityChargingEnabled && temperatureBelowTreshold)
        setoutput(OUTPUT_HEATING_ON_OFF, 1);
    else if (planFresh && planTankCommand >= 0)
        setoutput(OUTPUT_HEATING_ON_OFF, planTankCommand >= 1 && temperatureBelowTreshold);
    else
        setoutput(OUTPUT_HEATING_ON_OFF, heatOffline);

    sprintf(inputs,
            "Tank below threshold: %d\nTank C: %f\nPV now: %f kW\nHour: %d\nMonth: %d\nSummer day sun: %d\nPlan fresh: %d\nPlan command: %f\nPriority: %d",
            temperatureBelowTreshold,
            tankTemperature,
            pvPowerNow,
            hourNow,
            monthNow,
            summer && day && sunCoversHeater,
            planFresh,
            planTankCommand,
            priorityChargingEnabled);

    // Set text output for debug inputs
    setoutputtext(TEXT_OUTPUT_DEBUG, inputs);
}

// Main loop
while(TRUE) {
    controlHeating();

    sleep(1000);  // Sleep for 1000ms
}
