/*
Loads one day and the live forecast from the energy API and draws them.
*/

import { Chart, type ChartDataset } from "chart.js/auto";
import { loadCarChart } from "./car-chart.ts";

type EnergyPoint = {
  time: string;
  priceEurPerMwh: number | null;
  pvKw: number | null;
  meterKw: number | null;
  batteryKw: number | null;
  socPercent: number | null;
  heatingOn: boolean | null;
};

type DayScore = {
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

type ForecastDeviation = {
  count: number;
  signedMeanKwh: number;
  absoluteMeanKwh: number;
  byBand: Array<{ band: string; count: number; signedMeanKwh: number; absoluteMeanKwh: number }>;
};

type SeriesResponse = {
  date: string;
  points: EnergyPoint[];
  missing: string[];
  score: DayScore | null;
  deviation: ForecastDeviation | null;
  error?: string;
};

type LiveResponse = {
  todayKwh: number | null;
  tomorrowKwh: number | null;
  forecastError: string | null;
  heatingOn: boolean | null;
  tankTemperatureC: number | null;
  heatingSampleAt: string | null;
  priceEurPerMwh: number | null;
  priceInterval: string | null;
  error?: string;
};

type DayPlan = {
  tankFrom: string | null;
  tankTo: string | null;
  carFrom: string | null;
  carTo: string | null;
  carKw: number;
  batteryFrom: string | null;
  batteryTo: string | null;
  batteryKw: number;
  batteryDischargeFrom: string | null;
  batteryDischargeTo: string | null;
  batteryDischargeKw: number;
};
const STORAGE_KEY = "energy-view-connection";
const charts: Chart[] = [];

/* Read the saved API address and key. */
function readSettings(): { apiBase: string; apiKey: string } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw)
    return { apiBase: "http://192.168.1.3:3001", apiKey: "" };
  return JSON.parse(raw) as { apiBase: string; apiKey: string };
}

/* Keep the address and key in this browser. */
function saveSettings(apiBase: string, apiKey: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiBase, apiKey }));
}

/* GET one JSON route. */
async function loadJson<T>(apiBase: string, apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "X-API-Key": apiKey }
  });
  const body = await response.json() as T;
  if (!response.ok)
    throw new Error((body as { error?: string }).error ?? `The API responded ${response.status}`);
  return body;
}

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* True when this sample sits inside a plan slot. A slot that passes midnight includes both ends. The end minute is excluded. */
function inSlot(time: string, from: string | null, to: string | null): boolean {
  if (!from || !to)
    return false;
  const at = minutes(time);
  const start = minutes(from);
  const end = minutes(to);
  if (start === end)
    return false;
  if (end > start)
    return at >= start && at < end;
  return at >= start || at < end;
}

/* Read the plain-text plan. An error body means there is nothing to draw. */
function parsePlan(text: string): DayPlan | null {
  if (text.startsWith("error="))
    return null;
  const values = new Map(text.trim().split("\n").map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split), line.slice(split + 1)] as const;
  }));
  const clock = (key: string) => values.get(key) || null;
  return {
    tankFrom: clock("tankFrom"),
    tankTo: clock("tankTo"),
    carFrom: clock("carFrom"),
    carTo: clock("carTo"),
    carKw: Number(values.get("carKw") ?? 0),
    batteryFrom: clock("batteryFrom"),
    batteryTo: clock("batteryTo"),
    batteryKw: Number(values.get("batteryKw") ?? 0),
    batteryDischargeFrom: clock("batteryDischargeFrom"),
    batteryDischargeTo: clock("batteryDischargeTo"),
    batteryDischargeKw: Number(values.get("batteryDischargeKw") ?? 0)
  };
}

/* GET the plan as text. A failure leaves the charts without a plan. */
async function loadPlan(apiBase: string, apiKey: string, day: string): Promise<DayPlan | null> {
  const response = await fetch(`${apiBase}/api/energy/plan?date=${day}`, {
    headers: { "X-API-Key": apiKey }
  });
  if (!response.ok)
    return null;
  return parsePlan(await response.text());
}

/* Today's date in Prague, as YYYY-MM-DD. */
function pragueToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
}

/* Move a YYYY-MM-DD by whole calendar days. */
function shiftDate(day: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return pragueToday();
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/* A readable day name, still the Prague calendar day. */
function dayTitle(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date(`${day}T12:00:00Z`));
}

