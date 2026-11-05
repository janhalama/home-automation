/*
Tests for filling the house archive from OTE and from the heater output.
*/

import { describe, expect, it, vi } from "vitest";
import { collectHouseSnapshot } from "../src/services/house-collector.js";
import { heatingSampleFromReadings, powerSampleFromReadings } from "../src/services/loxone-reading.js";
import { openHouseArchive } from "../src/services/house-archive.js";

const ONE_PRICE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetDamPricePeriodEResponse xmlns="http://www.ote-cr.cz/schema/service/public">
      <Result>
        <Item>
          <Date>2026-10-26</Date>
          <PeriodResolution>PT15M</PeriodResolution>
          <PeriodIndex>1</PeriodIndex>
          <PeriodInterval>00:00-00:15</PeriodInterval>
          <Price>100.27</Price>
        </Item>
      </Result>
    </GetDamPricePeriodEResponse>
  </soap:Body>
</soap:Envelope>`;

function loxone(value: string): string {
  return JSON.stringify({ LL: { value, Code: "200" } });
}

describe("powerSampleFromReadings", () => {
  it("reads panel power, grid power, battery power, and state of charge", () => {
    const sample = powerSampleFromReadings(
      "2026-10-26T21:00:00",
      loxone("0.0kW"),
      loxone("-0.4kW"),
      loxone("0.000"),
      loxone("20%")
    );

    expect(sample).toEqual({
      at: "2026-10-26T21:00:00",
      pvKw: 0,
      meterKw: -0.4,
      batteryKw: 0,
      socPercent: 20
    });
  });
});

describe("heatingSampleFromReadings", () => {
  it("reads the heater output and the boiler temperature", () => {
    const sample = heatingSampleFromReadings(
      "2026-10-26T19:30:00",
      JSON.stringify({ LL: { value: "1", Code: "200" } }),
      JSON.stringify({ LL: { value: "42.5", Code: "200" } })
    );

    expect(sample).toEqual({
      at: "2026-10-26T19:30:00",
      heatingOn: true,
      temperatureC: 42.5
    });
  });
});

describe("collectHouseSnapshot", () => {
  it("stores a missing day and a heater sample, and does not fetch a day already stored", async () => {
    const archive = openHouseArchive(":memory:");
    archive.saveSpotPrices([
      { date: "2026-10-26", periodIndex: 1, periodInterval: "00:00-00:15", eurPerMwh: 10 }
    ]);
    const post = vi.fn(async (_url: string, body: string) => {
      const date = body.match(/<pub:StartDate>([^<]+)<\/pub:StartDate>/)?.[1];
      const xml = ONE_PRICE.replaceAll("2026-10-26", date ?? "");
      return { ok: true, status: 200, text: async () => xml };
    });

    await collectHouseSnapshot({
      archive,
      now: new Date("2026-10-26T18:30:00Z"),
      post,
      wattsonicDaysDir: "",
      readPower: async () => ({
        at: "2026-10-26T19:30:00",
        pvKw: 0,
        meterKw: -0.5,
        batteryKw: 0.2,
        socPercent: 30
      }),
      readHeating: async () => ({
        at: "2026-10-26T19:30:00",
        heatingOn: true,
        temperatureC: 42.5
      })
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(archive.listSpotPrices("2026-10-26")).toHaveLength(1);
    expect(archive.listSpotPrices("2026-10-27")).toHaveLength(1);
    expect(archive.listPowerSamples("2026-10-26")).toEqual([
      {
        at: "2026-10-26T19:30:00",
        pvKw: 0,
        meterKw: -0.5,
        batteryKw: 0.2,
        socPercent: 30
      }
    ]);
    expect(archive.listHeatingPeriods("2026-10-26")).toEqual([
      {
        startedAt: "2026-10-26T19:30:00",
        endedAt: null,
        startTemperatureC: 42.5,
        endTemperatureC: null
      }
    ]);
    archive.close();
  });
});
