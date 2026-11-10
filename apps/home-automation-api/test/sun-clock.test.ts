/*
Sunrise and sunset at the house, checked against the reduction script.
*/

import { describe, expect, it } from "vitest";
import { addDays, daylightDate, sunClocks, weekday } from "../src/services/sun-clock.js";

describe("sun clocks", () => {
  it("matches the almanac on a long day, a short day, and an autumn day", () => {
    expect(sunClocks("2024-06-21")).toEqual({ rise: "04:46:00", set: "21:16:00" });
    expect(sunClocks("2024-12-21")).toEqual({ rise: "07:59:00", set: "15:56:00" });
    expect(sunClocks("2024-11-08")).toEqual({ rise: "07:03:00", set: "16:22:00" });
  });

  it("treats the daylight after sunset as the next calendar day", () => {
    expect(daylightDate("2024-11-08", "17:00")).toBe("2024-11-09");
    expect(daylightDate("2024-11-08", "08:00")).toBe("2024-11-08");
    expect(daylightDate("2024-11-08", null)).toBe("2024-11-08");
  });

  it("keeps the calendar weekday when adding days", () => {
    expect(weekday("2026-11-08")).toBe(0);
    expect(addDays("2026-11-08", -1)).toBe("2026-11-07");
    expect(weekday("2026-11-07")).toBe(6);
  });
});
