/*
Loads one day and the live forecast from the energy API and draws them.
*/

import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/labs/card/elevated-card.js";
import "@material/web/menu/menu.js";
import "@material/web/textfield/outlined-text-field.js";
import { renderBalanceHistory, type BalancePoint } from "./balance-chart.ts";
import { batteryChargeSentence } from "./battery-plan-series.ts";
import { renderPlanPull, type PlanPull } from "./plan-pull-banner.ts";
import { renderDayRows } from "./day-rows.ts";
import { dayCheckCards, dayMoneyCards, dayRateLine, type DayCheck } from "./day-cards.ts";
import { liveGroups, type LiveCard, type LiveSnapshot } from "./live-cards.ts";
import { parseChangeList, parseSegmentList, pragueClock, renderChangeList, renderPlanBar, toggleChangeList, type ChangeLine, type StoredSegment } from "./plan-bar.ts";
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

type DayScore = DayCheck;

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

type LiveResponse = LiveSnapshot & {
  forecastError: string | null;
  heatingSampleAt: string | null;
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
  batteryCharges?: { from: string; to: string; kw: number }[];
  decisions: StoredSegment[];
  planChanges: ChangeLine[];
};
const STORAGE_KEY = "energy-view-connection";

type ValueField = HTMLElement & { value: string };
type OpenMenu = HTMLElement & { open: boolean };

/* Read a text field, whether it is a native input or a Material field. */
function fieldValue(field: Element | null): string {
  if (!field || !("value" in field))
    return "";
  return String((field as ValueField).value);
}

/* Put the connection fields on the page until a key is saved, then into the header menu. */
function placeConnection(): void {
  const card = document.querySelector("#connection-card");
  const menu = document.querySelector("#connection-menu");
  const form = document.querySelector("#connection");
  const opener = document.querySelector("#connection-open");
  const apiKeyField = document.querySelector("#api-key");
  if (!(card instanceof HTMLElement) || !(menu instanceof HTMLElement) || !(form instanceof HTMLElement) || !(opener instanceof HTMLElement))
    return;
  const saved = fieldValue(apiKeyField).trim() !== "";
  if (saved)
    menu.append(form);
  else
    card.append(form);
  card.hidden = saved;
  opener.hidden = !saved;
  if (!saved)
    (menu as OpenMenu).open = false;
}

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
    reserveSoc: values.get("reserveSoc") ? Number(values.get("reserveSoc")) : null,
    batteryCharges: parseChargeList(values.get("batteryCharges")),
    decisions: parseSegmentList(values.get("decisions")),
    planChanges: parseChangeList(values.get("planChanges"), values.get("planSnapshots"))
  };
}

/* Stored charge windows. A missing line means this plan has no list yet. */
function parseChargeList(value: string | undefined): { from: string; to: string; kw: number }[] | undefined {
  if (value === undefined)
    return undefined;
  if (!value)
    return [];
  return value.split(",").flatMap((part) => {
    const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})@(\d+(?:\.\d+)?)$/.exec(part);
    if (!match)
      return [];
    return [{ from: match[1], to: match[2], kw: Number(match[3]) }];
  });
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
    sale
  ].join(". ") + ".";
}
/* One number card. The detail line holds the evidence for that number. */
function stat(card: LiveCard): string {
  const detail = card.detail ? `<em>${card.detail}</em>` : "";
  return `<div class="stat"><span>${card.label}</span><strong>${card.value}</strong>${detail}</div>`;
}

/* Write one group of cards into its grid. */
function fillStats(selector: string, cards: LiveCard[]): void {
  const root = document.querySelector(selector);
  if (root)
    root.innerHTML = cards.map((card) => stat(card)).join("");
}

/* Fill the day's money, the plan checks, and the forecast deviation. */
function renderScores(series: SeriesResponse, balanceDay: BalancePoint | null): void {
  const rate = document.querySelector("#day-rate");
  const deviation = document.querySelector("#forecast-deviation");
  if (!rate || !deviation)
    return;
  fillStats("#day-money", dayMoneyCards(balanceDay));
  rate.textContent = dayRateLine(balanceDay);
  fillStats("#day-checks", dayCheckCards(series.score, series.missing));
  if (!series.deviation) {
    deviation.textContent = "Forecast deviation: no pair has been recorded.";
    return;
  }
  const bands = series.deviation.byBand
    .map((band) => `${band.band} ${band.signedMeanKwh.toFixed(1)} / ${band.absoluteMeanKwh.toFixed(1)} kWh`)
    .join(", ");
  deviation.textContent = `Forecast deviation: signed mean ${series.deviation.signedMeanKwh.toFixed(1)} kWh, mean absolute ${series.deviation.absoluteMeanKwh.toFixed(1)} kWh over ${series.deviation.count} day(s). ${bands}`;
}

