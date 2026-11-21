/*
The selected day's money and the plan checks, each verdict beside the number that explains it.
*/

import { describe, expect, it } from "vitest";
import { dayCheckCards, dayMoneyCards, dayRateLine } from "./day-cards.ts";

const money = {
  czkPerEur: 24.425,
  importCzk: 166.77,
  exportCzk: 0,
  balanceCzk: -166.77,
  houseCzk: 40,
  batteryCzk: 120,
  carCzk: 0,
  tankCzk: 6.77,
  sunCzk: 1.17
};

const score = {
  medianEurPerMwh: 219,
  importWeightedEurPerMwh: 174,
  exportWeightedEurPerMwh: null as number | null,
  boughtCheaply: true as boolean | null,
  soldExpensively: null as boolean | null,
  minutesBelowFloor: 0,
  lowestSocPercent: 24,
  exportWasWise: true,
  tankPeriodsOnCheapHalf: 1 as number | null
};

/* Find one card by its label. */
function card(cards: { label: string; value: string; detail: string }[], label: string) {
  const found = cards.find((item) => item.label === label);
  if (!found)
    throw new Error(`Missing card ${label}`);
  return found;
}

describe("day money cards", () => {
  it("leads with the net and splits the grid purchase", () => {
    const cards = dayMoneyCards(money);

    expect(card(cards, "Net").value).toBe("−166.77 Kč");
    expect(card(cards, "Bought from the grid")).toEqual({
      label: "Bought from the grid",
      value: "166.77 Kč",
      detail: "house 40.00 Kč, battery 120.00 Kč, car 0.00 Kč, tank 6.77 Kč"
    });
    expect(card(cards, "Sold").value).toBe("0.00 Kč");
    expect(card(cards, "Sun kept").value).toBe("1.17 Kč");
    expect(dayRateLine(money)).toBe("Euro rate 24.425 Kč.");
  });

  it("waits when the day has no priced readings", () => {
    const cards = dayMoneyCards(null);

    expect(cards.map((item) => item.value)).toEqual(["not yet", "not yet", "not yet", "not yet"]);
    expect(card(cards, "Bought from the grid").detail).toBe("");
    expect(dayRateLine(null)).toBe("Euro rate not yet.");
  });
});

describe("day check cards", () => {
  it("puts each verdict next to the price or the charge that produced it", () => {
    const cards = dayCheckCards(score, []);

    expect(card(cards, "Bought cheaply")).toEqual({
      label: "Bought cheaply",
      value: "yes",
      detail: "paid 174, median 219"
    });
    expect(card(cards, "Sold expensively")).toEqual({
      label: "Sold expensively",
      value: "no energy moved",
      detail: "export price none"
    });
    expect(card(cards, "Battery")).toEqual({
      label: "Battery",
      value: "safe",
      detail: "lowest 24%, 0 min under 20%"
    });
    expect(card(cards, "Morning export").value).toBe("wise");
    expect(card(cards, "Tank")).toEqual({ label: "Tank", value: "1", detail: "on the cheap half" });
  });

  it("shows the export price and a battery that went under the floor", () => {
    const cards = dayCheckCards({
      ...score,
      soldExpensively: true,
      exportWeightedEurPerMwh: 240.4,
      minutesBelowFloor: 15,
      lowestSocPercent: 18,
      exportWasWise: false,
      tankPeriodsOnCheapHalf: null
    }, []);

    expect(card(cards, "Sold expensively").detail).toBe("sold at 240, median 219");
    expect(card(cards, "Battery")).toEqual({
      label: "Battery",
      value: "below 20%",
      detail: "lowest 18%, 15 min under 20%"
    });
    expect(card(cards, "Morning export").value).toBe("not wise");
    expect(card(cards, "Tank").value).toBe("not started");
  });

  it("says the day cannot be scored yet", () => {
    expect(dayCheckCards(null, ["cloud"]).map((item) => item.value)).toEqual(["not yet"]);
    expect(dayCheckCards(null, []).map((item) => item.value)).toEqual(["morning cloud was not read"]);
  });
});
