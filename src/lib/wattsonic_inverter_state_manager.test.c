#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Reads a source file so state-manager behavior can be regression-tested without
 * compiling the Loxone-only runtime functions.
 */
char* read_file(const char* filename) {
    FILE* file = fopen(filename, "rb");
    assert(file != NULL);

    fseek(file, 0, SEEK_END);
    long file_size = ftell(file);
    fseek(file, 0, SEEK_SET);

    char* buffer = (char*)malloc(file_size + 1);
    assert(buffer != NULL);

    size_t read_size = fread(buffer, 1, file_size, file);
    buffer[read_size] = '\0';

    fclose(file);
    return buffer;
}

/*
 * Verifies that selling the battery happens only when the plan asks for it.
 */
void test_discharge_to_grid_requires_push_price_threshold() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* discharge_branch = strstr(source, "sprintf(inverterState, \"Discharging to grid\")");
    assert(discharge_branch != NULL);

    char* branch_start = discharge_branch;
    while (branch_start > source && strncmp(branch_start, "} else if", 9) != 0) branch_start--;

    char* plan_condition = strstr(branch_start, "getio(VI_PLAN_BATTERY_CHARGE) < 0");
    assert(plan_condition != NULL);
    assert(plan_condition < discharge_branch);
    assert(strstr(branch_start, "currentSpotPrice > spotPriceTreshold") == NULL
        || strstr(branch_start, "currentSpotPrice > spotPriceTreshold") > discharge_branch);

    free(source);
    printf("PASS: discharge to grid follows the plan\n");
}

/*
 * Verifies that a grid-charge command arms the period clock before the power limit.
 * Register 53010 is applied only while 53012 and 53013 describe a window.
 */
void test_grid_charge_writes_period_clock_before_power_limit() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* charge_branch = strstr(source, "sprintf(inverterState, \"Charging from grid\")");
    assert(charge_branch != NULL);

    char* branch_start = charge_branch;
    while (branch_start > source && strncmp(branch_start, "if (currentSpotPrice", 20) != 0) branch_start--;

    char* period_stop = strstr(branch_start, "periodStop = PERIOD_STOP_END_OF_DAY");
    assert(period_stop != NULL);
    assert(period_stop < charge_branch);

    char* end_soc = strstr(branch_start, "onGridEndSOCProtection = 100.0");
    assert(end_soc != NULL);
    assert(end_soc < charge_branch);

    char* period_start_write = strstr(source, "setoutput(OUTPUT_PERIOD_START, periodStart)");
    char* power_limit_write = strstr(source, "setoutput(OUTPUT_BATTERY_CHARGE_DISCHARGE_LIMIT,");
    assert(period_start_write != NULL);
    assert(power_limit_write != NULL);
    assert(period_start_write < power_limit_write);

    free(source);
    printf("PASS: grid charge writes the period clock before the power limit\n");
}

/*
 * Verifies that a grid charge uses EMS battery control and a negative kilowatt setpoint.
 * Register 50000 must be 771. Register 50207 is signed, and scale 100, so 6 kW is -600.
 * The setpoint is published before the mode so the first moment of mode 771 is not full power.
 */
void test_grid_charge_commands_kilowatts() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* charge_branch = strstr(source, "sprintf(inverterState, \"Charging from grid\")");
    assert(charge_branch != NULL);

    char* branch_start = charge_branch;
    while (branch_start > source && strncmp(branch_start, "if (planOrdersCharge)", 21) != 0) branch_start--;

    char* ems_mode = strstr(branch_start, "newMode = INVERTER_EMS_BATTERY_MODE");
    assert(ems_mode != NULL);
    assert(ems_mode < charge_branch);
    assert(strstr(source, "#define INVERTER_EMS_BATTERY_MODE 771") != NULL);

    char* setpoint = strstr(branch_start, "batteryPowerSetpoint = -(int)(chargeKw * BATTERY_SETPOINT_SCALE)");
    assert(setpoint != NULL);
    assert(setpoint < charge_branch);
    assert(strstr(source, "#define BATTERY_CHARGE_MAX_KW 6.0") != NULL);

    char* setpoint_write = strstr(source, "setoutput(OUTPUT_BATTERY_POWER_SETPOINT, batteryPowerSetpoint)");
    char* mode_write = strstr(source, "setoutput(OUTPUT_MODE, newMode)");
    assert(setpoint_write != NULL);
    assert(mode_write != NULL);
    assert(setpoint_write < mode_write);

    free(source);
    printf("PASS: grid charge commands kilowatts\n");
}

