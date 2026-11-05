/*
Tests for the energy day page served next to the API.
*/

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { openHouseArchive } from "../src/services/house-archive.js";

describe("GET /api/energy/day", () => {
  it("shows the four scores for a stored day", async () => {
    const dir = mkdtempSync(join(tmpdir(), "energy-day-"));
    const archivePath = join(dir, "house.sqlite");
    writeFileSync(
      join(dir, "2026-01-15.json"),
      JSON.stringify({
        body: {
          legend: ["PpvInput", "PmeterTotal", "Battery_P", "SOC"],
          xaxis: ["00:00:00", "00:15:00", "00:30:00"],
          data: [
            [{ value: "0" }, { value: "0" }, { value: "0" }],
            [{ value: "-4" }, { value: "0" }, { value: "0" }],
            [{ value: "0" }, { value: "0" }, { value: "0" }],
            [{ value: "40" }, { value: "40" }, { value: "40" }]
          ]
        }
      })
    );
    const archive = openHouseArchive(archivePath);
    archive.saveSpotPrices([
      { date: "2026-01-15", periodIndex: 1, periodInterval: "00:00-00:15", eurPerMwh: 10 },
      { date: "2026-01-15", periodIndex: 2, periodInterval: "00:15-00:30", eurPerMwh: 80 }
    ]);
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
      url: "/api/energy/day?date=2026-01-15&lowCloud=90",
      headers: { "x-api-key": "secret-key" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Bought cheaply: yes");
    expect(response.body).toContain("Tank history has not started.");
    expect(response.body).toContain("no pair has been recorded");
    await app.close();
  });

  it("says the price is missing when the day was not archived", async () => {
    const app = createApp({
      apiKey: "secret-key",
      cacheTtlSeconds: 3600,
      timeoutMs: 8000,
      forecastSolarApiKey: "",
      houseArchivePath: ":memory:",
      wattsonicDaysDir: mkdtempSync(join(tmpdir(), "energy-empty-")),
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/energy/day?date=2026-01-15&lowCloud=90",
      headers: { "x-api-key": "secret-key" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("The price for this day is missing.");
    await app.close();
  });
});