/* Say which day is on the charts, and whether measurements exist yet. */
function renderDayLabel(day: string, hasReality: boolean): void {
  const label = document.querySelector("#day-label");
  if (!label)
    return;
  const measured = hasReality ? "Measurements are on the solid lines." : "No measurements yet.";
  label.textContent = `${dayTitle(day)}. ${measured}`;
}

/* One sentence under the price chart. */
function renderPlanLine(plan: DayPlan | null): void {
  const line = document.querySelector("#plan-line");
  if (!line)
    return;
  if (!plan) {
    line.textContent = "No plan for this day.";
    return;
  }
  const slot = (label: string, from: string | null, to: string | null, extra = "") =>
    from && to ? `${label} ${from}–${to}${extra}` : `${label} off`;
  const charge = plan.batteryFrom && plan.batteryTo
    ? `Battery charge ${plan.batteryFrom}–${plan.batteryTo} at ${plan.batteryKw.toFixed(1)} kW`
    : "Battery charge off";
  const discharge = plan.batteryDischargeFrom && plan.batteryDischargeTo
    ? `Battery covers the house ${plan.batteryDischargeFrom}–${plan.batteryDischargeTo} at ${plan.batteryDischargeKw.toFixed(2)} kW`
    : "No battery discharge";
  line.textContent = [
    slot("Tank plan", plan.tankFrom, plan.tankTo),
    slot("Obluda", plan.carFrom, plan.carTo, ` at ${plan.carKw.toFixed(0)} kW`),
    charge,
    discharge
  ].join(". ") + ".";
}
/* One number card. */
function stat(label: string, value: string): string {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}

/* Yes, no, or no energy moved that way. */
function answer(value: boolean | null): string {
  if (value === null)
    return "no energy moved";
  return value ? "yes" : "no";
}

/* Format one EUR/MWh figure. */
function priceLine(value: number | null): string {
  if (value === null)
    return "none";
  return `${value.toFixed(0)} EUR/MWh`;
}

/* Fill the four scores and the forecast deviation. */
function renderScores(series: SeriesResponse): void {
  const root = document.querySelector("#scores");
  const deviation = document.querySelector("#forecast-deviation");
  if (!root || !deviation)
    return;
  const score = series.score;
  if (!score) {
    root.innerHTML = stat(
      "Day score",
      series.missing.length > 0 ? "not yet" : "morning cloud was not read"
    );
  } else {
    const tank = score.tankPeriodsOnCheapHalf === null
      ? "not started"
      : String(score.tankPeriodsOnCheapHalf);
    root.innerHTML = [
      stat("Bought cheaply", answer(score.boughtCheaply)),
      stat("Sold expensively", answer(score.soldExpensively)),
      stat("Battery stayed safe", score.minutesBelowFloor === 0 ? "yes" : "no"),
      stat("Morning export was wise", score.exportWasWise ? "yes" : "no"),
      stat("Import price", priceLine(score.importWeightedEurPerMwh)),
      stat("Day median", priceLine(score.medianEurPerMwh)),
      stat("Minutes under 20%", score.minutesBelowFloor.toFixed(0)),
      stat("Lowest charge", `${score.lowestSocPercent.toFixed(0)}%`),
      stat("Tank on the cheap half", tank)
    ].join("");
  }
  if (!series.deviation) {
    deviation.textContent = "Forecast deviation: no pair has been recorded.";
    return;
  }
  const bands = series.deviation.byBand
    .map((band) => `${band.band} ${band.signedMeanKwh.toFixed(1)} / ${band.absoluteMeanKwh.toFixed(1)} kWh`)
    .join(", ");
  deviation.textContent = `Forecast deviation: signed mean ${series.deviation.signedMeanKwh.toFixed(1)} kWh, mean absolute ${series.deviation.absoluteMeanKwh.toFixed(1)} kWh over ${series.deviation.count} day(s). ${bands}`;
}

