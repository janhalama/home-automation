/*
House overview cards: the plant right now, today's sun, and this month's grid money.
*/

import { describe, expect, it } from "vitest";
import { liveGroups } from "./live-cards.ts";

const quiet = {
  todayKwh: null,
  tomorrowKwh: null,
  heatingOn: null,
  tankTemperatureC: null,
  priceEurPerMwh: null,
  priceInterval: null,
  medianEurPerMwh: null,
  socPercent: null,
  monthImportCzk: null,
  monthExportCzk: null,
  todayProductionKwh: null
};

/* Find one card by its label. */
function card(cards: { label: string; value: string; detail: string }[], label: string) {
  const found = cards.find((item) => item.label === label);
  if (!found)
    throw new Error(`Missing card ${label}`);
  return found;
}

describe("live groups", () => {
  it("keeps the price, the battery, and the tank together, with the price against today's median", () => {
    const groups = liveGroups({
      ...quiet,
      priceEurPerMwh: 255.8,
      priceInterval: "09:00-09:15",
      medianEurPerMwh: 219,
      socPercent: 64,
      tankTemperatureC: 49.8,
      heatingOn: false
    });

    expect(card(groups.now, "Price now")).toEqual({
      label: "Price now",
      value: "255.8 EUR/MWh",
      detail: "09:00–09:15, above today's median of 219"
    });
    expect(card(groups.now, "Battery")).toEqual({ label: "Battery", value: "64%", detail: "" });
    expect(card(groups.now, "Tank")).toEqual({
      label: "Tank",
      value: "49.8 °C",
      detail: "heater off"
    });
  });

  it("says when the price is below or level with today's median", () => {
    const below = liveGroups({ ...quiet, priceEurPerMwh: 100, priceInterval: "01:00-01:15", medianEurPerMwh: 219 });
    const level = liveGroups({ ...quiet, priceEurPerMwh: 219, medianEurPerMwh: 219 });

    expect(card(below.now, "Price now").detail).toBe("01:00–01:15, below today's median of 219");
    expect(card(level.now, "Price now").detail).toBe("at today's median of 219");
  });

  it("puts the forecast beside what the meter has counted, and what is still to come", () => {
    const groups = liveGroups({
      ...quiet,
      todayKwh: 4.94,
      tomorrowKwh: 4.9,
      todayProductionKwh: 0.24
    });

    expect(card(groups.sun, "Forecast today").value).toBe("4.9 kWh");
    expect(card(groups.sun, "Produced").value).toBe("0.2 kWh");
    expect(card(groups.sun, "Still to come").value).toBe("4.7 kWh");
    expect(card(groups.sun, "Tomorrow").value).toBe("4.9 kWh");
  });

  it("stops still to come at zero once production passes the forecast", () => {
    const groups = liveGroups({ ...quiet, todayKwh: 4, todayProductionKwh: 4.2 });
    expect(card(groups.sun, "Still to come").value).toBe("0.0 kWh");
  });

  it("shows this month's purchases, sales, and the net", () => {
    const groups = liveGroups({ ...quiet, monthImportCzk: 10.5, monthExportCzk: 3.25, todayProductionKwh: 1.26 });

    expect(card(groups.month, "Bought").value).toBe("10.50 Kč");
    expect(card(groups.month, "Sold").value).toBe("3.25 Kč");
    expect(card(groups.month, "Net").value).toBe("−7.25 Kč");
    expect(card(groups.sun, "Produced").value).toBe("1.3 kWh");
  });

  it("keeps going when an older live reading has no battery charge and no median", () => {
    const groups = liveGroups({
      ...quiet,
      priceEurPerMwh: 255.8,
      priceInterval: "09:00-09:15",
      socPercent: undefined,
      medianEurPerMwh: undefined
    });

    expect(card(groups.now, "Battery").value).toBe("unknown");
    expect(card(groups.now, "Price now").detail).toBe("09:00–09:15");
  });

  it("says not yet when the month, the battery, and today's sun have not been recorded", () => {
    const groups = liveGroups(quiet);

    expect(card(groups.now, "Price now").value).toBe("unknown");
    expect(card(groups.now, "Battery").value).toBe("unknown");
    expect(card(groups.now, "Tank")).toEqual({ label: "Tank", value: "unknown", detail: "heater unknown" });
    expect(card(groups.sun, "Forecast today").value).toBe("unknown");
    expect(card(groups.sun, "Produced").value).toBe("not yet");
    expect(card(groups.sun, "Still to come").value).toBe("not yet");
    expect(card(groups.month, "Bought").value).toBe("not yet");
    expect(card(groups.month, "Sold").value).toBe("not yet");
    expect(card(groups.month, "Net").value).toBe("not yet");
  });
});
