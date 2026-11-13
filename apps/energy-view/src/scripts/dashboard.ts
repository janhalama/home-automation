/*
Loads one day and the live forecast from the energy API and draws them.
*/

import { renderBalanceHistory, type BalancePoint } from "./balance-chart.ts";
import { batteryChargeSentence } from "./battery-plan-series.ts";
import { renderDayRows } from "./day-rows.ts";
import { renderReserveHistory, type ReservePoint } from "./reserve-chart.ts";

type EnergyPoint = {
  time: string;
  priceEurPerMwh: number | null;
  pvKw: number | null;
  meterKw: number | null;
  batteryKw: number | null;
  socPercent: number | null;
  heatingOn: boolean | null;
  tankTemperatureC?: number | null;
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
  car: string;
  tankFrom: string | null;
  tankTo: string | null;
  carFrom: string | null;
  carTo: string | null;
  carKw: number;
  batteryFrom: string | null;
  batteryTo: string | null;
  batteryKw: number;
  batterySellFrom: string | null;
  batterySellTo: string | null;
  batterySellKw: number;
  batteryDischargeFrom: string | null;
  batteryDischargeTo: string | null;
  batteryDischargeKw: number;
  reserveSoc: number | null;
};
const STORAGE_KEY = "energy-view-connection";
const charts: Chart[] = [];

/* A public build setting. The page refuses to start without it. */
function publicEnv(name: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  if (!value)
    throw new Error(`Missing ${name}`);
  return value;
}

/* Read the saved API address and key. On the public name, the API is the same site. */
function readSettings(): { apiBase: string; apiKey: string } {
  const raw = localStorage.getItem(STORAGE_KEY);
  const saved = raw
    ? JSON.parse(raw) as { apiBase: string; apiKey: string }
    : { apiBase: publicEnv("PUBLIC_ENERGY_API_BASE"), apiKey: "" };
  if (location.hostname === publicEnv("PUBLIC_ENERGY_PUBLIC_HOST"))
    return { apiBase: location.origin, apiKey: saved.apiKey };
  return saved;
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
    car: values.get("car") ?? "",
    carFrom: clock("carFrom"),
    carTo: clock("carTo"),
    carKw: Number(values.get("carKw") ?? 0),
    batteryFrom: clock("batteryFrom"),
    batteryTo: clock("batteryTo"),
    batteryKw: Number(values.get("batteryKw") ?? 0),
    batterySellFrom: clock("batterySellFrom"),
    batterySellTo: clock("batterySellTo"),
    batterySellKw: Number(values.get("batterySellKw") ?? 0),
    batteryDischargeFrom: clock("batteryDischargeFrom"),
    batteryDischargeTo: clock("batteryDischargeTo"),
    batteryDischargeKw: Number(values.get("batteryDischargeKw") ?? 0),
    reserveSoc: values.get("reserveSoc") ? Number(values.get("reserveSoc")) : null
  };
}

