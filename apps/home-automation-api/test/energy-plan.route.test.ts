/*
Tests for the plain-text plan Loxone pulls.
*/

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { openHouseArchive } from "../src/services/house-archive.js";

/* A UTC instant whose Prague clock is the given HH:MM on that calendar day. */
function pragueInstant(date: string, clock: string): Date {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const candidate = new Date(`${date}T00:00:00Z`);
    candidate.setUTCMinutes(minute);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(candidate);
    if (parts === clock)
      return candidate;
  }
  throw new Error(`Prague has no ${clock} on ${date}`);
}

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
    expect(response.body).toContain("batteryDischargeKw=0.00\n");
    expect(response.body).toContain("batteryDischargeFrom=\n");
    expect(response.body).toContain("batteryDischargeTo=\n");
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
    const opening = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}&asOf=open`,
      headers
    });
    const live = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}`,
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

  it("keeps a booked charge after a later poll would drop it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-plan-keep-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
    archive.saveSpotPrices([{
      date,
      periodIndex: 1,
      periodInterval: "02:00-02:15",
      eurPerMwh: 40
    }]);
    archive.applyHeatingSample({ at: `${date}T08:00:00`, heatingOn: false, temperatureC: 60 });
    archive.savePowerSample({ at: `${date}T13:00:00`, pvKw: 0, meterKw: -0.4, batteryKw: 0, socPercent: 30 });
    archive.saveChargeWindows(date, [{ from: "12:45", to: "14:00", kw: 6, kwh: 7.5 }]);
    archive.close();

    const morning = ["06", "07", "08", "09", "10", "11"].map((hour) => `${date}T${hour}:00`);
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      clock: () => pragueInstant(date, "13:00"),
      readCar: async () => ({ usablePercent: 40, limitPercent: 80, pluggedIn: false, atHome: true }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hourly: { time: morning, cloud_cover_low: [90, 90, 90, 90, 90, 90] } })
      })
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}`,
      headers: { "x-api-key": "secret-key" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("battery=grid-charge\n");
    expect(response.body).toContain("batteryFrom=12:45\n");
    expect(response.body).toContain("batteryTo=14:00\n");
    expect(response.body).toContain("batteryKw=6.0\n");
    expect(response.body).toContain("batteryCharges=12:45-14:00@6.0\n");
    await app.close();
  });

  it("keeps a tank window that already started and writes one line when the tank reaches 55°C", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-plan-day-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
    const prices: Array<[string, number]> = [];
    for (let start = 0; start < 24 * 60; start += 15) {
      const end = start + 15;
      const clock = (minute: number) =>
        minute === 24 * 60
          ? "24:00"
          : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const hour = Math.floor(start / 60);
      prices.push([`${clock(start)}-${clock(end)}`, hour < 6 || hour >= 20 ? 10 : 200]);
    }
    archive.saveSpotPrices(prices.map(([periodInterval, eurPerMwh], index) => ({
      date,
      periodIndex: index + 1,
      periodInterval,
      eurPerMwh
    })));
    archive.applyHeatingSample({ at: `${date}T08:00:00`, heatingOn: false, temperatureC: 40 });
    archive.savePowerSample({ at: `${date}T08:00:00`, pvKw: 0, meterKw: -0.3, batteryKw: 0, socPercent: 80 });
    archive.saveDayDecisions(date, [{ kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" }]);
    archive.close();

    let at = "10:00";
    const morning = ["06", "07", "08", "09", "10", "11"].map((hour) => `${date}T${hour}:00`);
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      clock: () => pragueInstant(date, at),
      readCar: async () => ({ usablePercent: 80, limitPercent: 80, pluggedIn: false, atHome: false }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hourly: { time: morning, cloud_cover_low: [40, 40, 40, 40, 40, 40] } })
      })
    });
    const headers = { "x-api-key": "secret-key" };
    const read = () => {
      const reader = openHouseArchive(archivePath);
      const changes = reader.listPlanChanges(date);
      const decisions = reader.listDayDecisions(date);
      reader.close();
      return { changes, decisions };
    };

    const first = await app.inject({ method: "GET", url: `/api/energy/plan?date=${date}`, headers });
    const afterFirst = read().changes.length;
    const second = await app.inject({ method: "GET", url: `/api/energy/plan?date=${date}`, headers });
    const opening = await app.inject({
      method: "GET",
      url: `/api/energy/plan?date=${date}&asOf=open`,
      headers
    });

    expect(first.statusCode).toBe(200);
    expect(first.body).toContain("tankFrom=08:00\n");
    expect(first.body).toContain("tankTo=12:00\n");
    expect(second.body).toContain("tankFrom=08:00\n");
    expect(read().changes).toHaveLength(afterFirst);
    expect(opening.statusCode).toBe(200);
    expect(read().changes).toHaveLength(afterFirst);

    at = "13:00";
    const later = openHouseArchive(archivePath);
    later.applyHeatingSample({ at: `${date}T13:00:00`, heatingOn: false, temperatureC: 55 });
    later.close();
    const third = await app.inject({ method: "GET", url: `/api/energy/plan?date=${date}`, headers });
    const stored = read();

    expect(third.statusCode).toBe(200);
    expect(third.body).toContain("Tank reached 55°C");
    expect(stored.decisions).toContainEqual({ kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" });
    expect(stored.changes[0]?.trigger).toBe("Tank reached 55°C");
    await app.close();
  });

  it("draws tomorrow from the calculation and leaves the store empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-plan-tomorrow-"));
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
      date: "2026-11-20",
      periodIndex: index + 1,
      periodInterval,
      eurPerMwh
    })));
    archive.applyHeatingSample({ at: "2026-11-19T22:00:00", heatingOn: false, temperatureC: 40 });
    archive.savePowerSample({ at: "2026-11-19T22:00:00", pvKw: 0, meterKw: -0.4, batteryKw: 0, socPercent: 80 });
    archive.close();

    const morning = ["06", "07", "08", "09", "10", "11"].map((hour) => `2026-11-20T${hour}:00`);
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: archivePath,
      wattsonicDaysDir: dir,
      clock: () => pragueInstant("2026-11-19", "23:40"),
      readCar: async () => ({ usablePercent: 50, limitPercent: 50, pluggedIn: false, atHome: false }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hourly: { time: morning, cloud_cover_low: [0, 0, 0, 0, 0, 0] } })
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/plan?date=2026-11-20&asOf=open",
      headers: { "x-api-key": "secret-key" }
    });
    const tankFrom = response.body.match(/tankFrom=(\d{2}:\d{2})/)?.[1];
    const tankTo = response.body.match(/tankTo=(\d{2}:\d{2})/)?.[1];
    const reader = openHouseArchive(archivePath);
    const stored = reader.listDayDecisions("2026-11-20");
    reader.close();

    expect(response.statusCode).toBe(200);
    expect(tankFrom).toBeTruthy();
    expect(response.body).toContain(`tank ${tankFrom}-${tankTo} 2.5`);
    expect(response.body).toContain("planChanges=\n");
    expect(stored).toEqual([]);
    await app.close();
  });
});
