/*
Tests for the JSON the energy view loads from the API.
*/

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { createDatePair } from "../src/lib/date.js";
import { openHouseArchive } from "../src/services/house-archive.js";
import { pragueTimestamp } from "../src/services/house-collector.js";
import { addDays } from "../src/services/sun-clock.js";

describe("energy JSON", () => {
  it("returns price, heater, and power on one timeline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-series-"));
    const archivePath = join(dir, "house.sqlite");
    writeFileSync(
      join(dir, "2026-01-15.json"),
      JSON.stringify({
        body: {
          legend: ["PpvInput", "PmeterTotal", "Battery_P", "SOC"],
          xaxis: ["01:00:00", "01:15:00"],
          data: [
            [{ value: "1.5" }, { value: "1.2" }],
            [{ value: "-0.4" }, { value: "0.2" }],
            [{ value: "-1.0" }, { value: "0" }],
            [{ value: "40" }, { value: "41" }]
          ]
        }
      })
    );
    const archive = openHouseArchive(archivePath);
    archive.saveSpotPrices([
      { date: "2026-01-15", periodIndex: 5, periodInterval: "01:00-01:15", eurPerMwh: 12 },
      { date: "2026-01-15", periodIndex: 6, periodInterval: "01:15-01:30", eurPerMwh: 80 }
    ]);
    archive.applyHeatingSample({ at: "2026-01-15T01:00:00", heatingOn: true, temperatureC: 35 });
    archive.applyHeatingSample({ at: "2026-01-15T01:10:00", heatingOn: false, temperatureC: 40 });
    archive.close();

    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/series?date=2026-01-15",
      headers: { "x-api-key": "secret-key" }
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.points[0]).toMatchObject({
      time: "01:00:00",
      priceEurPerMwh: 12,
      pvKw: 1.5,
      meterKw: -0.4,
      heatingOn: true
    });
    expect(body.points[1].heatingOn).toBe(false);
    expect(body.points[1].priceEurPerMwh).toBe(80);
    expect(body.score).toBeNull();
    expect(body.deviation).toBeNull();
    await app.close();
  });

  it("scores the stored samples and says when no forecast pair exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-score-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    archive.saveSpotPrices([
      { date: "2026-01-15", periodIndex: 5, periodInterval: "01:00-01:15", eurPerMwh: 12 },
      { date: "2026-01-15", periodIndex: 6, periodInterval: "01:15-01:30", eurPerMwh: 80 }
    ]);
    archive.savePowerSample({ at: "2026-01-15T01:00:00", pvKw: 0, meterKw: -0.4, batteryKw: 0, socPercent: 20 });
    archive.savePowerSample({ at: "2026-01-15T01:15:00", pvKw: 0, meterKw: -0.4, batteryKw: 0, socPercent: 20 });
    archive.applyHeatingSample({ at: "2026-01-15T01:00:00", heatingOn: true, temperatureC: 35 });
    archive.applyHeatingSample({ at: "2026-01-15T01:10:00", heatingOn: false, temperatureC: 40 });
    archive.close();

    const morning = ["06", "07", "08", "09", "10", "11"].map((hour) => `2026-01-15T${hour}:00`);
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      predictionDbPath: join(dir, "prediction.sqlite"),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          hourly: { time: morning, cloud_cover_low: [10, 10, 10, 10, 10, 10] }
        })
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/series?date=2026-01-15",
      headers: { "x-api-key": "secret-key" }
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.score.boughtCheaply).toBe(true);
    expect(body.score.soldExpensively).toBeNull();
    expect(body.score.minutesBelowFloor).toBe(0);
    expect(body.score.lowestSocPercent).toBe(20);
    expect(body.score.tankPeriodsOnCheapHalf).toBe(1);
    expect(body.deviation).toBeNull();
    await app.close();
  });

  it("returns the forecast Loxone is given, and the latest heater sample", async () => {
    const { todayKey, tomorrowKey } = createDatePair();
    const dir = mkdtempSync(join(tmpdir(), "energy-live-"));
    const archivePath = join(dir, "house.sqlite");
    const stamp = pragueTimestamp(new Date());
    const hour = Number(stamp.slice(11, 13));
    const quarter = Math.floor(Number(stamp.slice(14, 16)) / 15) * 15;
    const start = `${String(hour).padStart(2, "0")}:${String(quarter).padStart(2, "0")}`;
    const endTotal = hour * 60 + quarter + 15;
    const end = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
    const archive = openHouseArchive(archivePath);
    archive.saveSpotPrices([
      { date: stamp.slice(0, 10), periodIndex: 1, periodInterval: `${start}-${end}`, eurPerMwh: 55 }
    ]);
    archive.applyHeatingSample({ at: stamp, heatingOn: true, temperatureC: 48 });
    archive.close();

    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: { [todayKey]: 5000, [tomorrowKey]: 8000 } })
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/live",
      headers: { "x-api-key": "secret-key" }
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.todayKwh).toBe(10);
    expect(body.tomorrowKwh).toBe(16);
    expect(body.heatingOn).toBe(true);
    expect(body.tankTemperatureC).toBe(48);
    expect(body.priceEurPerMwh).toBe(55);
    expect(body.socPercent).toBeNull();
    expect(body.medianEurPerMwh).toBe(55);
    await app.close();
  });

  it("returns this month's purchases and sales, and the sun measured today", async () => {
    const { todayKey, tomorrowKey } = createDatePair();
    const today = pragueTimestamp(new Date()).slice(0, 10);
    const [year, month, day] = today.split("-");
    const dir = mkdtempSync(join(tmpdir(), "energy-month-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    const before = addDays(`${year}-${month}-01`, -1);
    archive.savePowerSample({ at: `${before}T12:00:00`, pvKw: 9, meterKw: -4, batteryKw: 0, socPercent: 50 });
    archive.savePowerSample({ at: `${before}T12:15:00`, pvKw: 0, meterKw: 0, batteryKw: 0, socPercent: 50 });
    archive.saveSpotPrices([
      { date: before, periodIndex: 48, periodInterval: "12:00-12:15", eurPerMwh: 500 }
    ]);
    archive.savePowerSample({ at: `${today}T12:00:00`, pvKw: 4, meterKw: -1, batteryKw: 0, socPercent: 50 });
    archive.savePowerSample({ at: `${today}T12:15:00`, pvKw: 0, meterKw: 2, batteryKw: 0, socPercent: 50 });
    archive.savePowerSample({ at: `${today}T12:30:00`, pvKw: 0, meterKw: 0, batteryKw: 0, socPercent: 64 });
    archive.saveSpotPrices([
      { date: today, periodIndex: 48, periodInterval: "12:00-12:15", eurPerMwh: 100 },
      { date: today, periodIndex: 49, periodInterval: "12:15-12:30", eurPerMwh: 80 }
    ]);
    archive.close();

    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      fetchImpl: async (url: string) => {
        if (url.includes("cnb.cz"))
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => `Currency: EUR\nAmount: 1\n${day}.${month}.${year}|25\n`
          };
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { [todayKey]: 1000, [tomorrowKey]: 2000 } })
        };
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/live",
      headers: { "x-api-key": "secret-key" }
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.monthImportCzk).toBeCloseTo(0.25 * (100 * 25 / 1000 + 1.5));
    expect(body.monthExportCzk).toBeCloseTo(0.5 * (80 * 25 / 1000));
    expect(body.todayProductionKwh).toBeCloseTo(1);
    expect(body.socPercent).toBe(64);
    expect(body.medianEurPerMwh).toBe(90);
    await app.close();
  });
});
