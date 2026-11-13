/*
The last 30 days of grid money, each day at that day's euro rate.
*/

import { describe, expect, it } from "vitest";
import { balanceHistory } from "../src/services/balance-history.js";

describe("balance history", () => {
  it("prices the measured day and leaves days without readings empty", () => {
    const days = balanceHistory({
      endDate: "2026-11-12",
      readDay: (date) => date === "2026-11-12"
        ? [
            { at: "2026-11-12T01:00:00", meterKw: -1 },
            { at: "2026-11-12T01:15:00", meterKw: 2 },
            { at: "2026-11-12T01:30:00", meterKw: 0 }
          ]
        : [],
      readPrices: (date) => date === "2026-11-12"
        ? [
            { periodInterval: "01:00-01:15", eurPerMwh: 200 },
            { periodInterval: "01:15-01:30", eurPerMwh: 400 }
          ]
        : [],
      czkPerEur: (date) => date === "2026-11-12" ? 24.385 : 24
    });

    expect(days).toHaveLength(30);
    expect(days[0]?.date).toBe("2026-10-14");
    const today = days.at(-1);
    expect(today?.date).toBe("2026-11-12");
    expect(today?.czkPerEur).toBe(24.385);
    expect(today?.importCzk).toBeCloseTo(0.25 * (200 * 24.385 / 1000 + 1.5));
    expect(today?.houseCzk).toBeCloseTo(today?.importCzk ?? 0);
    expect(today?.batteryCzk).toBe(0);
    expect(today?.carCzk).toBe(0);
    expect(today?.tankCzk).toBe(0);
    expect(today?.exportCzk).toBeCloseTo(0.5 * (400 * 24.385 / 1000));
    expect(today?.balanceCzk).toBeCloseTo((today?.exportCzk ?? 0) - (today?.importCzk ?? 0));
    expect(days[0]?.importCzk).toBeNull();
    expect(days[0]?.exportCzk).toBeNull();
    expect(days[0]?.balanceCzk).toBeNull();
  });
});
