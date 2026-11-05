/*
Renders one day's energy score as a page the browser on the LAN can open.
*/

import type { DayScore } from "./day-score.js";
import type { ForecastDeviation } from "./pv-forecast-learning.js";

/* Format a price, or say that the house did not move energy that way. */
function priceLine(value: number | null): string {
  if (value === null)
    return "none";
  return `${value.toFixed(2)} EUR/MWh`;
}

/* Format a yes, a no, or an absence. */
function answer(value: boolean | null): string {
  if (value === null)
    return "no energy moved";
  return value ? "yes" : "no";
}

/* Render the four scores, the tank line, and the forecast deviation for one date. */
export function renderDayPage(date: string, score: DayScore, deviation: ForecastDeviation | null): string {
  const tank = score.tankPeriodsOnCheapHalf === null
    ? "Tank history has not started."
    : `${score.tankPeriodsOnCheapHalf} heating period(s) overlapped the cheap half of the day.`;
  const forecast = deviation === null
    ? "Forecast deviation: no pair has been recorded."
    : `Forecast deviation: signed mean ${deviation.signedMeanKwh.toFixed(2)} kWh, mean absolute ${deviation.absoluteMeanKwh.toFixed(2)} kWh over ${deviation.count} day(s). ${deviation.byBand.map((band) => `${band.band} ${band.signedMeanKwh.toFixed(2)} / ${band.absoluteMeanKwh.toFixed(2)} kWh (n=${band.count})`).join(". ")}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Energy ${date}</title>
</head>
<body>
  <h1>${date}</h1>
  <p>Bought cheaply: ${answer(score.boughtCheaply)}. Import price ${priceLine(score.importWeightedEurPerMwh)}. Day median ${score.medianEurPerMwh.toFixed(2)} EUR/MWh.</p>
  <p>Sold expensively: ${answer(score.soldExpensively)}. Export price ${priceLine(score.exportWeightedEurPerMwh)}.</p>
  <p>Battery stayed safe: ${score.minutesBelowFloor === 0 ? "yes" : "no"}. Minutes under 20%: ${score.minutesBelowFloor.toFixed(0)}. Lowest state of charge: ${score.lowestSocPercent.toFixed(1)}%.</p>
  <p>Morning PV export was wise: ${score.exportWasWise ? "yes" : "no"}.</p>
  <p>${tank}</p>
  <p>${forecast}</p>
</body>
</html>`;
}

/* Render a day the archive cannot score yet. */
export function renderMissingDay(date: string, reason: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Energy ${date}</title>
</head>
<body>
  <h1>${date}</h1>
  <p>${reason}</p>
</body>
</html>`;
}
