import { describe, expect, it } from "vitest";
import { carScheduleAction, type CarSchedule } from "../src/services/car-schedule.js";
import type { DecisionSegment } from "../src/services/day-decision.js";

const morning: DecisionSegment = { kind: "car", from: "02:30", to: "03:45", kw: 11, mode: "grid" };
const slide: DecisionSegment = { kind: "car", from: "02:45", to: "04:00", kw: 11, mode: "grid" };
const tonight: DecisionSegment = { kind: "car", from: "22:45", to: "24:00", kw: 11, mode: "grid" };
const sent: CarSchedule = { id: 1, from: "02:30", to: "03:45" };

describe("car schedule action", () => {
  it("adds the booked slot when its start is still ahead", () => {
    expect(carScheduleAction({
      segments: [morning],
      sent: null,
      now: "00:08",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "add", slot: { from: "02:30", to: "03:45" } });
  });

  it("leaves the car alone when the same slot was already sent", () => {
    expect(carScheduleAction({
      segments: [morning],
      sent,
      now: "01:00",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "keep" });
  });

  it("does not send a quarter-hour slide whose start has passed", () => {
    expect(carScheduleAction({
      segments: [morning, slide],
      sent,
      now: "02:50",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "keep" });
  });

  it("replaces the schedule when a later slot is still ahead", () => {
    expect(carScheduleAction({
      segments: [morning, tonight],
      sent,
      now: "06:05",
      carAtHome: true,
      carMissingKwh: 13.5
    })).toEqual({ action: "add", slot: { from: "22:45", to: "24:00" } });
  });

  it("removes the schedule when the car no longer needs a charge", () => {
    expect(carScheduleAction({
      segments: [morning],
      sent,
      now: "07:00",
      carAtHome: true,
      carMissingKwh: 0
    })).toEqual({ action: "remove" });
  });

  it("removes the schedule when the car leaves home", () => {
    expect(carScheduleAction({
      segments: [],
      sent,
      now: "12:00",
      carAtHome: false,
      carMissingKwh: 13.5
    })).toEqual({ action: "remove" });
  });

  it("does not remove a schedule when the car reading is missing", () => {
    expect(carScheduleAction({
      segments: [],
      sent,
      now: "12:00",
      carAtHome: null,
      carMissingKwh: null
    })).toEqual({ action: "keep" });
  });
});
