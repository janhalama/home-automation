/*
Tests for the tank, car, and battery lines of one plan.
*/

import { describe, expect, it } from "vitest";
import { buildEnergyPlan as planWithLoad, formatEnergyPlan } from "../src/services/energy-plan.js";
import type { SpotPrice } from "../src/services/ote-day-ahead.js";
import { daylightHouseKwh, nightHouseKwh } from "../src/services/seasonal-profile.js";
import { sunClocks } from "../src/services/sun-clock.js";

/* Hours of dark and of daylight at the house. */
function sunHours(date: string): { night: number; daylight: number } {
  const sun = sunClocks(date);
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const daylight = (minutes(sun.set) - minutes(sun.rise)) / 60;
  return { night: 24 - daylight, daylight };
}

type PlanInput = Parameters<typeof planWithLoad>[0];

/* Existing cases keep the seasonal night and daylight so the reserve stays where it was. */
function buildEnergyPlan(input: Omit<PlanInput, "date" | "nightHouseKwh" | "daylightHouseKwh"> & Partial<Pick<PlanInput, "date" | "nightHouseKwh" | "daylightHouseKwh">>) {
  return planWithLoad({
    date: "2026-07-30",
    nightHouseKwh: nightHouseKwh(input.season),
    daylightHouseKwh: daylightHouseKwh(input.season),
    ...input
  });
}

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

  it("charges the battery at 6 kW when the car and the tank run at another hour", () => {
    const plan = buildEnergyPlan({
      prices: night,
      date: "2026-07-30",
      nightHouseKwh: 4 * sunHours("2026-07-30").night,
      daylightHouseKwh: 0,
      bottomTemperatureC: 40,
      aboveFloorKwh: 0,
      season: "autumn",
      lowCloudPercent: 90,
      car: { missingKwh: 11, pluggedIn: true, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryKw).toBe(6);
    expect(plan.batteryFrom).toBe("14:00");
    expect(plan.batteryTo).toBe("14:30");
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

  it("moves the tank to the next morning when today's window has passed", () => {
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
    expect(plan.tankFrom).toBe("00:00");
    expect(plan.tankTo).toBe("01:30");
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

  it("gives the car the upper half of the house battery and does not sell that energy", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["14:00-14:15", 100],
        ["18:00-18:15", 140]
      ]),
      bottomTemperatureC: 55,
      aboveFloorKwh: 15,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 14,
      car: { missingKwh: 2.25, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("battery");
    expect(plan.carKw).toBe(6);
    expect(plan.carFrom).toBeNull();
    expect(plan.batterySellKw).toBe(0);
    expect(formatEnergyPlan(plan)).toContain("car=battery\n");
  });

  it("sells the battery and buys the car when the peak is still ahead and the gap clears 3 Kč/kWh", () => {
    const plan = buildEnergyPlan({
      prices: night,
      startAt: "00:30",
      bottomTemperatureC: 55,
      aboveFloorKwh: 15,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      car: { missingKwh: 5, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.carFrom).toBe("01:15");
    expect(plan.carTo).toBe("01:45");
    expect(plan.batterySellFrom).toBe("01:00");
    expect(plan.batterySellTo).toBe("01:15");
    expect(plan.batterySellKw).toBe(8);
  });

  it("buys only the room the remaining sun will not fill", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["02:00-02:15", 100],
        ["14:00-14:15", 100],
        ["14:15-14:30", 100],
        ["14:30-14:45", 100],
        ["14:45-15:00", 100],
        ["18:00-18:15", 220]
      ]),
      bottomTemperatureC: 55,
      aboveFloorKwh: 11.4,
      socPercent: 80,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 1,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryKw).toBe(6);
    expect(plan.batteryFrom).toBe("14:00");
    expect(plan.batteryTo).toBe("14:30");
  });

  it("skips the grid charge when the remaining sun fills the battery", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 20,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 19,
      car: { missingKwh: 0, pluggedIn: false, atHome: true }
    });
    expect(plan.battery).toBe("hold");
    expect(plan.batteryKw).toBe(0);
  });

  it("does not start the car on the expensive hour after the cheap hour has passed", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["03:30-03:45", 100],
        ["18:00-18:15", 220]
      ]),
      startAt: "18:16",
      bottomTemperatureC: 55,
      aboveFloorKwh: 12,
      socPercent: 85,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 15,
      car: { missingKwh: 5, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("surplus");
    expect(plan.carKw).toBe(0);
    expect(plan.carFrom).toBeNull();
    expect(plan.reserveSoc).toBe(53.7);
    expect(plan.battery).toBe("hold");
  });

  it("buys the car in a later cheap hour instead of starting it during the peak", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["17:00-17:15", 640],
        ["17:15-17:30", 640],
        ["23:30-23:45", 220],
        ["23:45-24:00", 220]
      ]),
      startAt: "17:20",
      bottomTemperatureC: 55,
      aboveFloorKwh: 12,
      socPercent: 80,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      car: { missingKwh: 5, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.carFrom).toBe("23:30");
    expect(plan.carTo).toBe("24:00");
  });

  it("keeps the morning tank window while the clock is still inside it", () => {
    const quarters: Array<[string, number]> = [];
    for (let index = 0; index < 12; index += 1) {
      const start = 60 + index * 15;
      const clock = (minute: number) =>
        `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      quarters.push([`${clock(start)}-${clock(start + 15)}`, 10]);
    }
    quarters.push(["18:00-18:15", 400]);
    const plan = buildEnergyPlan({
      prices: prices(quarters),
      startAt: "02:30",
      bottomTemperatureC: 40,
      openingTemperatureC: 23,
      aboveFloorKwh: 10,
      season: "autumn",
      lowCloudPercent: 90,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.tankFrom).toBe("01:00");
    expect(plan.tankTo).toBe("04:00");
  });

  it("books the next morning once today's tank window has passed and the tank is cold", () => {
    const tomorrow: Array<[string, number]> = [];
    for (let index = 0; index < 16; index += 1) {
      const start = index * 15;
      const clock = (minute: number) =>
        `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      tomorrow.push([`${clock(start)}-${clock(start + 15)}`, 10]);
    }
    const plan = buildEnergyPlan({
      prices: prices([
        ["01:00-01:15", 10],
        ["18:00-18:15", 400]
      ]),
      tomorrowPrices: prices(tomorrow),
      startAt: "18:30",
      bottomTemperatureC: 16,
      openingTemperatureC: 23,
      aboveFloorKwh: 10,
      season: "autumn",
      lowCloudPercent: 90,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.tank).toBe("on");
    expect(plan.tankFrom).toBe("00:00");
    expect(plan.tankTo).toBe("03:45");
  });

  it("sells the peak once the planned charge covers the reserve and the peak", () => {
    const clock = (minute: number) =>
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const cheap = Array.from({ length: 20 }, (_, index) => {
      const start = 2 * 60 + index * 15;
      return [`${clock(start)}-${clock(start + 15)}`, 10] as [string, number];
    });
    const plan = buildEnergyPlan({
      prices: prices([
        ...cheap,
        ["16:00-16:15", 640],
        ["16:15-16:30", 630]
      ]),
      date: "2026-11-10",
      bottomTemperatureC: 55,
      aboveFloorKwh: 1,
      socPercent: 25,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      nightHouseKwh: 2,
      daylightHouseKwh: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryTo !== null && plan.batteryTo <= "16:00").toBe(true);
    expect(plan.batterySellFrom).toBe("16:00");
    expect(plan.batterySellKw).toBe(8);
    expect(plan.reserveSoc).toBeGreaterThan(25);
  });

  it("keeps the night reserve when the cheap hours run long", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["16:00-16:15", 640],
        ["16:15-16:30", 620],
        ["22:00-22:15", 230],
        ["22:15-22:30", 230],
        ["22:30-22:45", 240],
        ["22:45-23:00", 230]
      ]),
      startAt: "12:00",
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 1,
      nightHouseKwh: 12,
      daylightHouseKwh: 6,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.reserveSoc).toBe(100);
    expect(plan.batteryHoldFrom).toBeNull();
    expect(plan.batteryHoldTo).toBeNull();
    expect(formatEnergyPlan(plan)).toContain("batteryHold=0\n");
  });

  it("keeps the battery when the day's prices stay within 3 Kč/kWh", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["12:00-12:15", 200],
        ["16:00-16:15", 230],
        ["20:00-20:15", 200]
      ]),
      bottomTemperatureC: 55,
      aboveFloorKwh: 15,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.batterySellKw).toBe(0);
    expect(plan.batterySellFrom).toBeNull();
  });

  it("sells once the peak is 3 Kč/kWh above the cheapest hour", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["02:00-02:15", 100],
        ["16:00-16:15", 220],
        ["16:15-16:30", 100]
      ]),
      bottomTemperatureC: 55,
      aboveFloorKwh: 15,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.batterySellFrom).toBe("16:00");
    expect(plan.batterySellTo).toBe("16:15");
    expect(plan.batterySellKw).toBe(8);
  });

  it("sells only the energy above the reserve, not the whole expensive band", () => {
    const clock = (minutes: number) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const band = Array.from({ length: 16 }, (_, index) => {
      const start = 16 * 60 + index * 15;
      const price = start === 18 * 60 ? 310 : 300;
      return [`${clock(start)}-${clock(start + 15)}`, price] as [string, number];
    });
    const plan = buildEnergyPlan({
      prices: prices([["02:00-02:15", 40], ...band]),
      date: "2026-11-13",
      nightHouseKwh: 0,
      daylightHouseKwh: 0,
      bottomTemperatureC: 55,
      aboveFloorKwh: 15.2,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 20,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.batterySellKw).toBe(8);
    expect(plan.batterySellFrom).toBe("17:00");
    expect(plan.batterySellTo).toBe("19:00");
  });

  it("sells the upper half when the car does not need it", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 15,
      socPercent: 100,
      season: "autumn",
      lowCloudPercent: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("off");
    expect(plan.batterySellFrom).toBe("01:00");
    expect(plan.batterySellKw).toBe(8);
  });

  it("keeps the house reserve when the battery is at or below the sunless-day line", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 5,
      socPercent: 35,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 1,
      car: { missingKwh: 11, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.batterySellKw).toBe(0);
  });

  it("lets the car take sun when the day still covers the house and the missing energy", () => {
    const plan = buildEnergyPlan({
      prices: night,
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 14,
      car: { missingKwh: 2.25, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("surplus");
    expect(plan.carKw).toBe(0);
    expect(plan.carFrom).toBeNull();
    expect(plan.carTo).toBeNull();
    expect(formatEnergyPlan(plan)).toContain("car=surplus\n");
  });

  it("buys the car from a later cheap hour when the sun is short", () => {
    const plan = buildEnergyPlan({
      prices: night,
      startAt: "08:00",
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 1,
      car: { missingKwh: 11, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carKw).toBe(11);
    expect(plan.carFrom).toBe("14:00");
    expect(plan.carTo).toBe("15:00");
  });

  it("does not buy tonight when tomorrow's sun fills the battery", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["15:45-16:00", 400],
        ["22:30-22:45", 250],
        ["22:45-23:00", 250],
        ["23:00-23:15", 250],
        ["23:15-23:30", 250],
        ["23:30-23:45", 250],
        ["23:45-24:00", 250]
      ]),
      tomorrowPrices: prices([
        ["02:45-03:00", 80],
        ["03:00-03:15", 80],
        ["03:15-03:30", 80],
        ["03:30-03:45", 80]
      ]),
      startAt: "19:20",
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      socPercent: 75,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 0,
      tomorrowPvKwh: 21,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("hold");
    expect(plan.batteryFrom).toBeNull();
    expect(plan.batteryKw).toBe(0);
  });

  it("buys a remaining gap at tomorrow's cheaper hour instead of tonight", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["16:00-16:15", 400],
        ["22:00-22:15", 250],
        ["22:15-22:30", 250],
        ["22:30-22:45", 250],
        ["22:45-23:00", 250],
        ["23:00-23:15", 250],
        ["23:15-23:30", 250],
        ["23:30-23:45", 250],
        ["23:45-24:00", 250]
      ]),
      tomorrowPrices: prices([
        ["02:00-02:15", 90],
        ["02:15-02:30", 90],
        ["02:30-02:45", 90],
        ["02:45-03:00", 90],
        ["03:00-03:15", 90],
        ["03:15-03:30", 90]
      ]),
      startAt: "19:00",
      bottomTemperatureC: 55,
      aboveFloorKwh: 10,
      socPercent: 80,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      tomorrowPvKwh: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryFrom).toBe("02:00");
    expect(plan.batteryTo).toBe("02:45");
  });

  it("leaves the car limited when TeslaMate cannot be read and buys the battery in the daytime", () => {
    const plan = buildEnergyPlan({
      prices: night,
      date: "2026-07-30",
      nightHouseKwh: 4 * sunHours("2026-07-30").night,
      daylightHouseKwh: 0,
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
    expect(plan.batteryTo).toBe("14:30");
  });

  it("buys the house shortfall when the gap is above 2 Kč/kWh and the battery does not hold it", () => {
    const date = "2026-11-08";
    const plan = buildEnergyPlan({
      prices: prices([
        ["02:00-02:15", 10],
        ["18:00-18:15", 110]
      ]),
      date,
      nightHouseKwh: sunHours(date).night,
      daylightHouseKwh: 0,
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 20,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryFrom).toBe("02:00");
    expect(plan.batteryTo).toBe("02:15");
  });

  it("does not buy for the house when the gap is 2 Kč/kWh or less", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["02:00-02:15", 10],
        ["18:00-18:15", 90]
      ]),
      date: "2026-11-08",
      nightHouseKwh: 20,
      daylightHouseKwh: 10,
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 20,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("hold");
  });

  it("does not buy when the battery already holds the expensive hours", () => {
    const plan = buildEnergyPlan({
      prices: night,
      date: "2026-07-30",
      nightHouseKwh: 4 * sunHours("2026-07-30").night,
      daylightHouseKwh: 0,
      bottomTemperatureC: 55,
      aboveFloorKwh: 5,
      socPercent: 50,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 20,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("hold");
  });

  it("buys the larger of the house shortfall and the room the sun will not fill", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["12:00-12:15", 200],
        ["14:00-14:15", 10],
        ["14:15-14:30", 10],
        ["14:30-14:45", 10],
        ["14:45-15:00", 10]
      ]),
      date: "2026-07-30",
      nightHouseKwh: 0,
      daylightHouseKwh: 10 * sunHours("2026-07-30").daylight,
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 89,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 1,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryFrom).toBe("14:00");
    expect(plan.batteryTo).toBe("14:30");
  });

  it("charges before the peak at full power when the sale pays and the sun will not fill the pack", () => {
    const cheap = Array.from({ length: 14 }, (_, index) => {
      const start = 4 * 60 + index * 15;
      const end = start + 15;
      const clock = (minutes: number) =>
        `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      return [`${clock(start)}-${clock(end)}`, 180] as [string, number];
    });
    const plan = buildEnergyPlan({
      prices: prices([...cheap, ["17:15-17:30", 500]]),
      date: "2026-11-11",
      nightHouseKwh: 12,
      daylightHouseKwh: 0,
      bottomTemperatureC: 55,
      aboveFloorKwh: 5,
      socPercent: 48,
      season: "autumn",
      lowCloudPercent: 90,
      pvRemainingKwh: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryKw).toBe(6);
    expect(plan.batteryFrom).toBe("04:00");
    expect(plan.batteryTo).toBe("05:45");
    expect(plan.batterySellFrom).toBe("17:15");
    expect(plan.batterySellKw).toBe(8);
  });

  it("keeps the sale and skips the grid buy when the sun fills the pack before the peak", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["05:45-06:00", 180],
        ["17:15-17:30", 500]
      ]),
      date: "2026-11-11",
      nightHouseKwh: 12,
      daylightHouseKwh: 0,
      bottomTemperatureC: 55,
      aboveFloorKwh: 5,
      socPercent: 48,
      season: "autumn",
      lowCloudPercent: 0,
      pvRemainingKwh: 30,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("hold");
    expect(plan.batterySellFrom).toBe("17:15");
    expect(plan.batterySellKw).toBe(8);
  });

  it("buys before Thursday's rise and leaves the cheap evening for the next one", () => {
    const clock = (total: number) =>
      `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    const span = (from: string, to: string, eur: number) => {
      const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
      const rows: Array<[string, number]> = [];
      for (let start = minutes(from); start < minutes(to); start += 15)
        rows.push([`${clock(start)}-${clock(start + 15)}`, eur]);
      return rows;
    };
    const plan = buildEnergyPlan({
      prices: prices([
        ...span("00:15", "03:00", 190),
        ["03:00-03:15", 160],
        ...span("03:15", "06:15", 190),
        ["06:15-06:30", 200],
        ["06:30-06:45", 280],
        ["09:00-09:15", 375],
        ["12:00-12:15", 340],
        ["19:00-19:15", 300],
        ["19:30-19:45", 220],
        ["23:45-24:00", 30]
      ]),
      date: "2026-11-12",
      startAt: "00:15",
      nightHouseKwh: 8,
      daylightHouseKwh: 8,
      bottomTemperatureC: 55,
      aboveFloorKwh: 14.82,
      socPercent: 98,
      season: "autumn",
      lowCloudPercent: 100,
      pvRemainingKwh: 0,
      tomorrowPvKwh: 4.6,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    expect(plan.batteryFrom! >= "00:15" && plan.batteryFrom! <= "03:00").toBe(true);
    expect(plan.batteryTo! > "03:00" && plan.batteryTo! <= "06:30").toBe(true);
  });

  it("buys Thursday evening before Friday morning's rise", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["09:00-09:15", 375],
        ...Array.from({ length: 8 }, (_, index) => {
          const start = 22 * 60 + index * 15;
          const clock = (minutes: number) =>
            `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
          return [`${clock(start)}-${clock(start + 15)}`, index === 7 ? 160 : 180] as [string, number];
        })
      ]),
      tomorrowPrices: prices([
        ...Array.from({ length: 18 }, (_, index) => {
          const start = index * 15;
          const clock = (minutes: number) =>
            `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
          return [`${clock(start)}-${clock(start + 15)}`, start >= 4 * 60 + 30 ? 300 : 190] as [string, number];
        }),
        ["09:00-09:15", 370]
      ]),
      date: "2026-11-12",
      startAt: "20:00",
      nightHouseKwh: 8,
      daylightHouseKwh: 8,
      bottomTemperatureC: 55,
      aboveFloorKwh: 1.9,
      socPercent: 30,
      season: "autumn",
      lowCloudPercent: 100,
      pvRemainingKwh: 0,
      tomorrowPvKwh: 4.6,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("grid-charge");
    const from = plan.batteryFrom ?? "";
    const to = plan.batteryTo ?? "";
    const sameDay = to > from;
    expect(sameDay ? from >= "20:00" : to <= "04:30").toBe(true);
    expect(to === "24:00" || to <= "04:30").toBe(true);
  });

  it("holds while the rise is underway and no later rise is in view", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["06:30-06:45", 280],
        ["09:00-09:15", 375],
        ["10:00-10:15", 400],
        ["19:30-19:45", 220],
        ["23:45-24:00", 145]
      ]),
      date: "2026-11-12",
      startAt: "10:00",
      nightHouseKwh: 8,
      daylightHouseKwh: 8,
      bottomTemperatureC: 55,
      aboveFloorKwh: 14.82,
      socPercent: 98,
      season: "autumn",
      lowCloudPercent: 100,
      pvRemainingKwh: 0,
      car: { missingKwh: 0, pluggedIn: true, atHome: true }
    });
    expect(plan.battery).toBe("hold");
    expect(plan.batteryFrom).toBeNull();
  });

  it("stops the morning car charge at 35% when the evening is cheaper", () => {
    const clock = (total: number) =>
      `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    const span = (from: number, to: number, eur: number) => {
      const rows: Array<[string, number]> = [];
      for (let start = from; start < to; start += 15)
        rows.push([`${clock(start)}-${clock(start + 15)}`, eur]);
      return rows;
    };
    const plan = buildEnergyPlan({
      prices: prices([...span(0, 6 * 60, 200), ...span(21 * 60, 24 * 60, 40)]),
      startAt: "00:15",
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 30,
      season: "autumn",
      lowCloudPercent: 100,
      pvRemainingKwh: 0,
      car: { missingKwh: 22.5, usablePercent: 20, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carFrom).toBe("00:15");
    expect(plan.carTo).toBe("01:30");
  });

  it("fills the car to its limit before 06:00 when that morning is the cheapest", () => {
    const clock = (total: number) =>
      `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    const span = (from: number, to: number, eur: number) => {
      const rows: Array<[string, number]> = [];
      for (let start = from; start < to; start += 15)
        rows.push([`${clock(start)}-${clock(start + 15)}`, eur]);
      return rows;
    };
    const plan = buildEnergyPlan({
      prices: prices([...span(0, 6 * 60, 40), ...span(21 * 60, 24 * 60, 200)]),
      startAt: "00:15",
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 30,
      season: "autumn",
      lowCloudPercent: 100,
      pvRemainingKwh: 0,
      car: { missingKwh: 22.5, usablePercent: 20, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carFrom).toBe("00:15");
    expect(plan.carTo).toBe("02:30");
  });

  it("buys the shortfall to 35% in the cheap evening after the expensive afternoon", () => {
    const plan = buildEnergyPlan({
      prices: prices([
        ["18:15-18:30", 270],
        ["18:30-18:45", 270],
        ["23:30-23:45", 40],
        ["23:45-24:00", 40]
      ]),
      startAt: "18:20",
      bottomTemperatureC: 55,
      aboveFloorKwh: 0,
      socPercent: 30,
      season: "autumn",
      lowCloudPercent: 100,
      pvRemainingKwh: 0,
      car: { missingKwh: 3.75, usablePercent: 30, pluggedIn: true, atHome: true }
    });
    expect(plan.car).toBe("on");
    expect(plan.carFrom).toBe("23:30");
    expect(plan.carTo).toBe("24:00");
  });
});
