/*
Tests for the seasonal overnight energy and the expected PV by morning cloud.
*/

import { describe, expect, it } from "vitest";
import { cloudBand, daylightHouseKwh, expectedPvKwh, fortnightNightKwh, houseGridKwh, nightHouseKwh, overnightKwh, reserveSocPercent, seasonalDaylightKwh, sunlessHouseKwh } from "../src/services/seasonal-profile.js";

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

  it("keeps only the part of a night and a day the expected sun will not cover", () => {
    expect(daylightHouseKwh("autumn")).toBe(8.6);
    expect(nightHouseKwh("autumn")).toBe(6.4);
    expect(sunlessHouseKwh("autumn")).toBe(15);
    expect(reserveSocPercent(6.4, 8.6, null)).toBe(98.9);
    expect(reserveSocPercent(6.4, 8.6, 14.3)).toBe(53.7);
    expect(reserveSocPercent(11.2, 5.7, 1.5)).toBe(100);
    expect(reserveSocPercent(2.8, 12.8, 22.4)).toBe(34.7);
    expect(fortnightNightKwh("2026-11-08")).toBe(13.8);
    expect(seasonalDaylightKwh("autumn", false)).toBe(7.7);
    expect(seasonalDaylightKwh("autumn", true)).toBe(13.3);
  });

  it("splits the morning low-cloud percentage into the three bands", () => {
    expect(cloudBand(0)).toBe("clear");
    expect(cloudBand(19.9)).toBe("clear");
    expect(cloudBand(20)).toBe("mixed");
    expect(cloudBand(69.9)).toBe("mixed");
    expect(cloudBand(70)).toBe("covered");
  });
});