/*
 * Verifies that a sale uses economic mode and keeps the end-SOC floor under the battery.
 * Mode 771 is the charge path. A floor above the live SOC makes economic mode charge.
 */
void test_sale_discharges_above_the_reserve() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* discharge_branch = strstr(source, "sprintf(inverterState, \"Discharging to grid\")");
    assert(discharge_branch != NULL);

    char* branch_start = discharge_branch;
    while (branch_start > source && strncmp(branch_start, "} else if", 9) != 0) branch_start--;

    char* above_reserve = strstr(branch_start, "soc > reserveSoc");
    assert(above_reserve != NULL);
    assert(above_reserve < discharge_branch);

    char* economic_mode = strstr(branch_start, "newMode = INVERTER_ECONOMIC_MODE");
    assert(economic_mode != NULL);
    assert(economic_mode < discharge_branch);
    assert(strstr(branch_start, "newMode = INVERTER_EMS_BATTERY_MODE") == NULL);

    char* setpoint = strstr(branch_start, "batteryPowerSetpoint = 0");
    assert(setpoint != NULL);
    assert(setpoint < discharge_branch);

    char* floor = strstr(branch_start, "onGridEndSOCProtection = reserveSoc");
    assert(floor != NULL);
    assert(floor < discharge_branch);

    free(source);
    printf("PASS: a sale discharges above the reserve\n");
}

/*
 * Verifies that a planned car or tank load holds the battery instead of emptying it.
 */
void test_car_or_tank_holds_the_battery() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* hold = strstr(source, "sprintf(inverterState, \"Holding the battery\")");
    assert(hold != NULL);
    assert(strstr(source, "planCarCommand >= 1") != NULL);
    assert(strstr(source, "getio(VI_PLAN_TANK) >= 1") != NULL);
    assert(strstr(source, "onGridEndSOCProtection = batteryHoldSoc") != NULL);
    assert(strstr(source, "onGridEndSOCProtection = batteryHoldSoc") < hold);
    free(source);
    printf("PASS: car or tank load holds the battery\n");
}

/*
 * Verifies that the car may spend the stored half above 50%, and a sale stops there too.
 */
void test_upper_half_goes_to_the_car_or_the_sale() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* car = strstr(source, "sprintf(inverterState, \"Car takes the upper half\")");
    assert(car != NULL);
    assert(strstr(source, "planCarCommand >= 3") != NULL);
    assert(strstr(source, "soc > reserveSoc") != NULL);
    assert(strstr(source, "onGridEndSOCProtection = reserveSoc") != NULL);
    assert(strstr(source, "VI_PLAN_RESERVE_SOC") != NULL);
    assert(strstr(source, "onGridEndSOCProtection = reserveSoc") < car);
    assert(strstr(source, "sprintf(inverterState, \"House uses the battery\")") != NULL);
    assert(strstr(source, "onGridEndSOCProtection = onGridEndSOCProtectionUserSetting") != NULL);
    free(source);
    printf("PASS: the upper half goes to the car or the sale\n");
}

int main() {
    printf("Running Wattsonic inverter state manager tests...\n");
    test_discharge_to_grid_requires_push_price_threshold();
    test_grid_charge_writes_period_clock_before_power_limit();
    test_grid_charge_commands_kilowatts();
    test_sale_discharges_above_the_reserve();
    test_car_or_tank_holds_the_battery();
    test_upper_half_goes_to_the_car_or_the_sale();
    printf("All Wattsonic inverter state manager tests passed.\n");
    return 0;
}