/* Fill the live plant, sun, and month cards. */
function renderLive(live: LiveResponse): void {
  const groups = liveGroups(live);
  fillStats("#live-now", groups.now);
  fillStats("#live-sun", groups.sun);
  fillStats("#live-month", groups.month);
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
  const button = document.querySelector("#recalculate-plan");
  if (button && "disabled" in button)
    (button as HTMLButtonElement).disabled = isLoading;
}

/* Ask how old the Miniserver's last plan pull is. A missing route leaves the banner hidden. */
async function refreshPlanPull(apiBase: string, apiKey: string): Promise<void> {
  const banner = document.querySelector("#loxone-pull");
  if (!(banner instanceof HTMLElement))
    return;
  try {
    renderPlanPull(banner, await loadJson<PlanPull>(apiBase, apiKey, "/api/energy/plan-pull"));
  } catch {
    banner.hidden = true;
  }
}

/* Load the live state and the selected day. */
async function loadDay(event?: Event): Promise<void> {
  event?.preventDefault();
  const status = document.querySelector("#status");
  const apiBase = fieldValue(document.querySelector("#api-base")).replace(/\/$/, "");
  const apiKey = fieldValue(document.querySelector("#api-key"));
  const day = fieldValue(document.querySelector("#day"));
  saveSettings(apiBase, apiKey);
  placeConnection();
  const menu = document.querySelector("#connection-menu");
  if (menu)
    (menu as OpenMenu).open = false;
  setPageLoading(true);
  if (status) {
    status.className = "status";
    status.textContent = "";
  }
  try {
    const todayName = pragueToday();
    const today = day === todayName;
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
    void refreshPlanPull(apiBase, apiKey);
    renderScores(series, balance.days.find((item) => item.date === day) ?? null);
    const hasReality = series.points.some((point) => point.pvKw !== null || point.meterKw !== null);
    renderDayLabel(day, hasReality);
    const recordedUntilMinute = today ? pragueMinutesNow() : null;
    renderPlanLine(plan, openingPlan, recordedUntilMinute);
    const bar = document.querySelector("#plan-bar");
    const changeList = document.querySelector("#plan-changes");
    const snapshot = document.querySelector("#plan-snapshot");
    const decisions = plan?.decisions ?? [];
    if (bar instanceof HTMLElement) {
      const future = day > todayName;
      renderPlanBar(bar, decisions, future ? "00:00" : today ? pragueClock() : null, today);
    }
    if (changeList instanceof HTMLElement && snapshot instanceof HTMLElement)
      renderChangeList(changeList, snapshot, plan?.planChanges ?? []);
    const rows = document.querySelector("#day-rows");
    if (rows)
      renderDayRows(rows as HTMLElement, {
        points: series.points.map((point) => ({ ...point, tankTemperatureC: point.tankTemperatureC ?? null })),
        plan,
        openingPlan,
        car,
        forecastKwh: today ? live.todayKwh : null,
        sunCover,
        recordedUntilMinute,
        decisions,
        now: today ? pragueClock() : null
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
const apiBase = document.querySelector("#api-base") as ValueField;
const apiKey = document.querySelector("#api-key") as ValueField;
const day = document.querySelector("#day") as ValueField;
apiBase.value = settings.apiBase;
apiKey.value = settings.apiKey;
day.value = pragueToday();
placeConnection();
document.querySelector("#recalculate-plan")?.addEventListener("click", () => {
  const note = document.querySelector("#plan-note");
  if (note)
    note.textContent = "";
  void loadDay().then(() => {
    const status = document.querySelector("#status");
    if (note && !status?.classList.contains("error"))
      note.textContent = "Plan refreshed. The Miniserver reads it within 10 minutes.";
  });
});
document.querySelector("#plan-changes-open")?.addEventListener("click", () => {
  const list = document.querySelector("#plan-changes");
  const opener = document.querySelector("#plan-changes-open");
  if (list instanceof HTMLElement && opener instanceof HTMLElement)
    toggleChangeList(list, opener);
});
document.querySelector("#connection")?.addEventListener("submit", (event) => void loadDay(event));
document.querySelector("#connection-open")?.addEventListener("click", () => {
  const menu = document.querySelector("#connection-menu");
  if (menu)
    (menu as OpenMenu).open = !(menu as OpenMenu).open;
});
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
setInterval(() => {
  const apiBase = fieldValue(document.querySelector("#api-base")).replace(/\/$/, "");
  const apiKey = fieldValue(document.querySelector("#api-key"));
  if (apiKey)
    void refreshPlanPull(apiBase, apiKey);
}, 30_000);
