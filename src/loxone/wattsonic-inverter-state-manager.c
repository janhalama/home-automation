/*
 Loxone programming block for the Wattsonic inverter.

 The plan decides when the battery charges from the grid and when it is sold.
 Plan: fresh is VI9. Plan: battery charge is VI20: 1 charges, -1 sells, 0 does neither.
 Plan: battery kW is VI21. The discharge floor is virtual input VI16.

 Without a fresh plan the inverter stays in general mode. Surplus PV may leave
 to the grid, so a full battery does not curtail the panels. The block does not
 buy from the grid and it does not sell the battery on its own.

 After a grid charge, the end-SOC register stays just under the live SOC for
 20 seconds. Putting the 20% floor back immediately makes the inverter discharge
 what it just bought.

 Inputs:
 - Input 1: Battery SOC

 Disconnect every other wire on this block. Spot price, the forecast, and the
 old charge and discharge thresholds are not read.

 Outputs:
 - Output 1: Inverter working mode
 - Output 2: Battery mode
 - Output 3: Charge & Discharge periods
 - Output 4: Battery Charge By
 - Output 5: Battery Charge & Discharge Power Limit
 - Output 6: Grid Injection Power Limit
 - Output 7: On-grid end SOC protection
 - Output 8: Inverter excess energy available for water heating
 - Output 9: Period 1 start time, register 53012 (hour in the high byte, minute in the low byte)
 - Output 10: Period 1 stop time, register 53013
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
#define BATTERY_POWER_LIMIT_DISCHARGE_MAX 80
// 30% power limit is recommended by the technician
#define BATTERY_POWER_LIMIT_CHARGE_MAX 30
#define BATTERY_POWER_LIMIT_OFF 0
#define GRID_INJECTION_POWER_LIMIT_MAX 80
#define GRID_INJECTION_POWER_LIMIT_OFF 0

// Period 1 clock. 00:00 is 0. 23:59 is 23 * 256 + 59.
// The power limit on 53010 is applied only while this window contains the current minute.
#define PERIOD_START_MIDNIGHT 0
#define PERIOD_STOP_END_OF_DAY 5947
#define CHARGE_RELEASE_SECONDS 20

// Constants for output indexes
#define OUTPUT_MODE 0
#define OUTPUT_BATTERY_MODE 1
#define OUTPUT_PERIOD_ENABLED 2
#define OUTPUT_BATTERY_CHARGE_BY 3
#define OUTPUT_BATTERY_CHARGE_DISCHARGE_LIMIT 4
#define OUTPUT_GRID_INJECTION_LIMIT 5
#define OUTPUT_ONGRID_SOC_PROTECTION 6
#define OUTPUT_INVERTER_EXCESS_ENERGY_AVAILABLE 7
#define OUTPUT_PERIOD_START 8
#define OUTPUT_PERIOD_STOP 9

// Constants for text output indexes
#define TEXT_OUTPUT_MODE 0
#define TEXT_OUTPUT_INVERTER_STATE 1
#define TEXT_OUTPUT_DEBUG_INPUTS 2

// Seconds left holding the end SOC below the battery after a grid charge.
// The inverter keeps charging if this register is put straight back to the 20% floor.
int chargeReleaseSeconds = 0;

// Virtual input connection addresses
#define VI_ONGRID_SOC_PROTECTION_USER_SETTING "VI16"
#define VI_PLAN_FRESH "VI9"
#define VI_PLAN_BATTERY_CHARGE "VI20"
#define VI_PLAN_BATTERY_KW "VI21"

#define INPUT_SOC 0

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

    float soc = getinput(INPUT_SOC);
    float onGridEndSOCProtection = getio(VI_ONGRID_SOC_PROTECTION_USER_SETTING);
    float onGridEndSOCProtectionUserSetting = onGridEndSOCProtection;
    int planFresh = getio(VI_PLAN_FRESH) == 1;
    int planOrdersCharge = planFresh && getio(VI_PLAN_BATTERY_CHARGE) == 1;
    int chargeLimit = BATTERY_POWER_LIMIT_CHARGE_MAX;
    if (planOrdersCharge) {
        chargeLimit = getio(VI_PLAN_BATTERY_KW) * 10;
        if (chargeLimit < 1) chargeLimit = 1;
        if (chargeLimit > BATTERY_POWER_LIMIT_CHARGE_MAX) chargeLimit = BATTERY_POWER_LIMIT_CHARGE_MAX;
    }
    
    float newMode = INVERTER_GENERAL_MODE;
    int batteryMode = BATTERY_NO_MODE;
    int batteryChargeDischargePowerLimit = BATTERY_POWER_LIMIT_OFF;
    int gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_OFF;
    int periodEnabled = 0;
    int periodStart = PERIOD_START_MIDNIGHT;
    int periodStop = PERIOD_START_MIDNIGHT;
    char inverterState[512];
    char inputs[1024];
    int excessEnergyAvailable = 0;

    // Determine the inverter mode and battery operation

    // A fresh plan may buy from the grid or sell the battery. Without one, neither happens.
    if (planOrdersCharge) {
        newMode = INVERTER_ECONOMIC_MODE;
        batteryMode = BATTERY_CHARGE_MODE; // Charge from grid
        batteryChargeDischargePowerLimit = chargeLimit;
        gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_OFF; // Do not inject power to grid
        // 100% blocks the discharge floor for this charge. The 30% period limit is what limits the power.
        onGridEndSOCProtection = 100.0;
        periodEnabled = 1;
        periodStart = PERIOD_START_MIDNIGHT;
        periodStop = PERIOD_STOP_END_OF_DAY;
        chargeReleaseSeconds = CHARGE_RELEASE_SECONDS;
        
        excessEnergyAvailable = 1;
        
        sprintf(inverterState, "Charging from grid");
    } else if (planFresh && getio(VI_PLAN_BATTERY_CHARGE) < 0) {
        newMode = INVERTER_ECONOMIC_MODE;
        batteryMode = BATTERY_DISCHARGE_MODE;
        batteryChargeDischargePowerLimit = BATTERY_POWER_LIMIT_DISCHARGE_MAX;
        gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_MAX;
        onGridEndSOCProtection = onGridEndSOCProtectionUserSetting;
        periodEnabled = 1;
        periodStart = PERIOD_START_MIDNIGHT;
        periodStop = PERIOD_STOP_END_OF_DAY;
        excessEnergyAvailable = 0;
        sprintf(inverterState, "Discharging to grid");
    } else {
        newMode = INVERTER_GENERAL_MODE;
        onGridEndSOCProtection = onGridEndSOCProtectionUserSetting; // Set on-grid end SOC protection to user setting
        
        excessEnergyAvailable = 1;
        gridInjectionPowerLimit = GRID_INJECTION_POWER_LIMIT_MAX;
        sprintf(inverterState, "General mode");
    }

    if (batteryMode == BATTERY_NO_MODE && chargeReleaseSeconds > 0) {
        onGridEndSOCProtection = soc - 1.0;
        if (onGridEndSOCProtection < 10.0) onGridEndSOCProtection = 10.0;
        chargeReleaseSeconds = chargeReleaseSeconds - 1;
    }

    setoutput(OUTPUT_MODE, newMode);
    setoutput(OUTPUT_BATTERY_MODE, batteryMode);
    // Start and stop go out before the power limit. 53010 is ignored while the period clock is empty.
    setoutput(OUTPUT_PERIOD_START, periodStart);
    setoutput(OUTPUT_PERIOD_STOP, periodStop);
    setoutput(OUTPUT_PERIOD_ENABLED, periodEnabled);
    setoutput(OUTPUT_BATTERY_CHARGE_BY, 1); // Battery charges by PV+Grid
    // Register scale is 1000 = 100%. 30% is 300, so the percent stays multiplied by 10.
    setoutput(OUTPUT_BATTERY_CHARGE_DISCHARGE_LIMIT, batteryChargeDischargePowerLimit * 10);
    setoutput(OUTPUT_GRID_INJECTION_LIMIT, gridInjectionPowerLimit * 10);
    setoutput(OUTPUT_ONGRID_SOC_PROTECTION, onGridEndSOCProtection); // Set on-grid end SOC protection
    setoutput(OUTPUT_INVERTER_EXCESS_ENERGY_AVAILABLE, excessEnergyAvailable); // Set excess energy available flag

    // Set text output for inverter mode
    setoutputtext(TEXT_OUTPUT_MODE, mapInverterMode(newMode));

    // Set text output for inverter state
    setoutputtext(TEXT_OUTPUT_INVERTER_STATE, inverterState);

    sprintf(inputs,
            "SOC: %f\nBattery charge/discharge power limit: %d\nGrid injection power limit: %d\nOn-grid end SOC protection: %f\nPlan fresh: %d\nExcess energy available: %d\nPeriod enabled: %d\nPeriod start: %d\nPeriod stop: %d",
            soc,
            batteryChargeDischargePowerLimit,
            gridInjectionPowerLimit,
            onGridEndSOCProtection,
            planFresh,
            excessEnergyAvailable,
            periodEnabled,
            periodStart,
            periodStop);

    // Set text output for debug inputs
    setoutputtext(TEXT_OUTPUT_DEBUG_INPUTS, inputs);
}

// Main loop
while(TRUE) {
    updateInverterState();

    sleep(1000);  // Sleep for 1000ms
}
