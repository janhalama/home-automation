/*
The 30-day reserve. A clear weekend keeps more than a clear workday when the archive is empty.
*/

import { describe, expect, it } from "vitest";
import { reserveHistory } from "../src/services/reserve-history.js";

describe("reserve history", () => {
  it("keeps a higher reserve on a clear autumn Sunday than on the Wednesday before it", () => {
    const days = reserveHistory({
      endDate: "2026-11-08",
      readDay: () => [],
      morningCloud: () => 0
    });
    expect(days).toHaveLength(30);
    expect(days[0]?.date).toBe("2026-10-10");
    expect(days.at(-1)?.date).toBe("2026-11-08");
    const sunday = days.find((day) => day.date === "2026-11-08");
    const wednesday = days.find((day) => day.date === "2026-11-04");
    expect(sunday?.reserveSoc).toBeGreaterThan(wednesday?.reserveSoc ?? 100);
    expect(sunday?.reserveSoc).toBeLessThan(100);
  });
});
