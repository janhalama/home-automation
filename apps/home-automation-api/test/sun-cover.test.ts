/*
The clock where the forecast panels meet the house, and where they fall behind.
*/

import { describe, expect, it } from "vitest";
import { openPredictionStore } from "../src/services/prediction-store.js";
import { sunCoverWindow } from "../src/services/sun-cover.js";
import { wattsFromPayload } from "../src/services/sun-hours.js";

describe("sun cover", () => {
  it("places the crossing between the hours on either side", () => {
    const houseKw = 0.5;
    const cover = sunCoverWindow([
      { at: "2026-11-10T08:00:00", pvKw: 0, houseKw },
      { at: "2026-11-10T09:00:00", pvKw: 0.25, houseKw },
      { at: "2026-11-10T10:00:00", pvKw: 1, houseKw },
      { at: "2026-11-10T11:00:00", pvKw: 1, houseKw },
      { at: "2026-11-10T14:00:00", pvKw: 0.6, houseKw },
      { at: "2026-11-10T15:00:00", pvKw: 0.2, houseKw }
    ]);
    expect(cover).toEqual({ from: "09:20", to: "14:15" });
  });

  it("stays empty when the panels stay under the house", () => {
    expect(sunCoverWindow([
      { at: "2026-11-10T10:00:00", pvKw: 0.2, houseKw: 0.5 },
      { at: "2026-11-10T11:00:00", pvKw: 0.4, houseKw: 0.5 }
    ])).toBeNull();
  });
});

describe("stored sun hours", () => {
  it("reads watts from a forecast.solar estimate and keeps them", () => {
    const east = wattsFromPayload({
      result: { watts: { "2026-11-10 10:00:00": 400, "2026-11-10 11:00:00": 800 } }
    });
    const west = wattsFromPayload({
      result: { watts: { "2026-11-10 10:00:00": 100, "2026-11-10 11:00:00": 200 } }
    });
    expect(east.get("2026-11-10T10:00:00")).toBe(400);
    const store = openPredictionStore(":memory:");
    store.saveSunHours([
      { at: "2026-11-10T10:00:00", pvKw: ((east.get("2026-11-10T10:00:00") ?? 0) + (west.get("2026-11-10T10:00:00") ?? 0)) / 1000 },
      { at: "2026-11-10T11:00:00", pvKw: 1 }
    ], "2026-11-09T20:00:00.000Z");
    expect(store.listSunHours("2026-11-10")).toEqual([
      { at: "2026-11-10T10:00:00", pvKw: 0.5 },
      { at: "2026-11-10T11:00:00", pvKw: 1 }
    ]);
    expect(store.latestSunIssuedAt()).toBe("2026-11-09T20:00:00.000Z");
    store.close();
  });
});
