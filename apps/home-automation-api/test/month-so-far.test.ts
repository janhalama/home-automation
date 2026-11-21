/*
This month's grid purchases and sales, and the sun measured today.
*/

import { describe, expect, it } from "vitest";
import { monthSoFar } from "../src/services/month-so-far.js";

describe("month so far", () => {
  it("adds purchases and sales from the 1st through today and ignores last month", () => {
    const result = monthSoFar({
      today: "2026-11-20",
      readDay: (date) => {
        if (date === "2026-10-31")
          return [
            { at: "2026-10-31T12:00:00", meterKw: -4, pvKw: 9 },
            { at: "2026-10-31T12:15:00", meterKw: 0, pvKw: 0 }
          ];
        if (date === "2026-11-01")
          return [
            { at: "2026-11-01T10:00:00", meterKw: -1, pvKw: 0 },
            { at: "2026-11-01T10:15:00", meterKw: 0, pvKw: 0 }
          ];
        if (date === "2026-11-02")
          return [{ at: "2026-11-02T10:00:00", meterKw: -8, pvKw: 0 }];
        if (date === "2026-11-20")
          return [
            { at: "2026-11-20T12:00:00", meterKw: 2, pvKw: 4 },
            { at: "2026-11-20T12:15:00", meterKw: 0, pvKw: 0 }
          ];
        return [];
      },
      readPrices: (date) => {
        if (date === "2026-11-01")
          return [{ periodInterval: "10:00-10:15", eurPerMwh: 100 }];
        if (date === "2026-11-02")
          return [{ periodInterval: "10:00-10:15", eurPerMwh: 100 }];
        if (date === "2026-11-20")
          return [{ periodInterval: "12:00-12:15", eurPerMwh: 80 }];
        return [];
      },
      czkPerEur: (date) => date === "2026-11-02" ? null : 25
    });

    expect(result.importCzk).toBeCloseTo(0.25 * (100 * 25 / 1000 + 1.5));
    expect(result.exportCzk).toBeCloseTo(0.5 * (80 * 25 / 1000));
    expect(result.productionKwh).toBeCloseTo(1);
  });

  it("leaves the money empty when no day has a rate, and still counts today's sun", () => {
    const result = monthSoFar({
      today: "2026-11-20",
      readDay: (date) => date === "2026-11-20"
        ? [{ at: "2026-11-20T12:00:00", meterKw: -1, pvKw: 4 }]
        : [],
      readPrices: () => [{ periodInterval: "12:00-12:15", eurPerMwh: 100 }],
      czkPerEur: () => null
    });

    expect(result.importCzk).toBeNull();
    expect(result.exportCzk).toBeNull();
    expect(result.productionKwh).toBeCloseTo(1);
  });

  it("leaves every figure empty when nothing was recorded", () => {
    const result = monthSoFar({
      today: "2026-11-20",
      readDay: () => [],
      readPrices: () => [],
      czkPerEur: () => 25
    });

    expect(result.importCzk).toBeNull();
    expect(result.exportCzk).toBeNull();
    expect(result.productionKwh).toBeNull();
  });
});
