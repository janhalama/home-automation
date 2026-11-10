/*
The recent night and the matching daylight the reserve reads from the archive.
*/

import { describe, expect, it } from "vitest";
import type { PowerReading } from "../src/services/house-archive.js";
import { houseLoadForPlan } from "../src/services/recent-house-load.js";
import { fortnightNightKwh, seasonalDaylightKwh } from "../src/services/seasonal-profile.js";
import { addDays, sunClocks } from "../src/services/sun-clock.js";

/* A quiet day at a flat house load, or a day with one car-sized import. */
function quietDay(date: string, houseKw: number, car: boolean): PowerReading[] {
  const samples: PowerReading[] = [];
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const hour = Math.floor(minute / 60);
    const clock = `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`;
    const imported = car && (clock === "12:00:00" || clock === "20:00:00") ? 7 : houseKw;
    samples.push({
      at: `${date}T${clock}`,
      pvKw: 0,
      meterKw: -imported,
      batteryKw: 0,
      socPercent: 40
    });
  }
  return samples;
}

/* Daylight hours at the house on that date. */
function daylightHours(date: string): number {
  const sun = sunClocks(date);
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  return (minutes(sun.set) - minutes(sun.rise)) / 60;
}

describe("recent house load", () => {
  it("uses the seasonal daylight and the fortnight night when the archive is thin", () => {
    const load = houseLoadForPlan({
      planDate: "2026-11-08",
      daylightDate: "2026-11-08",
      readDay: () => []
    });
    expect(load.nightKwh).toBe(fortnightNightKwh("2026-11-08"));
    expect(load.daylightKwh).toBe(seasonalDaylightKwh("autumn", true));
  });

  it("reads weekend daylight from earlier Saturdays and Sundays", () => {
    const byDate = new Map<string, PowerReading[]>();
    for (let index = 1; index <= 40; index += 1) {
      const date = addDays("2026-11-08", -index);
      const weekend = new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0;
      byDate.set(date, quietDay(date, weekend ? 1 : 0.2, false));
    }
    const load = houseLoadForPlan({
      planDate: "2026-11-08",
      daylightDate: "2026-11-08",
      readDay: (date) => byDate.get(date) ?? []
    });
    expect(load.daylightKwh).toBeGreaterThan(8);
    expect(load.daylightKwh).toBeLessThan(seasonalDaylightKwh("autumn", true));
    expect(load.nightKwh).toBeLessThan(5);
  });

  it("keeps the house when the car and the tank ran in the same week", () => {
    const byDate = new Map<string, PowerReading[]>();
    const tankOn = (at: string) => at.slice(11, 16) >= "02:00" && at.slice(11, 16) < "04:00";
    for (let index = 1; index <= 7; index += 1) {
      const date = addDays("2026-11-09", -index);
      const samples = quietDay(date, 0.4, false).map((sample) => {
        const clock = sample.at.slice(11, 16);
        if (clock === "20:00")
          return { ...sample, meterKw: -11 };
        if (tankOn(sample.at))
          return { ...sample, meterKw: -(0.4 + 2.5) };
        return sample;
      });
      byDate.set(date, samples);
    }
    const load = houseLoadForPlan({
      planDate: "2026-11-09",
      daylightDate: "2026-11-09",
      readDay: (date) => byDate.get(date) ?? [],
      tankOn,
      carChargeKw: (at) => at.slice(11, 16) === "20:00" ? 11 : 0
    });
    const nightHours = 24 - daylightHours("2026-11-08");
    expect(load.nightKwh).toBeCloseTo(0.4 * nightHours, 0);
    expect(load.nightKwh).toBeLessThan(fortnightNightKwh("2026-11-09"));
    expect(load.daylightKwh).toBeCloseTo(0.4 * daylightHours("2026-11-06"), 0);
  });

  it("keeps a high load that TeslaMate did not record as a charge", () => {
    const date = "2026-11-08";
    const samples = quietDay(date, 0.4, false).map((sample) =>
      sample.at.endsWith("T20:00:00") ? { ...sample, meterKw: -7 } : sample
    );
    const load = houseLoadForPlan({
      planDate: "2026-11-09",
      daylightDate: "2026-11-09",
      readDay: (day) => day === date ? samples : [],
      carChargeKw: () => 0
    });
    expect(load.nightKwh).toBeGreaterThan(0.4 * (24 - daylightHours(date)));
  });

  it("reads workday daylight from the quiet weekdays in the previous fortnight", () => {
    const byDate = new Map<string, PowerReading[]>();
    for (let index = 1; index <= 14; index += 1)
      byDate.set(addDays("2026-11-04", -index), quietDay(addDays("2026-11-04", -index), 0.5, false));
    const load = houseLoadForPlan({
      planDate: "2026-11-04",
      daylightDate: "2026-11-04",
      readDay: (date) => byDate.get(date) ?? []
    });
    const sample = addDays("2026-11-04", -1);
    expect(load.daylightKwh).toBeCloseTo(0.5 * daylightHours(sample), 0);
    expect(load.daylightKwh).toBeLessThan(seasonalDaylightKwh("autumn", false));
  });
});