/* GET the plan as text. asOf=open is the plan from the state of charge at the start of the day. */
async function loadPlan(apiBase: string, apiKey: string, day: string, asOf?: "open"): Promise<DayPlan | null> {
  const scope = asOf ? `&asOf=${asOf}` : "";
  const response = await fetch(`${apiBase}/api/energy/plan?date=${day}${scope}`, {
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

/* Minutes after midnight in Prague. */
function pragueMinutesNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
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
function renderPlanLine(plan: DayPlan | null, opening: DayPlan | null, recordedUntilMinute: number | null): void {
  const line = document.querySelector("#plan-line");
  if (!line)
    return;
  if (!plan) {
    line.textContent = "No plan for this day.";
    return;
  }
  const slot = (label: string, from: string | null, to: string | null, extra = "") =>
    from && to ? `${label} ${from}–${to}${extra}` : `${label} off`;
  const charge = batteryChargeSentence(plan, opening, recordedUntilMinute);
  const discharge = plan.batteryDischargeFrom && plan.batteryDischargeTo
    ? `Battery covers the house ${plan.batteryDischargeFrom}–${plan.batteryDischargeTo} at ${plan.batteryDischargeKw.toFixed(2)} kW`
    : "No battery discharge";
  const reserveText = plan.reserveSoc === null ? "the reserve" : `${plan.reserveSoc.toFixed(0)}%`;
  const carText = plan.car === "battery"
    ? `Obluda takes the house battery at ${plan.carKw.toFixed(0)} kW, more when the sun covers it, down to ${reserveText}${plan.carFrom && plan.carTo ? `, about ${plan.carFrom}–${plan.carTo}` : ""}`
    : plan.car === "surplus"
      ? "Obluda takes leftover sun while the battery is above 30%"
      : slot("Obluda", plan.carFrom, plan.carTo, ` at ${plan.carKw.toFixed(0)} kW`);
  const sale = plan.batterySellFrom && plan.batterySellTo
    ? `Battery sale ${plan.batterySellFrom}–${plan.batterySellTo} at ${plan.batterySellKw.toFixed(0)} kW, down to ${reserveText}`
    : "Battery sale off";
  line.textContent = [
    slot("Tank plan", plan.tankFrom, plan.tankTo),
    carText,
    charge,
    sale,
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

/* Kč with a leading minus when the day cost money. */
function crowns(value: number): string {
  const text = `${Math.abs(value).toFixed(2)} Kč`;
  return value < 0 ? `−${text}` : text;
}

/* The selected day's rate, import, export, and balance. */
function moneyStats(day: BalancePoint | null): string[] {
  const rate = day?.czkPerEur == null ? "not yet" : `${day.czkPerEur.toFixed(3)} Kč`;
  if (day?.importCzk == null || day.exportCzk == null || day.balanceCzk == null)
    return [
      stat("EUR rate", rate),
      stat("Grid purchase", "not yet"),
      stat("Export", "not yet"),
      stat("Sun saved", "not yet"),
      stat("Day balance", "not yet")
    ];
  return [
    stat("EUR rate", rate),
    stat("Grid purchase", crowns(day.importCzk)),
    stat("Export", crowns(day.exportCzk)),
    stat("Sun saved", crowns(day.sunCzk ?? 0)),
    stat("Day balance", crowns(day.balanceCzk))
  ];
}

/* Format one EUR/MWh figure. */
function priceLine(value: number | null): string {
  if (value === null)
    return "none";
  return `${value.toFixed(0)} EUR/MWh`;
}

/* Fill the money, the four scores, and the forecast deviation. */
function renderScores(series: SeriesResponse, balanceDay: BalancePoint | null): void {
  const root = document.querySelector("#scores");
  const deviation = document.querySelector("#forecast-deviation");
  if (!root || !deviation)
    return;
  const score = series.score;
  const money = moneyStats(balanceDay);
  if (!score) {
    root.innerHTML = [
      ...money,
      stat("Day score", series.missing.length > 0 ? "not yet" : "morning cloud was not read")
    ].join("");
  } else {
    const tank = score.tankPeriodsOnCheapHalf === null
      ? "not started"
      : String(score.tankPeriodsOnCheapHalf);
    root.innerHTML = [
      ...money,
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
    stat("Heater now", heating),
    stat("Tank", temperature),
    stat("Price now", price)
  ].join("");
}

/* The car's charging power for the day. A failure leaves that row empty. */
async function loadCarPoints(apiBase: string, apiKey: string, day: string): Promise<{ time: string; chargeKw: number | null }[]> {
  try {
    const response = await fetch(`${apiBase}/api/energy/car?date=${day}`, {
      headers: { "X-API-Key": apiKey }
    });
    if (!response.ok)
      return [];
    const body = await response.json() as { points?: { time: string; chargeKw: number | null }[] };
    return body.points ?? [];
  } catch {
    return [];
  }
}

/* Cover the reserved cards and charts while a fetch is in flight. */
function setPageLoading(isLoading: boolean): void {
  const main = document.querySelector("main");
  if (!main)
    return;
  main.classList.toggle("is-loading", isLoading);
  main.setAttribute("aria-busy", isLoading ? "true" : "false");
}

/* Show whether the manual car charge is on. */
async function refreshCarChargeButton(apiBase: string, apiKey: string): Promise<void> {
  const button = document.querySelector("#car-charge");
  const note = document.querySelector("#car-charge-note");
  if (!(button instanceof HTMLButtonElement))
    return;
  const response = await fetch(`${apiBase}/api/energy/car-charge`, {
    headers: { "X-API-Key": apiKey }
  });
  const on = response.ok && (await response.text()).includes("on=1");
  button.dataset.on = on ? "1" : "0";
  button.textContent = on ? "Stop charging Obluda" : "Charge Obluda now";
  if (note)
    note.textContent = on ? "Charging is requested. The wallbox follows within 15 minutes." : "";
}

/* Flip the manual car charge and say when the wallbox will follow. */
async function toggleCarCharge(): Promise<void> {
  const apiBase = (document.querySelector("#api-base") as HTMLInputElement).value.replace(/\/$/, "");
  const apiKey = (document.querySelector("#api-key") as HTMLInputElement).value;
  const button = document.querySelector("#car-charge");
  if (!(button instanceof HTMLButtonElement))
    return;
  const next = button.dataset.on === "1" ? "0" : "1";
  const response = await fetch(`${apiBase}/api/energy/car-charge?on=${next}`, {
    method: "POST",
    headers: { "X-API-Key": apiKey }
  });
  if (!response.ok)
    throw new Error("The charge switch was refused");
  await refreshCarChargeButton(apiBase, apiKey);
}

/* Load the live state and the selected day. */
async function loadDay(event?: Event): Promise<void> {
  event?.preventDefault();
  const status = document.querySelector("#status");
  const apiBase = (document.querySelector("#api-base") as HTMLInputElement).value.replace(/\/$/, "");
  const apiKey = (document.querySelector("#api-key") as HTMLInputElement).value;
  const day = (document.querySelector("#day") as HTMLInputElement).value;
  saveSettings(apiBase, apiKey);
  setPageLoading(true);
  if (status) {
    status.className = "status";
    status.textContent = "";
  }
  try {
    const today = day === pragueToday();
    const [live, series, livePlan, openingPlan, car, reserve, balance, sunCover] = await Promise.all([
      loadJson<LiveResponse>(apiBase, apiKey, "/api/energy/live"),
      loadJson<SeriesResponse>(apiBase, apiKey, `/api/energy/series?date=${day}`),
      today ? loadPlan(apiBase, apiKey, day) : Promise.resolve(null),
      loadPlan(apiBase, apiKey, day, "open"),
      loadCarPoints(apiBase, apiKey, day),
      loadJson<{ days: ReservePoint[] }>(apiBase, apiKey, `/api/energy/reserve-history?date=${day}`),
      loadJson<{ days: BalancePoint[] }>(apiBase, apiKey, `/api/energy/balance-history?date=${day}`),
      loadJson<{ from: string | null; to: string | null; points: { time: string; pvKw: number; houseKw: number }[] }>(
        apiBase,
        apiKey,
        `/api/energy/sun-cover?date=${day}`
      ).catch(() => ({ from: null, to: null, points: [] }))
    ]);
    const plan = livePlan ?? openingPlan;
    const reserveCanvas = document.querySelector("#reserve-history");
    if (reserveCanvas instanceof HTMLCanvasElement)
      renderReserveHistory(reserveCanvas, reserve.days);
    const balanceCanvas = document.querySelector("#balance-history");
    if (balanceCanvas instanceof HTMLCanvasElement)
      renderBalanceHistory(balanceCanvas, balance.days);
    renderLive(live);
    await refreshCarChargeButton(apiBase, apiKey);
    renderScores(series, balance.days.find((item) => item.date === day) ?? null);
    const hasReality = series.points.some((point) => point.pvKw !== null || point.meterKw !== null);
    renderDayLabel(day, hasReality);
    const recordedUntilMinute = today ? pragueMinutesNow() : null;
    renderPlanLine(plan, openingPlan, recordedUntilMinute);
    const rows = document.querySelector("#day-rows");
    if (rows)
      renderDayRows(rows as HTMLElement, {
        points: series.points.map((point) => ({ ...point, tankTemperatureC: point.tankTemperatureC ?? null })),
        plan,
        openingPlan,
        car,
        forecastKwh: today ? live.todayKwh : null,
        sunCover,
        recordedUntilMinute
      });
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
  } finally {
    setPageLoading(false);
  }
}

const settings = readSettings();
const apiBase = document.querySelector("#api-base") as HTMLInputElement;
const apiKey = document.querySelector("#api-key") as HTMLInputElement;
const day = document.querySelector("#day") as HTMLInputElement;
apiBase.value = settings.apiBase;
apiKey.value = settings.apiKey;
day.value = pragueToday();
document.querySelector("#car-charge")?.addEventListener("click", () => void toggleCarCharge().catch((error: unknown) => {
  const status = document.querySelector("#status");
  if (!status)
    return;
  status.className = "status error";
  status.textContent = error instanceof Error ? error.message : "The charge switch failed";
}));
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
