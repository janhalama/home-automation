/*
Tests for the shortest cheap run of quarter-hour prices.
*/

import { describe, expect, it } from "vitest";
import { cheapestSlot, cheapestSlotAcrossMidnight, type PriceQuarter } from "../src/services/cheap-slot.js";

/* One delivery day's quarters from `from` until `to`, each at the same price. */
function quarters(from: string, to: string, eurPerMwh: number): PriceQuarter[] {
  const clock = (minutes: number) => {
    const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
    const minute = (minutes % 60).toString().padStart(2, "0");
    return `${hour}:${minute}`;
  };
  const minutes = (value: string) => {
    const [hour, minute] = value.split(":");
    return Number(hour) * 60 + Number(minute);
  };
  const result: PriceQuarter[] = [];
  for (let start = minutes(from); start < minutes(to); start += 15)
    result.push({ periodInterval: `${clock(start)}-${clock(start + 15)}`, eurPerMwh });
  return result;
}

describe("cheapest slot", () => {
  it("picks the single cheapest quarter that ends by the deadline", () => {
    const slot = cheapestSlot(
      [
        { periodInterval: "05:45-06:00", eurPerMwh: 10 },
        { periodInterval: "06:00-06:15", eurPerMwh: 1 },
        { periodInterval: "05:30-05:45", eurPerMwh: 40 }
      ],
      0.25,
      1,
      "06:00"
    );
    expect(slot).toEqual({ from: "05:45", to: "06:00" });
  });

  it("picks the cheapest run that is long enough and no longer", () => {
    const slot = cheapestSlot(
      [
        { periodInterval: "00:00-00:15", eurPerMwh: 5 },
        { periodInterval: "00:15-00:30", eurPerMwh: 100 },
        { periodInterval: "00:30-00:45", eurPerMwh: 5 },
        { periodInterval: "00:45-01:00", eurPerMwh: 5 }
      ],
      1,
      2,
      null
    );
    expect(slot).toEqual({ from: "00:30", to: "01:00" });
  });

  it("returns null when the energy is zero or no run is long enough", () => {
    expect(cheapestSlot([{ periodInterval: "00:00-00:15", eurPerMwh: 10 }], 0, 2, null)).toBeNull();
    expect(cheapestSlot([{ periodInterval: "00:00-00:15", eurPerMwh: 10 }], 5, 2, "06:00")).toBeNull();
  });

  it("drops a quarter that has already ended", () => {
    const slot = cheapestSlot(
      [
        { periodInterval: "22:45-23:00", eurPerMwh: 1 },
        { periodInterval: "23:00-23:15", eurPerMwh: 50 }
      ],
      0.25,
      1,
      null,
      "23:00"
    );
    expect(slot).toEqual({ from: "23:00", to: "23:15" });
  });

  it("prefers the cheap run that crosses midnight over a dearer run after midnight", () => {
    const slot = cheapestSlotAcrossMidnight(
      quarters("22:00", "24:00", 10),
      [...quarters("00:00", "01:00", 10), ...quarters("01:00", "06:00", 80)],
      2,
      1,
      "23:00"
    );
    expect(slot).toEqual({ from: "23:00", to: "01:00" });
  });

  it("allows a run that sits entirely after midnight", () => {
    const slot = cheapestSlotAcrossMidnight(
      quarters("23:00", "24:00", 100),
      [...quarters("00:00", "02:00", 5), ...quarters("02:00", "06:00", 100)],
      2,
      1,
      "23:00"
    );
    expect(slot).toEqual({ from: "00:00", to: "02:00" });
  });

  it("returns null when the job cannot finish by 06:00", () => {
    const slot = cheapestSlotAcrossMidnight(
      quarters("23:00", "24:00", 10),
      [...quarters("00:00", "06:00", 10), ...quarters("06:00", "08:00", 1)],
      8,
      1,
      "23:00"
    );
    expect(slot).toBeNull();
  });

  it("does not choose a quarter that has already ended", () => {
    const slot = cheapestSlotAcrossMidnight(
      [
        { periodInterval: "22:45-23:00", eurPerMwh: 1 },
        { periodInterval: "23:00-23:15", eurPerMwh: 40 }
      ],
      quarters("00:00", "06:00", 80),
      0.25,
      1,
      "23:00"
    );
    expect(slot).toEqual({ from: "23:00", to: "23:15" });
  });
});
