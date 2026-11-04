/*
Tests for the OTE day-ahead price response the house stores.
Prices are EUR/MWh for each 15-minute period.
*/

import { describe, expect, it } from "vitest";
import {
  czkPerEurMatchingLoxone,
  czkPerKwh,
  fetchDayAheadPrices,
  parseDayAheadPrices
} from "../src/services/ote-day-ahead.js";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
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
          <HourlyPrice>97.24</HourlyPrice>
        </Item>
        <Item>
          <Date>2026-10-26</Date>
          <PeriodResolution>PT15M</PeriodResolution>
          <PeriodIndex>2</PeriodIndex>
          <PeriodInterval>00:15-00:30</PeriodInterval>
          <Price>99.89</Price>
        </Item>
        <Item>
          <Date>2026-10-26</Date>
          <PeriodResolution>PT15M</PeriodResolution>
          <PeriodIndex>3</PeriodIndex>
          <PeriodInterval>00:30-00:45</PeriodInterval>
          <EmergencyState>1</EmergencyState>
        </Item>
      </Result>
    </GetDamPricePeriodEResponse>
  </soap:Body>
</soap:Envelope>`;

describe("parseDayAheadPrices", () => {
  it("reads the 15-minute marginal price and skips a period with no price", () => {
    const prices = parseDayAheadPrices(FIXTURE);

    expect(prices).toEqual([
      { date: "2026-10-26", periodIndex: 1, periodInterval: "00:00-00:15", eurPerMwh: 100.27 },
      { date: "2026-10-26", periodIndex: 2, periodInterval: "00:15-00:30", eurPerMwh: 99.89 }
    ]);
  });

  it("converts EUR/MWh to the Kč/kWh Loxone shows", () => {
    expect(czkPerKwh(100, 25)).toBe(2.5);
    expect(czkPerEurMatchingLoxone(100, 2.5)).toBe(25);
  });

  it("requests the 15-minute day from OTE", async () => {
    const prices = await fetchDayAheadPrices("2026-10-26", async (_url, body) => {
      expect(body).toContain("<pub:StartDate>2026-10-26</pub:StartDate>");
      expect(body).toContain("PT15M");
      return { ok: true, status: 200, text: async () => FIXTURE };
    });

    expect(prices).toHaveLength(2);
  });
});
