/*
Tests for placing TeslaMate minutes onto the car chart.
*/

import { describe, expect, it } from "vitest";
import { buildCarDay } from "../src/services/car-day.js";
import { readCarDay, type CarDayQuery } from "../src/services/teslamate-history.js";

describe("car day", () => {
  it("keeps the highest charge in a quarter and the latest state of charge", () => {
    const points = buildCarDay({
      charges: [
        { time: "20:17:00", chargeKw: 11 },
        { time: "20:18:00", chargeKw: 0 }
      ],
      levels: [
        { time: "10:01:00", socPercent: 40 },
        { time: "10:10:00", socPercent: 38 }
      ],
      plugged: [{ fromMinute: 20 * 60 + 17, toMinute: 20 * 60 + 18 }]
    });

    const charge = points.find((point) => point.time === "20:15:00");
    const level = points.find((point) => point.time === "10:00:00");
    expect(charge).toMatchObject({ chargeKw: 11, pluggedIn: true });
    expect(level?.socPercent).toBe(38);
    expect(points).toHaveLength(96);
    expect(points[0]).toMatchObject({ time: "00:00:00", chargeKw: null, socPercent: null, pluggedIn: false });
  });

  it("reads charge, level, and plug rows without asking for a location", async () => {
    const query: CarDayQuery = async (text) => {
      expect(text).not.toMatch(/latitude|longitude/);
      if (text.includes("charger_power"))
        return [{ time: "02:10:00", charge_kw: 11 }];
      if (text.includes("usable_battery_level"))
        return [{ time: "08:05:00", soc_percent: 55 }, { time: "08:10:00", soc_percent: 54 }];
      return [{ from_minute: 120, to_minute: 150 }];
    };

    const points = await readCarDay(query, "2026-10-28");
    expect(points.find((point) => point.time === "02:00:00")).toMatchObject({
      chargeKw: 11,
      pluggedIn: true
    });
    expect(points.find((point) => point.time === "08:00:00")?.socPercent).toBe(54);
  });
});
