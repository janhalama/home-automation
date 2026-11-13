/*
The last 30 days of grid money.
Import stacks above zero. Export hangs below zero.
*/

import { Chart } from "chart.js/auto";

export type BalancePoint = {
  date: string;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SLICES = [
  { label: "House", key: "houseCzk", color: "#8a5a00" },
  { label: "Battery", key: "batteryCzk", color: "#386a20" },
  { label: "Car", key: "carCzk", color: "#006a6a" },
  { label: "Tank", key: "tankCzk", color: "#c45c26" }
] as const;

let chart: Chart | null = null;

/* Draw the stacked import and the export bar. Calling it again replaces the previous chart. */
export function renderBalanceHistory(canvas: HTMLCanvasElement, days: BalancePoint[]): void {
  chart?.destroy();
  const labels = days.map((day) => {
    const [, month, date] = day.date.split("-");
    return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
  });
  chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        ...SLICES.map((slice) => ({
          label: slice.label,
          data: days.map((day) => day[slice.key] ?? null),
          backgroundColor: slice.color,
          stack: "import",
          borderWidth: 0
        })),
        {
          label: "Export",
          data: days.map((day) => day.exportCzk == null ? null : -day.exportCzk),
          backgroundColor: "#49454f",
          stack: "import",
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true, position: "bottom" },
        tooltip: {
          callbacks: {
            label(item) {
              const value = item.parsed.y;
              if (value === null || value === undefined)
                return "";
              return `${item.dataset.label}: ${Math.abs(value).toFixed(0)} Kč`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, title: { display: true, text: "Kč" } }
      }
    }
  });
  canvas.classList.add("drawn");
}
