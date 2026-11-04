/*
The chart timeline stays the whole price day when measurements stop early.
*/

import { describe, expect, it } from "vitest";
import { alignEnergyDay } from "../src/services/energy-series.js";
import type { SpotPrice } from "../src/services/ote-day-ahead.js";

function price(periodInterval: string, eurPerMwh: number): SpotPrice {
  return { date: "2026-11-04", periodIndex: 1, periodInterval, eurPerMwh };
}

describe("energy timeline", () => {
  it("keeps the price quarters after the last measurement so a plan can reach the evening", () => {
    const points = alignEnergyDay({
      date: "2026-11-04",
      prices: [
        price("00:00-00:15", 10),
        price("07:30-07:45", 20),
        price("23:45-24:00", 30)
      ],
      samples: [{
        time: "07:30:00",
        pvKw: 0.4,
        meterKw: -1.2,
        batteryKw: 0,
        socPercent: 40
      }],
      heating: [{
        startedAt: "2026-11-04T07:00:00",
        endedAt: null,
        startTemperatureC: 40,
        endTemperatureC: null
      }]
    });

    expect(points.map((point) => point.time)).toEqual(["00:00:00", "07:30:00", "23:45:00"]);
    expect(points[0]).toMatchObject({ priceEurPerMwh: 10, pvKw: null, heatingOn: false });
    expect(points[1]).toMatchObject({ priceEurPerMwh: 20, pvKw: 0.4, heatingOn: true });
    expect(points[2]).toMatchObject({ priceEurPerMwh: 30, pvKw: null, meterKw: null, heatingOn: null });
  });
});
