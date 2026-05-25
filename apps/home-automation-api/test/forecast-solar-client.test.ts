/*
This test suite verifies forecast.solar payload parsing for flat and nested formats.
It ensures day totals are extracted from the response shape used by the live API.
*/

import { describe, expect, it, vi } from "vitest";
import { createDatePair } from "../src/lib/date.js";
import { fetchPanelDailyForecast } from "../src/services/forecast-solar-client.js";

describe("fetchPanelDailyForecast", () => {
  it("parses flat date keys returned by estimate/watthours/day", async () => {
    const { todayKey, tomorrowKey } = createDatePair();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            [todayKey]: 10000,
            [tomorrowKey]: 12000
          }
        }),
        { status: 200 }
      )
    );

    const forecast = await fetchPanelDailyForecast(
      {
        lat: 50.6920036,
        lon: 15.2203556,
        slope: 45,
        azimuth: -63,
        kwp: 5.5
      },
      {
        forecastSolarApiKey: "",
        timeoutMs: 8000,
        fetchImpl
      }
    );

    expect(forecast.todayWh).toBe(10000);
    expect(forecast.tomorrowWh).toBe(12000);
  });
});
