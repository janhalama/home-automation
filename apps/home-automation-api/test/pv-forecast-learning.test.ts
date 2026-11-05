/*
Tests for the correction that replaces a forecast once similar days have actual production.
*/

import { describe, expect, it } from "vitest";
import { forecastDeviation, learnedKwh, type LearnedDay } from "../src/services/pv-forecast-learning.js";

function day(date: string, lowCloud: number, actualKwh: number): LearnedDay {
  return { date, forecastKwh: 20, lowCloud, actualKwh };
}

describe("learnedKwh", () => {
  it("returns the issued forecast until five similar days exist", () => {
    const history = [1, 2, 3, 4].map((offset) => day(`2024-06-0${offset}`, 5, 30 + offset));

    expect(learnedKwh(17, 5, "2024-06-10", history)).toBe(17);
  });

  it("returns the median production of the same season and low-cloud band", () => {
    const history = [10, 12, 14, 16, 18].map((actualKwh, index) =>
      day(`2024-06-${10 + index}`, 5, actualKwh)
    );

    expect(learnedKwh(17, 8, "2024-06-20", history)).toBe(14);
  });

  it("ignores days from another cloud band or season", () => {
    const clearSummer = [10, 12, 14, 16, 18].map((actualKwh, index) =>
      day(`2024-06-${10 + index}`, 5, actualKwh)
    );
    const lowCloudSummer = [1, 2, 3, 4, 5].map((actualKwh, index) =>
      day(`2024-07-${10 + index}`, 90, actualKwh)
    );
    const clearWinter = [1, 2, 3, 4, 5].map((actualKwh, index) =>
      day(`2024-01-${10 + index}`, 5, actualKwh)
    );

    expect(learnedKwh(17, 80, "2024-07-20", [...clearSummer, ...lowCloudSummer, ...clearWinter])).toBe(3);
  });

  it("returns the issued forecast when the cloud height is missing", () => {
    const history = [10, 12, 14, 16, 18].map((actualKwh, index) =>
      day(`2024-06-${10 + index}`, 5, actualKwh)
    );

    expect(learnedKwh(17, null, "2024-06-20", history)).toBe(17);
  });
});

describe("forecastDeviation", () => {
  it("returns the signed mean and the mean absolute deviation", () => {
    const deviation = forecastDeviation([
      { forecastKwh: 10, actualKwh: 12, lowCloud: 5 },
      { forecastKwh: 10, actualKwh: 8, lowCloud: 90 }
    ]);

    expect(deviation?.signedMeanKwh).toBe(0);
    expect(deviation?.absoluteMeanKwh).toBe(2);
    expect(deviation?.byBand).toEqual([
      { band: "clear", count: 1, signedMeanKwh: 2, absoluteMeanKwh: 2 },
      { band: "covered", count: 1, signedMeanKwh: -2, absoluteMeanKwh: 2 }
    ]);
  });

  it("stays empty until a forecast has an actual result", () => {
    expect(forecastDeviation([])).toBeNull();
  });
});
