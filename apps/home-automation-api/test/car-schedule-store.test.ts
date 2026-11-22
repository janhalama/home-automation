/*
Remembers the one charge schedule the car accepted.
*/

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openHouseArchive } from "../src/services/house-archive.js";
import { carScheduleStore } from "../src/services/car-schedule-store.js";

describe("car schedule store", () => {
  it("returns null until a schedule has been accepted", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-schedule-"));
    const archive = openHouseArchive(join(dir, "house.sqlite"));
    const store = carScheduleStore(archive.database);
    expect(store.read()).toBeNull();
    store.save({ id: 1, from: "02:30", to: "03:45" });
    expect(store.read()).toEqual({ id: 1, from: "02:30", to: "03:45" });
    store.clear();
    expect(store.read()).toBeNull();
  });
});
