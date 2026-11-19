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
    expect(archive.listHeatingTemperatures("2026-10-26")).toEqual([
      { at: "2026-10-26T01:00:00", temperatureC: 35 },
      { at: "2026-10-26T01:10:00", temperatureC: 40 },
      { at: "2026-10-26T02:00:00", temperatureC: 55 }
    ]);
    archive.close();
  });

  it("returns a heater period that is still on during a later day", () => {
    const archive = openHouseArchive(":memory:");
    archive.applyHeatingSample({ at: "2026-10-31T08:00:00", heatingOn: true, temperatureC: 16 });
    archive.applyHeatingSample({ at: "2026-11-03T05:00:00", heatingOn: false, temperatureC: 55 });

    expect(archive.listHeatingPeriods("2026-11-01")).toEqual([]);
    expect(archive.listHeatingPeriodsOverlapping("2026-11-01T00:00:00", "2026-11-02T00:00:00")).toEqual([
      {
        startedAt: "2026-10-31T08:00:00",
        endedAt: "2026-11-03T05:00:00",
        startTemperatureC: 16,
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

  it("stores the issued decision and lists change lines newest first", () => {
    const archive = openHouseArchive(":memory:");
    expect(archive.listDayDecisions("2026-11-19")).toEqual([]);
    expect(archive.listPlanChanges("2026-11-19")).toEqual([]);

    archive.saveDayDecisions("2026-11-19", [
      { kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" },
      { kind: "battery-buy", from: "00:00", to: "02:15", kw: 2.5, mode: "" }
    ]);
    archive.appendPlanChange("2026-11-19", {
      at: "02:16",
      trigger: "Booked charge ended",
      result: "Battery buy 02:30–03:00 at 6 kW.",
      segments: [
        { kind: "battery-buy", from: "00:00", to: "02:15", kw: 2.5, mode: "" },
        { kind: "battery-buy", from: "02:30", to: "03:00", kw: 6, mode: "" }
      ]
    });
    archive.appendPlanChange("2026-11-19", {
      at: "06:00",
      trigger: "The clock",
      result: "Tank 22:00–24:00.",
      segments: [{ kind: "tank", from: "22:00", to: "24:00", kw: 2.5, mode: "" }]
    });

    expect(archive.listDayDecisions("2026-11-19")).toEqual([
      { kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" },
      { kind: "battery-buy", from: "00:00", to: "02:15", kw: 2.5, mode: "" }
    ]);
    expect(archive.listPlanChanges("2026-11-19").map((line) => line.at)).toEqual(["06:00", "02:16"]);
    expect(archive.listPlanChanges("2026-11-19")[0]?.segments).toEqual([
      { kind: "tank", from: "22:00", to: "24:00", kw: 2.5, mode: "" }
    ]);

    archive.saveDayDecisions("2026-11-19", [
      { kind: "car", from: "23:00", to: "24:00", kw: 11, mode: "grid" }
    ]);
    expect(archive.listDayDecisions("2026-11-19")).toEqual([
      { kind: "car", from: "23:00", to: "24:00", kw: 11, mode: "grid" }
    ]);
    archive.close();
  });
});
