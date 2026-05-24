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
 * Verifies that the explicit battery discharge-to-grid branch also obeys the
 * user's push-to-grid spot price threshold.
 */
void test_discharge_to_grid_requires_push_price_threshold() {
    char* source = read_file(WATTSONIC_STATE_MANAGER_PATH);
    char* discharge_branch = strstr(source, "sprintf(inverterState, \"Discharging to grid\")");
    assert(discharge_branch != NULL);

    char* branch_start = discharge_branch;
    while (branch_start > source && strncmp(branch_start, "} else if", 9) != 0) branch_start--;

    char* threshold_condition = strstr(branch_start, "currentSpotPrice > spotPriceTreshold");
    assert(threshold_condition != NULL);
    assert(threshold_condition < discharge_branch);

    free(source);
    printf("PASS: discharge to grid requires the push price threshold\n");
}

int main() {
    printf("Running Wattsonic inverter state manager tests...\n");
    test_discharge_to_grid_requires_push_price_threshold();
    printf("All Wattsonic inverter state manager tests passed.\n");
    return 0;
}
