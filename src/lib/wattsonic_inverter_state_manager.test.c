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

int main() {
    printf("Running Wattsonic inverter state manager tests...\n");
    test_discharge_to_grid_requires_push_price_threshold();
    test_grid_charge_writes_period_clock_before_power_limit();
    printf("All Wattsonic inverter state manager tests passed.\n");
    return 0;
}
