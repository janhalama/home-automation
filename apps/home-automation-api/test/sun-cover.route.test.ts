/*
The chart series for the hour the forecast meets the house.
*/

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { openHouseArchive } from "../src/services/house-archive.js";
import { openPredictionStore } from "../src/services/prediction-store.js";

describe("sun cover route", () => {
  it("returns the forecast and the house for the chart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sun-cover-"));
    const archivePath = join(dir, "house.sqlite");
    const storePath = join(dir, "prediction.sqlite");
    const archive = openHouseArchive(archivePath);
    archive.savePowerSample({
      at: "2026-11-09T10:00:00",
      pvKw: 0,
      meterKw: -0.4,
      batteryKw: 0,
      socPercent: 40
    });
    archive.close();
    const store = openPredictionStore(storePath);
    store.saveSunHours([
      { at: "2026-11-10T09:00:00", pvKw: 0.2 },
      { at: "2026-11-10T10:00:00", pvKw: 1.2 },
      { at: "2026-11-10T14:00:00", pvKw: 0.6 },
      { at: "2026-11-10T15:00:00", pvKw: 0.2 }
    ], new Date().toISOString());
    store.close();

    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      predictionDbPath: storePath,
      wattsonicDaysDir: dir,
      fetchImpl: async () => {
        throw new Error("The stored forecast should be fresh");
      }
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/energy/sun-cover?date=2026-11-10",
      headers: { "x-api-key": "secret-key" }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { from: string; to: string; points: { time: string; pvKw: number; houseKw: number }[] };
    expect(body.points).toEqual([
      { time: "09:00", pvKw: 0.2, houseKw: 0.4 },
      { time: "10:00", pvKw: 1.2, houseKw: 0.4 },
      { time: "14:00", pvKw: 0.6, houseKw: 0.4 },
      { time: "15:00", pvKw: 0.2, houseKw: 0.4 }
    ]);
    expect(body.from).toBe("09:12");
    expect(body.to).toBe("14:30");
    await app.close();
  });
});
