/*
The next climb of more than 2 Kč/kWh above the cheap stretch still ahead.
*/

import { describe, expect, it } from "vitest";
import { nextPriceRise } from "../src/services/price-rise.js";

describe("next price rise", () => {
  it("starts where the price climbs 2 Kč above the trough ahead", () => {
    const rise = nextPriceRise([
      { periodInterval: "03:00-03:15", eurPerMwh: 185 },
      { periodInterval: "06:15-06:30", eurPerMwh: 230 },
      { periodInterval: "06:30-06:45", eurPerMwh: 276 },
      { periodInterval: "09:00-09:15", eurPerMwh: 375 },
      { periodInterval: "19:30-19:45", eurPerMwh: 243 },
      { periodInterval: "23:45-24:00", eurPerMwh: 145 }
    ]);
    expect(rise).toEqual({ from: "06:30", to: "19:30" });
  });

  it("returns the following rise once the first one has ended", () => {
    const rise = nextPriceRise([
      { periodInterval: "21:00-21:15", eurPerMwh: 160 },
      { periodInterval: "23:45-24:00", eurPerMwh: 145 },
      { periodInterval: "06:30-06:45", eurPerMwh: 280 },
      { periodInterval: "09:00-09:15", eurPerMwh: 360 }
    ]);
    expect(rise).toEqual({ from: "06:30", to: null });
  });

  it("returns null when nothing ahead clears 2 Kč", () => {
    expect(nextPriceRise([
      { periodInterval: "02:00-02:15", eurPerMwh: 100 },
      { periodInterval: "18:00-18:15", eurPerMwh: 170 }
    ])).toBeNull();
  });
});
