/*
The car chart: wallbox charging, state of charge, the plug, and the plan.
*/

import { Chart, type ChartDataset } from "chart.js/auto";

type CarPoint = {
  time: string;
  chargeKw: number | null;
  socPercent: number | null;
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
};

let chart: Chart | null = null;

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
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
    return { time: `${hour}:${minute}:00`, chargeKw: null, socPercent: null, pluggedIn: false };
  });
}

/* Draw the car chart and the sentence under it. */
function renderCarChart(points: CarPoint[], plan: CarPlan, configured: boolean): void {
  const note = document.querySelector("#car-note");
  const canvas = document.querySelector("#car-chart") as HTMLCanvasElement | null;
  if (note)
    note.textContent = configured
      ? "Obluda, the Tesla Model Y. Charging is power from the wallbox into the car. The other line is the usable state of charge. The step is plugged in. The dashed line is the plan."
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
  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        line("Charging", points.map((point) => point.chargeKw), "#006a6a", { stepped: true }),
        line("State of charge", points.map((point) => point.socPercent), "#7d5260", {
          yAxisID: "y1",
          spanGaps: true
        }),
        line("Plugged in", points.map((point) => point.pluggedIn ? 1 : 0), "#6750a4", {
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
    renderCarChart(points, plan, body.configured && body.points.length > 0);
  } catch {
    renderCarChart(emptyDay(), plan, false);
  }
}