/* Fill the live driving-state cards. */
function renderLive(live: LiveResponse): void {
  const root = document.querySelector("#live");
  if (!root)
    return;
  const heating = live.heatingOn === null ? "unknown" : live.heatingOn ? "on" : "off";
  const temperature = live.tankTemperatureC === null ? "unknown" : `${live.tankTemperatureC.toFixed(1)} °C`;
  const price = live.priceEurPerMwh === null ? "unknown" : `${live.priceEurPerMwh.toFixed(1)} EUR/MWh`;
  root.innerHTML = [
    stat("FVE today", live.todayKwh === null ? "unknown" : `${live.todayKwh.toFixed(1)} kWh`),
    stat("FVE tomorrow", live.tomorrowKwh === null ? "unknown" : `${live.tomorrowKwh.toFixed(1)} kWh`),
    stat("Heater", heating),
    stat("Tank", temperature),
    stat("Price now", price)
  ].join("");
}

/* Shared chart appearance. */
function chartOptions(yLabel: string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: { legend: { position: "bottom" as const } },
    scales: {
      x: { ticks: { maxTicksLimit: 8 } },
      y: { title: { display: true, text: yLabel } }
    }
  };
}

/* Draw the three charts for the loaded day. The plan is a band on the price and a dashed power. */
function renderCharts(points: EnergyPoint[], plan: DayPlan | null): void {
  charts.forEach((chart) => chart.destroy());
  charts.length = 0;
  const labels = points.map((point) => point.time.slice(0, 5));
  const price = document.querySelector("#price-chart") as HTMLCanvasElement | null;
  const power = document.querySelector("#power-chart") as HTMLCanvasElement | null;
  const soc = document.querySelector("#soc-chart") as HTMLCanvasElement | null;
  if (!price || !power || !soc)
    return;

  const line = (label: string, data: Array<number | null>, color: string, extra: Partial<ChartDataset> = {}) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    tension: 0.2,
    spanGaps: true,
    ...extra
  });

  const band = (label: string, from: string | null, to: string | null, color: string) => {
    if (!from || !to)
      return null;
    return line(label, points.map((point) => inSlot(point.time, from, to) ? point.priceEurPerMwh : null), color, {
      backgroundColor: color,
      borderWidth: 0,
      fill: "origin",
      spanGaps: false,
      stepped: true
    });
  };
  const priceStroke = (label: string, from: string | null, to: string | null, color: string) => {
    if (!from || !to)
      return null;
    return line(label, points.map((point) => inSlot(point.time, from, to) ? point.priceEurPerMwh : null), color, {
      borderWidth: 3,
      borderDash: [8, 4],
      fill: false,
      spanGaps: false,
      stepped: true
    });
  };
  const plannedKw = (label: string, from: string | null, to: string | null, kw: number, color: string) => {
    if (!from || !to || kw === 0)
      return null;
    return line(label, points.map((point) => inSlot(point.time, from, to) ? kw : null), color, {
      borderDash: [6, 4],
      spanGaps: false,
      stepped: true
    });
  };
  const present = <T,>(items: Array<T | null>): T[] => items.filter((item): item is T => item !== null);

  charts.push(new Chart(price, {
    type: "line",
    data: {
      labels,
      datasets: present([
        line("Price", points.map((point) => point.priceEurPerMwh), "#6750a4"),
        band("Tank plan", plan?.tankFrom ?? null, plan?.tankTo ?? null, "rgba(179, 38, 30, 0.35)"),
        band("Battery charge", plan?.batteryFrom ?? null, plan?.batteryTo ?? null, "rgba(125, 82, 96, 0.28)"),
        priceStroke("Obluda", plan?.carFrom ?? null, plan?.carTo ?? null, "#006a6a"),
        line("Heater", points.map((point) => point.heatingOn === null ? null : point.heatingOn ? 1 : 0), "#b3261e", {
          stepped: true,
          spanGaps: false,
          yAxisID: "y1"
        })
      ])
    },
    options: {
      ...chartOptions("EUR/MWh"),
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { title: { display: true, text: "EUR/MWh" } },
        y1: { position: "right", min: 0, max: 1, ticks: { stepSize: 1 }, grid: { drawOnChartArea: false }, title: { display: true, text: "Heater" } }
      }
    }
  }));

  const chargingAt = (time: string) =>
    plan !== null && inSlot(time, plan.batteryFrom, plan.batteryTo) && plan.batteryKw !== 0;
  const batteryCharge = plan && plan.batteryKw !== 0
    ? line("Battery charge", points.map((point) => chargingAt(point.time) ? -plan.batteryKw : null), "#7d5260", {
      borderDash: [6, 4],
      spanGaps: false,
      stepped: true
    })
    : null;
  const batteryDischarge = plan && plan.batteryDischargeKw !== 0
    ? line("Battery discharge", points.map((point) => {
      if (chargingAt(point.time) || !inSlot(point.time, plan.batteryDischargeFrom, plan.batteryDischargeTo))
        return null;
      return plan.batteryDischargeKw;
    }), "#8a5a00", {
      borderDash: [6, 4],
      spanGaps: false,
      stepped: true
    })
    : null;

  charts.push(new Chart(power, {
    type: "line",
    data: {
      labels,
      datasets: present([
        line("PV", points.map((point) => point.pvKw), "#386a20"),
        line("Grid", points.map((point) => point.meterKw), "#006a6a"),
        line("Battery", points.map((point) => point.batteryKw), "#7d5260"),
        plannedKw("Tank plan", plan?.tankFrom ?? null, plan?.tankTo ?? null, 2.5, "#b3261e"),
        plannedKw("Obluda", plan?.carFrom ?? null, plan?.carTo ?? null, plan?.carKw ?? 0, "#006a6a"),
        batteryCharge,
        batteryDischarge
      ])
    },
    options: chartOptions("kW")
  }));

  charts.push(new Chart(soc, {
    type: "line",
    data: {
      labels,
      datasets: present([
        line("State of charge", points.map((point) => point.socPercent), "#1d192b"),
        line("Floor", points.map(() => 20), "#b3261e", { borderDash: [4, 4] }),
        batteryCharge ? { ...batteryCharge, yAxisID: "y1" } : null,
        batteryDischarge ? { ...batteryDischarge, yAxisID: "y1" } : null
      ])
    },
    options: {
      ...chartOptions("%"),
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { position: "left", title: { display: true, text: "%" } },
        y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Plan kW" } }
      }
    }
  }));
}

