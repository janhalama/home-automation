/*
Import pays the spot price plus distribution. Export pays the spot price. The euro rate is the day's ČNB fixing.
*/

import { describe, expect, it } from "vitest";
import { dayBalance } from "../src/services/day-balance.js";

describe("day balance", () => {
  it("prices import and export with the given Kč per euro", () => {
    const balance = dayBalance([
      { time: "01:00:00", meterKw: -1, priceEurPerMwh: 200 },
      { time: "01:15:00", meterKw: 2, priceEurPerMwh: 400 },
      { time: "01:30:00", meterKw: 0, priceEurPerMwh: 400 }
    ], 24.385);

    expect(balance.importKwh).toBeCloseTo(0.25);
    expect(balance.importCzk).toBeCloseTo(0.25 * (200 * 24.385 / 1000 + 1.5));
    expect(balance.houseCzk).toBeCloseTo(balance.importCzk);
    expect(balance.batteryCzk).toBe(0);
    expect(balance.carCzk).toBe(0);
    expect(balance.tankCzk).toBe(0);
    expect(balance.exportKwh).toBeCloseTo(0.5);
    expect(balance.exportCzk).toBeCloseTo(0.5 * (400 * 24.385 / 1000));
    expect(balance.balanceCzk).toBeCloseTo(balance.exportCzk - balance.importCzk);
  });

  it("leaves a quarter out of the money when its spot price is missing", () => {
    const balance = dayBalance([
      { time: "02:00:00", meterKw: -4, priceEurPerMwh: null },
      { time: "02:15:00", meterKw: 0, priceEurPerMwh: 100 }
    ], 24.385);

    expect(balance.importCzk).toBe(0);
    expect(balance.unpricedKwh).toBeCloseTo(1);
  });

  it("splits the import across the house, the battery, the car, and the tank", () => {
    const balance = dayBalance([
      {
        time: "03:00:00",
        meterKw: -4,
        priceEurPerMwh: 200,
        pvKw: 0,
        batteryKw: -2,
        carKw: 1,
        tankKw: 1
      },
      { time: "03:15:00", meterKw: 0, priceEurPerMwh: 200 }
    ], 24.385);
    const perKwh = 200 * 24.385 / 1000 + 1.5;

    expect(balance.houseCzk).toBeCloseTo(0);
    expect(balance.batteryCzk).toBeCloseTo(0.5 * perKwh);
    expect(balance.carCzk).toBeCloseTo(0.25 * perKwh);
    expect(balance.tankCzk).toBeCloseTo(0.25 * perKwh);
    expect(balance.importCzk).toBeCloseTo(balance.houseCzk + balance.batteryCzk + balance.carCzk + balance.tankCzk);
  });

  it("values the sun that stayed in the house at the import price, and leaves the exported sun in the export", () => {
    const balance = dayBalance([
      { time: "12:00:00", meterKw: 1, priceEurPerMwh: 200, pvKw: 4 },
      { time: "12:15:00", meterKw: 0, priceEurPerMwh: 200, pvKw: 2 },
      { time: "12:30:00", meterKw: 0, priceEurPerMwh: 200, pvKw: 0 }
    ], 24.385);
    const importPrice = 200 * 24.385 / 1000 + 1.5;

    expect(balance.sunCzk).toBeCloseTo((0.75 + 0.5) * importPrice);
    expect(balance.exportCzk).toBeCloseTo(0.25 * (200 * 24.385 / 1000));
    expect(balance.exportKwh).toBeCloseTo(0.25);
  });
});
