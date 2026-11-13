/*
The ČNB euro fixing, including the rate that stays in force over a weekend.
*/

import { describe, expect, it } from "vitest";
import { czkPerEurOn, fetchCnbEurRates, parseCnbEurRates } from "../src/services/cnb-eur.js";

describe("ČNB euro rate", () => {
  it("keeps the last published rate through the following days", () => {
    const rates = parseCnbEurRates([
      "Currency: EUR|Amount: 1",
      "Date|Rate",
      "12.11.2026|24.385",
      "13.11.2026|24.400"
    ].join("\n"));

    expect(rates).toEqual([
      { date: "2026-11-12", czkPerEur: 24.385 },
      { date: "2026-11-13", czkPerEur: 24.4 }
    ]);
    expect(czkPerEurOn("2026-11-12", rates)).toBe(24.385);
    expect(czkPerEurOn("2026-11-15", rates)).toBe(24.4);
    expect(czkPerEurOn("2026-11-11", rates)).toBeNull();
  });

  it("asks ČNB for the euro fixing between two dates", async () => {
    let asked = "";
    const rates = await fetchCnbEurRates("2026-10-14", "2026-11-12", async (url) => {
      asked = url;
      return {
        ok: true,
        status: 200,
        text: async () => "Currency: EUR|Amount: 1\nDate|Rate\n14.10.2026|24.355\n"
      };
    });

    expect(asked).toContain("from=14.10.2026");
    expect(asked).toContain("to=12.11.2026");
    expect(asked).toContain("currency=EUR");
    expect(rates).toEqual([{ date: "2026-10-14", czkPerEur: 24.355 }]);
  });
});
