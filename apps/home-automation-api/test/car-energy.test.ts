/*
Tests for the kilowatt-hours Obluda still needs to reach its own charge limit.
*/

import { describe, expect, it } from "vitest";
import { carJobFromReading, missingCarKwh } from "../src/services/car-energy.js";

describe("missing car energy", () => {
  it("is zero when the usable charge is already at the limit", () => {
    expect(missingCarKwh(50, 50)).toBe(0);
  });

  it("is the pack share between the usable charge and the limit", () => {
    expect(missingCarKwh(20, 80)).toBe(45);
  });

  it("rejects a percentage outside 0 to 100", () => {
    expect(() => missingCarKwh(101, 80)).toThrow(/percentage/);
  });

  it("keeps at home on the job the plan uses", () => {
    expect(carJobFromReading({
      usablePercent: 20,
      limitPercent: 80,
      pluggedIn: false,
      atHome: true
    })).toEqual({ missingKwh: 45, pluggedIn: false, atHome: true });
    expect(carJobFromReading({
      usablePercent: 80,
      limitPercent: 80,
      pluggedIn: true,
      atHome: false
    })).toEqual({ missingKwh: 0, pluggedIn: true, atHome: false });
  });
});
