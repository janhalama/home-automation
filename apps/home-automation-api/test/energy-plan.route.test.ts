/*
Tests for the plain-text plan Loxone pulls.
*/

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { openHouseArchive } from "../src/services/house-archive.js";

describe("energy plan", () => {
  it("returns the tank slot and an unplugged car as off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-plan-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    const intervals: Array<[string, number]> = [
      ["01:00-01:15", 200],
      ["01:15-01:30", 10],
      ["01:30-01:45", 10],
      ["01:45-02:00", 10],
      ["02:00-02:15", 10],
      ["02:15-02:30", 10],
      ["02:30-02:45", 10]
    ];
    archive.saveSpotPrices(intervals.map(([periodInterval, eurPerMwh], index) => ({
      date: "2026-10-28",
      periodIndex: index + 1,
      periodInterval,
      eurPerMwh
    })));
    archive.applyHeatingSample({ at: "2026-10-28T00:30:00", heatingOn: false, temperatureC: 40 });
    archive.savePowerSample({ at: "2026-10-28T00:30:00", pvKw: 0, meterKw: -0.4, batteryKw: 0, socPercent: 80 });
    archive.close();

    const morning = ["06", "07", "08", "09", "10", "11"].map((hour) => `2026-10-28T${hour}:00`);
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      readCar: async () => ({ usablePercent: 50, limitPercent: 50, pluggedIn: false, atHome: false }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hourly: { time: morning, cloud_cover_low: [0, 0, 0, 0, 0, 0] } })
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/plan?date=2026-10-28",
      headers: { "x-api-key": "secret-key" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("tank=1\n");
    expect(response.body).toContain("tankFrom=01:15\n");
    expect(response.body).toContain("car=0\n");
    expect(response.body).toContain("battery=hold\n");
    expect(response.body).toContain("batteryDischargeKw=0.17\n");
    expect(response.body).toContain("batteryDischargeFrom=18:00\n");
    expect(response.body).toContain("batteryDischargeTo=06:00\n");
    await app.close();
  });

  it("keeps the night charge when the battery has already been filled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-plan-open-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
    const quarters: Array<[string, number]> = [];
    for (let index = 0; index < 16; index += 1) {
      const start = index * 15;
      const end = start + 15;
      const clock = (minute: number) =>
        `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      quarters.push([`${clock(start)}-${clock(end)}`, 10]);
    }
    quarters.push(["18:00-18:15", 200], ["18:15-18:30", 200], ["18:30-18:45", 200], ["18:45-19:00", 200]);
    archive.saveSpotPrices(quarters.map(([periodInterval, eurPerMwh], index) => ({
      date,
      periodIndex: index + 1,
      periodInterval,
      eurPerMwh
    })));
    archive.applyHeatingSample({ at: `${date}T00:00:00`, heatingOn: false, temperatureC: 55 });
    archive.savePowerSample({ at: `${date}T00:15:00`, pvKw: 0, meterKw: -1.5, batteryKw: -1.5, socPercent: 25 });
    archive.savePowerSample({ at: `${date}T18:00:00`, pvKw: 0, meterKw: 1, batteryKw: 1, socPercent: 95 });
    archive.close();

    const morning = ["06", "07", "08", "09", "10", "11"].map((hour) => `${date}T${hour}:00`);
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      readCar: async () => ({ usablePercent: 80, limitPercent: 80, pluggedIn: false, atHome: true }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hourly: { time: morning, cloud_cover_low: [90, 90, 90, 90, 90, 90] } })
      })
    });

    const headers = { "x-api-key": "secret-key" };
    const live = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}`,
      headers
    });
    const opening = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}&asOf=open`,
      headers
    });
    const rejected = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}&asOf=yesterday`,
      headers
    });

    expect(live.statusCode).toBe(200);
    expect(live.body).toContain("battery=hold\n");
    expect(opening.statusCode).toBe(200);
    expect(opening.body).toContain("battery=grid-charge\n");
    expect(opening.body).toContain("batteryFrom=00:00\n");
    expect(rejected.statusCode).toBe(400);
    const logged = await app.inject({
      method: "GET",
      url: "/api/energy/plan-log?error=no_response",
      headers
    });
    expect(logged.statusCode).toBe(200);
    expect(logged.body).toBe("ok\n");
    await app.close();
  });
});
