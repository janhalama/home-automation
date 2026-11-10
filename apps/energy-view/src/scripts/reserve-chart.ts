/*
The last 30 days of the house reserve, the line that used to sit at 50%.
*/

import { Chart } from "chart.js/auto";

export type ReservePoint = {
  date: string;
  reserveSoc: number;
};

let chart: Chart | null = null;

/* Draw the reserve. Calling it again replaces the previous line. */
export function renderReserveHistory(canvas: HTMLCanvasElement, days: ReservePoint[]): void {
  chart?.destroy();
  const labels = days.map((day) => {
    const [, month, date] = day.date.split("-");
    return `${Number(date)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]}`;
  });
  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Reserve",
          data: days.map((day) => day.reserveSoc),
          borderColor: "#8a5a00",
          backgroundColor: "#8a5a00",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          stepped: "before"
        },
        {
          label: "50%",
          data: days.map(() => 50),
          borderColor: "#79747e",
          backgroundColor: "#79747e",
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: true, position: "bottom" } },
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: "%" } }
      }
    }
  });
  canvas.classList.add("drawn");
}
