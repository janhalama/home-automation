/*
The Miniserver pull is separate from a browser load of the same plan.
Green is a recent pull, orange is still inside the hour the follower keeps,
and red is a plan the Miniserver has dropped.
*/

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { openHouseArchive } from "../src/services/house-archive.js";
import { describePlanPull } from "../src/services/plan-pull.js";

const minute = 60 * 1000;
const now = new Date("2026-11-21T10:00:00Z");

describe("plan pull age", () => {
  it("calls a pull from the last fifteen minutes fresh", () => {
    expect(describePlanPull(new Date(now.getTime() - 15 * minute), now)).toMatchObject({
      state: "fresh"
    });
  });

  it("calls a pull past the fifteen minute schedule stale", () => {
    expect(describePlanPull(new Date(now.getTime() - 16 * minute), now).state).toBe("stale");
  });

  it("calls a pull inside the following hour stale", () => {
    const described = describePlanPull(new Date(now.getTime() - 30 * minute), now);
    expect(described.state).toBe("stale");
    expect(described.sentence).toContain("still following");
  });

  it("calls a pull older than an hour obsolete", () => {
    const described = describePlanPull(new Date(now.getTime() - 61 * minute), now);
    expect(described.state).toBe("obsolete");
    expect(described.sentence).toContain("not following");
  });

  it("calls a missing pull obsolete", () => {
    expect(describePlanPull(null, now).state).toBe("obsolete");
  });
});

describe("loxone plan pull route", () => {
  it("remembers a Miniserver pull and ignores a browser load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-pull-"));
    const archivePath = join(dir, "house.sqlite");
    const archive = openHouseArchive(archivePath);
    archive.saveSpotPrices([
      { date: "2026-10-28", periodIndex: 1, periodInterval: "01:00-01:15", eurPerMwh: 10 }
    ]);
    archive.applyHeatingSample({ at: "2026-10-28T00:30:00", heatingOn: false, temperatureC: 40 });
    archive.close();
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
        json: async () => ({ hourly: { time: [], cloud_cover_low: [] } })
      })
    });

    const browser = await app.inject({
      method: "GET",
      url: "/api/energy/plan?date=2026-10-28",
      headers: { "x-api-key": "secret-key" }
    });
    expect(browser.statusCode).toBe(200);
    const before = await app.inject({
      method: "GET",
      url: "/api/energy/plan-pull",
      headers: { "x-api-key": "secret-key" }
    });
    expect(before.json()).toMatchObject({ pulledAt: null, state: "obsolete" });

    const miniserver = await app.inject({
      method: "GET",
      url: "/api/energy/plan?date=2026-10-28&apiKey=secret-key"
    });
    expect(miniserver.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/api/energy/plan-pull",
      headers: { "x-api-key": "secret-key" }
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().state).toBe("fresh");
    expect(after.json().pulledAt).toEqual(expect.any(String));
    expect(after.json().sentence).toContain("following");
    await app.close();
  });
});
