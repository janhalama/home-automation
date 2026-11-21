/*
Cards for the selected day.
Money is the grid result. Checks are the plan verdicts beside the number that explains each one.
*/

import type { LiveCard } from "./live-cards.ts";

export type DayMoney = {
  czkPerEur?: number | null;
  importCzk: number | null;
  exportCzk: number | null;
  balanceCzk: number | null;
  houseCzk?: number | null;
  batteryCzk?: number | null;
  carCzk?: number | null;
  tankCzk?: number | null;
  sunCzk?: number | null;
};

export type DayCheck = {
  medianEurPerMwh: number;
  importWeightedEurPerMwh: number | null;
  exportWeightedEurPerMwh: number | null;
  boughtCheaply: boolean | null;
  soldExpensively: boolean | null;
  minutesBelowFloor: number;
  lowestSocPercent: number;
  exportWasWise: boolean;
  tankPeriodsOnCheapHalf: number | null;
};

/* Four money cards before a priced reading exists. */
function waitingCards(): LiveCard[] {
  return ["Net", "Bought from the grid", "Sold", "Sun kept"].map((label) => ({
    label,
    value: "not yet",
    detail: ""
  }));
}

/* Kč with a leading minus when the day cost money. */
function crowns(value: number): string {
  const text = `${Math.abs(value).toFixed(2)} Kč`;
  return value < 0 ? `−${text}` : text;
}

/* Whole EUR/MWh, the unit the overview already shows on the price card. */
function euros(value: number): string {
  return value.toFixed(0);
}

/* Yes, no, or no energy moved that way. */
function answer(value: boolean | null): string {
  if (value === null)
    return "no energy moved";
  return value ? "yes" : "no";
}

/* Where today's grid purchase went. An absent split leaves the line off. */
function splitDetail(day: DayMoney): string {
  if (day.houseCzk == null || day.batteryCzk == null || day.carCzk == null || day.tankCzk == null)
    return "";
  return `house ${crowns(day.houseCzk)}, battery ${crowns(day.batteryCzk)}, car ${crowns(day.carCzk)}, tank ${crowns(day.tankCzk)}`;
}

/* Net, the purchase and its split, the sale, and the sun that stayed in the house. */
export function dayMoneyCards(day: DayMoney | null): LiveCard[] {
  if (day?.importCzk == null || day.exportCzk == null || day.balanceCzk == null)
    return waitingCards();
  return [
    { label: "Net", value: crowns(day.balanceCzk), detail: "" },
    { label: "Bought from the grid", value: crowns(day.importCzk), detail: splitDetail(day) },
    { label: "Sold", value: crowns(day.exportCzk), detail: "" },
    { label: "Sun kept", value: crowns(day.sunCzk ?? 0), detail: "" }
  ];
}

/* The euro rate used for this day's money, written under the cards. */
export function dayRateLine(day: DayMoney | null): string {
  if (day?.czkPerEur == null)
    return "Euro rate not yet.";
  return `Euro rate ${day.czkPerEur.toFixed(3)} Kč.`;
}

/* The plan checks. A day that cannot be scored yet is one waiting card. */
export function dayCheckCards(score: DayCheck | null, missing: string[]): LiveCard[] {
  if (!score)
    return [{
      label: "Day score",
      value: missing.length > 0 ? "not yet" : "morning cloud was not read",
      detail: ""
    }];
  const importDetail = score.importWeightedEurPerMwh === null
    ? "import price none"
    : `paid ${euros(score.importWeightedEurPerMwh)}, median ${euros(score.medianEurPerMwh)}`;
  const exportDetail = score.exportWeightedEurPerMwh === null
    ? "export price none"
    : `sold at ${euros(score.exportWeightedEurPerMwh)}, median ${euros(score.medianEurPerMwh)}`;
  const tank = score.tankPeriodsOnCheapHalf === null
    ? { value: "not started", detail: "" }
    : { value: String(score.tankPeriodsOnCheapHalf), detail: "on the cheap half" };
  return [
    { label: "Bought cheaply", value: answer(score.boughtCheaply), detail: importDetail },
    { label: "Sold expensively", value: answer(score.soldExpensively), detail: exportDetail },
    {
      label: "Battery",
      value: score.minutesBelowFloor === 0 ? "safe" : "below 20%",
      detail: `lowest ${score.lowestSocPercent.toFixed(0)}%, ${score.minutesBelowFloor.toFixed(0)} min under 20%`
    },
    { label: "Morning export", value: score.exportWasWise ? "wise" : "not wise", detail: "" },
    { label: "Tank", value: tank.value, detail: tank.detail }
  ];
}
