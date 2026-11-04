/*
Tests for the tank, car, and battery lines of one plan.
*/

import { describe, expect, it } from "vitest";
import { buildEnergyPlan } from "../src/services/energy-plan.js";
import type { SpotPrice } from "../src/services/ote-day-ahead.js";

function prices(intervals: Array<[string, number]>): SpotPrice[] {
  return intervals.map(([periodInterval, eurPerMwh], index) => ({
    date: "2026-10-28",
    periodIndex: index + 1,
    periodInterval,
    eurPerMwh
  }));
}

const night = prices([
  ["01:00-01:15", 200],
  ["01:15-01:30", 10],
  ["01:30-01:45", 10],
  ["01:45-02:00", 10],
  ["02:00-02:15", 10],
  ["02:15-02:30", 10],
  ["02:30-02:45", 10],
  ["02:45-03:00", 200],
  ["14:00-14:15", 1],
  ["14:15-14:30", 1],
  ["14:30-14:45", 1],
  ["14:45-15:00", 1]
]);

describe("energy plan", () => {
  it("heats early, leaves a full car off, and holds a full battery", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 40,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 0, pluggedIn: false, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.tankFrom).toBe("01:15");
    expect(plan.tankTo).toBe("02:45");
    expect(plan.car).toBe("off");
    expect(plan.battery).toBe("hold");
    expect(plan.batterySellFrom).toBe("01:00");
    expect(plan.batterySellTo).toBe("01:15");
    expect(plan.batterySellKw).toBe(8);
    expect(plan.batteryDischargeFrom).toBe("18:00");
    expect(plan.batteryDischargeTo).toBe("06:00");
    expect(plan.batteryDischargeKw).toBeCloseTo(0.7 / 12, 5);
  });

  it("sizes the car at 11 kW, including while the tank is on", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 40,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 11, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.carFrom).toBe("01:15");
    expect(plan.carTo).toBe("02:15");
  });

  it("leaves 1 kW for the house and charges the battery at 2.5 kW when the tank and the car are on", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 40,
      aboveFloorKwh: 0,
      season: "autumn",
      lowCloudPercent: 90,
      car: { missingKwh: 11, pluggedIn: true, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryKw).toBe(2.5);
    expect(plan.batteryFrom).toBe("14:00");
    expect(plan.batteryTo).toBe("15:00");
    expect(plan.batterySellKw).toBe(0);
    expect(plan.batteryDischargeKw).toBe(0);
  });

  it("charges an unplugged car that is at home and still missing energy", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 11, pluggedIn: false, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.carFrom).toBe("01:15");
    expect(plan.carTo).toBe("02:15");
  });

  it("leaves the car off when it is not at home", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 11, pluggedIn: true, atHome: false }
    });
    expect(plan.car).toBe("off");
    expect(plan.carKw).toBe(0);
    expect(plan.carFrom).toBeNull();
  });

  it("lets the car cross midnight when tomorrow's prices are passed", () => {
    const today = prices([
      ["23:00-23:15", 100],
      ["23:15-23:30", 100],
      ["23:30-23:45", 10],
      ["23:45-24:00", 10]
    ]);
    const tomorrow = prices([
      ["00:00-00:15", 10],
      ["00:15-00:30", 10],
      ["00:30-00:45", 90],
      ["00:45-01:00", 90]
    ]);
    const plan = buildEnergyPlan({
      prices: today,
      tomorrowPrices: tomorrow,
      startAt: "23:00",
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 11, pluggedIn: false, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.carFrom).toBe("23:30");
    expect(plan.carTo).toBe("00:30");
  });

  it("keeps the tank on today through 06:00 when tomorrow morning is cheaper", () => {
    const today = prices([
      ["01:15-01:30", 40],
      ["01:30-01:45", 40],
      ["01:45-02:00", 40],
      ["02:00-02:15", 40],
      ["02:15-02:30", 40],
      ["02:30-02:45", 40]
    ]);
    const tomorrow = prices([
      ["00:00-00:15", 1],
      ["00:15-00:30", 1],
      ["00:30-00:45", 1],
      ["00:45-01:00", 1],
      ["01:00-01:15", 1],
      ["01:15-01:30", 1]
    ]);
    const plan = buildEnergyPlan({
      prices: today,
      tomorrowPrices: tomorrow,
      startAt: "23:00",
      bottomTemperatureC: 40,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 0, pluggedIn: false, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.tankFrom).toBe("01:15");
    expect(plan.tankTo).toBe("02:45");
  });

  it("still heats a 45°C tank up to 55°C", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 45,
      aboveFloorKwh: 10,
      season: "summer",
      lowCloudPercent: 0,
      car: { missingKwh: 0, pluggedIn: false, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.tankFrom).toBe("01:15");
    expect(plan.tankTo).toBe("02:15");
  });

  it("leaves the car limited when TeslaMate cannot be read and buys the battery in the daytime", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      season: "autumn",
      lowCloudPercent: 90,
      car: null
    });
    expect(plan.tank).toBe("off");
    expect(plan.car).toBe("limited");
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryFrom).toBe("14:00");
    expect(plan.batteryTo).toBe("14:45");
  });
});
