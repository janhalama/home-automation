/*
The car chart: wallbox charging, state of charge, the plug, and the plan.
*/

import { Chart, type ChartDataset } from "chart.js/auto";

type CarPoint = {
  time: string;
  chargeKw: number | null;
  socPercent: number | null;
  chargeLimitPercent: number | null;
  pluggedIn: boolean;
};

type CarPlan = {
  carFrom: string | null;
  carTo: string | null;
  carKw: number;
} | null;

type CarDayResponse = {
  configured: boolean;
  points: CarPoint[];
  chargeLimitPercent?: number | null;
};

let chart: Chart | null = null;

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
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
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/* A quarter that has not started. A finished day has no open hours. */
function isAhead(day: string, time: string): boolean {
  if (day !== pragueToday())
    return false;
  return minutes(time) > pragueMinutesNow();
}

/* Carry the last known level into later quarters, and leave the rest of today empty. */
function holdUntilNow(day: string, points: CarPoint[], read: (point: CarPoint) => number | null): Array<number | null> {
  let held: number | null = null;
  return points.map((point) => {
    if (isAhead(day, point.time))
      return null;
    const next = read(point);
    if (next !== null)
      held = next;
    return held;
  });
}

/* True when this quarter sits inside the plan. A slot that passes midnight includes both ends. */
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

/* Quarters for a day that has no car history, so the plan still has an axis. */
function emptyDay(): CarPoint[] {
  return Array.from({ length: 96 }, (_, index) => {
    const total = index * 15;
    const hour = String(Math.floor(total / 60)).padStart(2, "0");
    const minute = String(total % 60).padStart(2, "0");
    return { time: `${hour}:${minute}:00`, chargeKw: null, socPercent: null, chargeLimitPercent: null, pluggedIn: false };
  });
}

/* Draw the car chart and the sentence under it. */
function renderCarChart(points: CarPoint[], plan: CarPlan, configured: boolean, chargeLimitPercent: number | null, day: string): void {
  const note = document.querySelector("#car-note");
  const canvas = document.querySelector("#car-chart") as HTMLCanvasElement | null;
  if (note)
    note.textContent = configured
      ? "Obluda, the Tesla Model Y. Charging is power from the wallbox into the car. State of charge is the usable level, kept from the last reading. Charge limit is the level set now. The step is the cable, kept until the next drive. The limit and the cable stop at the present hour. The dashed power line is the plan."
      : "Obluda's history was not read. The dashed line is still the plan.";
  if (!canvas)
    return;
  chart?.destroy();
  const labels = points.map((point) => point.time.slice(0, 5));
  const line = (label: string, data: Array<number | null>, color: string, extra: Partial<ChartDataset> = {}) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    tension: 0,
    spanGaps: false,
    ...extra
  });
  const planKw = plan && plan.carFrom && plan.carTo && plan.carKw !== 0
    ? line("Plan", points.map((point) => inSlot(point.time, plan.carFrom, plan.carTo) ? plan.carKw : null), "#1d192b", {
      borderDash: [8, 4],
      stepped: true
    })
    : null;
  const limits = points.map((point) => isAhead(day, point.time) ? null : point.chargeLimitPercent ?? chargeLimitPercent);
  const limitLine = limits.some((value) => value !== null)
    ? line("Charge limit", limits, "#b3261e", {
      yAxisID: "y1",
      borderDash: [4, 4]
    })
    : null;
  const chargeKw = points.map((point) => {
    if (!configured)
      return point.chargeKw;
    if (isAhead(day, point.time))
      return null;
    return point.chargeKw ?? 0;
  });
  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        line("Charging", chargeKw, "#006a6a", { stepped: true }),
        line("State of charge", holdUntilNow(day, points, (point) => point.socPercent), "#7d5260", {
          yAxisID: "y1",
          stepped: true
        }),
        ...(limitLine ? [limitLine] : []),
        line("Plugged in", points.map((point) => isAhead(day, point.time) ? null : point.pluggedIn ? 1 : 0), "#6750a4", {
          yAxisID: "y2",
          stepped: true,
          borderWidth: 2
        }),
        ...(planKw ? [planKw] : [])
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { position: "left", title: { display: true, text: "Charge kW" } },
        y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: "%" } },
        y2: {
          position: "right",
          min: 0,
          max: 1,
          offset: true,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 1 },
          title: { display: true, text: "Plugged" }
        }
      }
    }
  });
}

/* Load the car day. A failure still draws the plan. */
export async function loadCarChart(apiBase: string, apiKey: string, day: string, plan: CarPlan): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/api/energy/car?date=${day}`, {
      headers: { "X-API-Key": apiKey }
    });
    if (!response.ok)
      throw new Error("The car history was not read.");
    const body = await response.json() as CarDayResponse;
    const points = body.points.length > 0 ? body.points : emptyDay();
    renderCarChart(points, plan, body.configured && body.points.length > 0, body.chargeLimitPercent ?? null, day);
  } catch {
    renderCarChart(emptyDay(), plan, false, null, day);
  }
}
