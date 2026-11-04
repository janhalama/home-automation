/*
Tests for one day's buy, sell, battery, and morning-export scores.
*/

import { describe, expect, it } from "vitest";
import { scoreDay } from "../src/services/day-score.js";
import type { SpotPrice } from "../src/services/ote-day-ahead.js";
import type { PowerSample } from "../src/services/day-score.js";

const prices: SpotPrice[] = [
  { date: "2026-01-15", periodIndex: 1, periodInterval: "00:00-00:15", eurPerMwh: 10 },
  { date: "2026-01-15", periodIndex: 2, periodInterval: "00:15-00:30", eurPerMwh: 10 },
  { date: "2026-01-15", periodIndex: 25, periodInterval: "06:00-06:15", eurPerMwh: 100 },
  { date: "2026-01-15", periodIndex: 49, periodInterval: "12:00-12:15", eurPerMwh: 100 }
];

function sample(time: string, meterKw: number, batteryKw: number, socPercent: number): PowerSample {
  return { time, meterKw, batteryKw, pvKw: 0, socPercent };
}

describe("scoreDay", () => {
  it("buys in the cheap intervals, sells in the expensive ones, and charges on a covered winter morning", () => {
    const samples = [
      sample("00:00:00", -4, 0, 25),
      sample("00:15:00", -4, 0, 25),
      sample("00:30:00", 0, 0, 19),
      sample("00:45:00", 0, 0, 40),
      sample("06:00:00", 0, -4, 40),
      sample("06:15:00", 0, 0, 40),
      sample("12:00:00", 4, 0, 40),
      sample("12:15:00", 0, 0, 40)
    ];

    const score = scoreDay({
      date: "2026-01-15",
      season: "winter",
      lowCloudPercent: 90,
      prices,
      samples,
      tankPeriods: [
        {
          startedAt: "2026-01-15T00:05:00",
          endedAt: "2026-01-15T00:20:00",
          startTemperatureC: 30,
          endTemperatureC: 45
        }
      ]
    });

    expect(score.boughtCheaply).toBe(true);
    expect(score.importWeightedEurPerMwh).toBe(10);
    expect(score.soldExpensively).toBe(true);
    expect(score.minutesBelowFloor).toBe(15);
    expect(score.lowestSocPercent).toBe(19);
    expect(score.exportWasWise).toBe(true);
    expect(score.tankPeriodsOnCheapHalf).toBe(1);
  });

  it("says tank history has not started when no periods have been stored", () => {
    const score = scoreDay({
      date: "2026-07-15",
      season: "summer",
      lowCloudPercent: 5,
      prices: [
        { date: "2026-07-15", periodIndex: 25, periodInterval: "06:00-06:15", eurPerMwh: 20 },
        { date: "2026-07-15", periodIndex: 26, periodInterval: "06:15-06:30", eurPerMwh: 80 }
      ],
      samples: [
        sample("06:00:00", 0, -4, 50),
        sample("06:15:00", 0, 0, 55)
      ],
      tankPeriods: null
    });

    expect(score.exportWasWise).toBe(false);
    expect(score.tankPeriodsOnCheapHalf).toBeNull();
  });

  it("fails when the day has no prices", () => {
    expect(() =>
      scoreDay({
        date: "2026-01-15",
        season: "winter",
        lowCloudPercent: 90,
        prices: [],
        samples: [sample("00:00:00", 0, 0, 50), sample("00:15:00", 0, 0, 50)],
        tankPeriods: null
      })
    ).toThrow(/price/i);
  });
});
