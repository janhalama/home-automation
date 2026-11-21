/*
The plan bar keeps a started hour solid and a later hour hatched.
*/

import { describe, expect, it } from "vitest";
import { parseChangeList, parseSegmentList, planBarBlocks, resultParts, triggerKind, type StoredSegment } from "./plan-bar.ts";

const tank: StoredSegment = { kind: "tank", from: "08:00", to: "12:00", kw: 2.5, mode: "" };
const later: StoredSegment = { kind: "tank", from: "20:00", to: "23:00", kw: 2.5, mode: "" };

describe("plan bar", () => {
  it("keeps a started tank solid and a later tank hatched", () => {
    const blocks = planBarBlocks([tank, later], "10:00");
    expect(blocks.find((block) => block.from === "08:00")).toMatchObject({ ahead: false, paint: "tank", lane: "Tank" });
    expect(blocks.find((block) => block.from === "20:00")).toMatchObject({ ahead: true, paint: "tank" });
  });

  it("paints a buy green, a sale red, and a wait gray, and a sale that has not started stays hatched", () => {
    const blocks = planBarBlocks([
      { kind: "battery-buy", from: "00:00", to: "02:00", kw: 6, mode: "" },
      { kind: "battery-wait", from: "03:00", to: "07:00", kw: 0, mode: "" },
      { kind: "battery-sell", from: "18:00", to: "19:00", kw: 8, mode: "" }
    ], "11:00");
    expect(blocks.find((block) => block.paint === "buy")).toMatchObject({ ahead: false });
    expect(blocks.find((block) => block.paint === "wait")).toMatchObject({ ahead: false });
    expect(blocks.find((block) => block.paint === "sell")).toMatchObject({ ahead: true });
    const house = blocks.filter((block) => block.paint === "house");
    expect(house.some((block) => block.ahead)).toBe(true);
    expect(house.some((block) => !block.ahead)).toBe(true);
  });

  it("draws nothing when the day has no stored decision", () => {
    expect(planBarBlocks([], "11:00")).toEqual([]);
  });

  it("reads a change line and the snapshot that belongs to it", () => {
    const lines = parseChangeList(
      "13:00 Tank reached 55°C | The hours still ahead changed.",
      "13:00=tank 08:00-12:00 2.5"
    );
    expect(lines).toEqual([{
      at: "13:00",
      trigger: "Tank reached 55°C",
      result: "The hours still ahead changed.",
      segments: [tank]
    }]);
    expect(parseSegmentList("car 23:00-24:00 11 grid")).toEqual([
      { kind: "car", from: "23:00", to: "24:00", kw: 11, mode: "grid" }
    ]);
  });

  it("splits a result into lines and groups the trigger", () => {
    expect(resultParts("Tank 00:30–04:45. Car grid 00:30–01:45. Battery buy 00:30–01:45 at 2.5 kW.")).toEqual([
      "Tank 00:30–04:45",
      "Car grid 00:30–01:45",
      "Battery buy 00:30–01:45 at 2.5 kW"
    ]);
    expect(triggerKind("Expected sun")).toBe("sun");
    expect(triggerKind("The clock")).toBe("clock");
    expect(triggerKind("Something new")).toBe("other");
  });
});
