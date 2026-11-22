import { describe, expect, it } from "vitest";
import { addChargeScheduleBody, removeChargeScheduleBody } from "../src/services/fleet-charge-schedule.js";

describe("fleet charge schedule", () => {
  it("builds a one-time schedule for the booked slot", () => {
    expect(addChargeScheduleBody({
      date: "2026-11-22",
      from: "02:30",
      to: "03:45",
      lat: 50.6920036,
      lon: 15.2203556
    })).toEqual({
      id: 1,
      enabled: true,
      one_time: true,
      days_of_week: "Sunday",
      start_enabled: true,
      start_time: 150,
      end_enabled: true,
      end_time: 225,
      lat: 50.6920036,
      lon: 15.2203556
    });
  });

  it("sends an end at midnight as minute 0", () => {
    const body = addChargeScheduleBody({
      date: "2026-11-22",
      from: "22:45",
      to: "24:00",
      lat: 50.6920036,
      lon: 15.2203556
    });
    expect(body.start_time).toBe(22 * 60 + 45);
    expect(body.end_time).toBe(0);
    expect(body.one_time).toBe(true);
  });

  it("removes schedule 1", () => {
    expect(removeChargeScheduleBody()).toEqual({ id: 1 });
  });
});
