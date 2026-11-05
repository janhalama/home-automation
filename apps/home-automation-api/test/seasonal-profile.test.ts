/*
Tests for the seasonal overnight energy and the expected PV by morning cloud.
*/

import { describe, expect, it } from "vitest";
import { cloudBand, expectedPvKwh, houseGridKwh, overnightKwh } from "../src/services/seasonal-profile.js";

describe("seasonal profile", () => {
  it("returns the reduced medians", () => {
    expect(overnightKwh("winter")).toBe(7.3);
    expect(overnightKwh("summer")).toBe(0.7);
    expect(expectedPvKwh("winter", "covered")).toBe(1.5);
    expect(expectedPvKwh("summer", "clear")).toBe(38.3);
  });

  it("buys the shortfall to morning and a further buy when tomorrow cannot refill the night", () => {
    expect(houseGridKwh("winter", "covered", 2)).toBeCloseTo((7.3 - 2) + (7.3 - 1.5));
    expect(houseGridKwh("winter", "clear", 2)).toBeCloseTo(7.3 - 2);
    expect(houseGridKwh("summer", "covered", 2)).toBe(0);
    expect(houseGridKwh("winter", "clear", -1)).toBeCloseTo(7.3);
  });

  it("splits the morning low-cloud percentage into the three bands", () => {
    expect(cloudBand(0)).toBe("clear");
    expect(cloudBand(19.9)).toBe("clear");
    expect(cloudBand(20)).toBe("mixed");
    expect(cloudBand(69.9)).toBe("mixed");
    expect(cloudBand(70)).toBe("covered");
  });
});
