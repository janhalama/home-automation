import { describe, expect, it } from "vitest";
import { wallboxWindow } from "../src/services/wallbox-window.js";

describe("wallbox window", () => {
  it("opens one quarter early and closes one quarter late", () => {
    expect(wallboxWindow("02:30", "03:45")).toEqual({ from: "02:15", to: "04:00" });
  });

  it("does not open before midnight", () => {
    expect(wallboxWindow("00:00", "01:00")).toEqual({ from: "00:00", to: "01:15" });
  });

  it("keeps a slot that ends at midnight open until 00:15", () => {
    expect(wallboxWindow("22:45", "24:00")).toEqual({ from: "22:30", to: "00:15" });
  });

  it("keeps a slot that already crosses midnight", () => {
    expect(wallboxWindow("23:30", "01:00")).toEqual({ from: "23:15", to: "01:15" });
  });
});
