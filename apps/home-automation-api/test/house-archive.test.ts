/*
Tests for storing OTE prices and heater periods in SQLite.
*/

import { describe, expect, it } from "vitest";
import { heatingTransition, openHouseArchive } from "../src/services/house-archive.js";

describe("house archive", () => {
  it("stores a day of prices and reads them back", () => {
    const archive = openHouseArchive(":memory:");
    archive.saveSpotPrices([
      { date: "2026-10-26", periodIndex: 1, periodInterval: "00:00-00:15", eurPerMwh: 100.27 },
      { date: "2026-10-26", periodIndex: 2, periodInterval: "00:15-00:30", eurPerMwh: 99.89 }
    ]);

    expect(archive.listSpotPrices("2026-10-26")).toEqual([
      { date: "2026-10-26", periodIndex: 1, periodInterval: "00:00-00:15", eurPerMwh: 100.27 },
      { date: "2026-10-26", periodIndex: 2, periodInterval: "00:15-00:30", eurPerMwh: 99.89 }
    ]);
    archive.close();
  });

  it("keeps a heating period after the heater turns off", () => {
    const archive = openHouseArchive(":memory:");
    expect(archive.hasHeatingHistory()).toBe(false);

    archive.applyHeatingSample({ at: "2026-10-26T01:00:00", heatingOn: true, temperatureC: 35 });
    archive.applyHeatingSample({ at: "2026-10-26T01:10:00", heatingOn: true, temperatureC: 40 });
    archive.applyHeatingSample({ at: "2026-10-26T02:00:00", heatingOn: false, temperatureC: 55 });

    expect(archive.listHeatingPeriods("2026-10-26")).toEqual([
      {
        startedAt: "2026-10-26T01:00:00",
        endedAt: "2026-10-26T02:00:00",
        startTemperatureC: 35,
        endTemperatureC: 55
      }
    ]);
    archive.close();
  });

  it("opens a period only on the rising edge", () => {
    const first = heatingTransition(null, {
      at: "2026-10-26T01:00:00",
      heatingOn: true,
      temperatureC: 35
    });
    const held = heatingTransition(first.open, {
      at: "2026-10-26T01:10:00",
      heatingOn: true,
      temperatureC: 40
    });

    expect(held.open?.startedAt).toBe("2026-10-26T01:00:00");
    expect(held.closed).toBeNull();
  });

  it("uses the last sample from before a day that has none", () => {
    const archive = openHouseArchive(":memory:");
    archive.savePowerSample({ at: "2026-10-27T21:00:00", pvKw: 0, meterKw: -0.4, batteryKw: 0.2, socPercent: 40 });
    archive.savePowerSample({ at: "2026-10-27T22:00:00", pvKw: 0, meterKw: -0.3, batteryKw: 0.1, socPercent: 38 });

    expect(archive.latestPowerSampleBefore("2026-10-28")?.socPercent).toBe(38);
    expect(archive.latestPowerSampleBefore("2026-10-27")).toBeNull();
    archive.close();
  });
});