/* Load the live state and the selected day. */
async function loadDay(event?: Event): Promise<void> {
  event?.preventDefault();
  const status = document.querySelector("#status");
  const apiBase = (document.querySelector("#api-base") as HTMLInputElement).value.replace(/\/$/, "");
  const apiKey = (document.querySelector("#api-key") as HTMLInputElement).value;
  const day = (document.querySelector("#day") as HTMLInputElement).value;
  saveSettings(apiBase, apiKey);
  if (status)
    status.textContent = "Loading…";
  try {
    const [live, series, plan] = await Promise.all([
      loadJson<LiveResponse>(apiBase, apiKey, "/api/energy/live"),
      loadJson<SeriesResponse>(apiBase, apiKey, `/api/energy/series?date=${day}`),
      loadPlan(apiBase, apiKey, day)
    ]);
    renderLive(live);
    renderScores(series);
    const hasReality = series.points.some((point) => point.pvKw !== null || point.meterKw !== null);
    renderDayLabel(day, hasReality);
    renderPlanLine(plan);
    renderCharts(series.points, plan);
    await loadCarChart(apiBase, apiKey, day, plan);
    const missing = series.points.length === 0
      ? "This day has no prices yet, so there is no plan to draw."
      : hasReality ? "" : "The plan is drawn. Measurements appear as the day is sampled.";
    const forecast = live.forecastError ?? "";
    if (status) {
      status.className = forecast ? "status error" : "status";
      status.textContent = [forecast, missing].filter(Boolean).join(" ");
    }
  } catch (error) {
    if (status) {
      status.className = "status error";
      status.textContent = error instanceof Error ? error.message : "The day could not be loaded.";
    }
  }
}

const settings = readSettings();
const apiBase = document.querySelector("#api-base") as HTMLInputElement;
const apiKey = document.querySelector("#api-key") as HTMLInputElement;
const day = document.querySelector("#day") as HTMLInputElement;
apiBase.value = settings.apiBase;
apiKey.value = settings.apiKey;
day.value = pragueToday();
document.querySelector("#connection")?.addEventListener("submit", (event) => void loadDay(event));
day.addEventListener("change", () => void loadDay());
document.querySelector("#prev-day")?.addEventListener("click", () => {
  day.value = shiftDate(day.value, -1);
  void loadDay();
});
document.querySelector("#today")?.addEventListener("click", () => {
  day.value = pragueToday();
  void loadDay();
});
document.querySelector("#next-day")?.addEventListener("click", () => {
  day.value = shiftDate(day.value, 1);
  void loadDay();
});
if (settings.apiKey)
  void loadDay();
