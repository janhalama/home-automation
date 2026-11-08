/*
One day on a shared clock. Each row has its own axis.
Price and sun are what drive the plan. Then each job shows the plan and what happened.
*/

import { Chart, type ChartDataset } from "chart.js/auto";

export type RowPoint = {
  time: string;
  priceEurPerMwh: number | null;
  pvKw: number | null;
  meterKw: number | null;
  batteryKw: number | null;
  socPercent: number | null;
  heatingOn: boolean | null;
  tankTemperatureC: number | null;
};

export type RowPlan = {
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
};

export type CarQuarter = {
  time: string;
  chargeKw: number | null;
};

type RowSeries = {
  label: string;
  data: Array<number | null>;
  color: string;
  dashed?: boolean;
  spanGaps?: boolean;
  signed?: boolean;
};

const charts: Chart[] = [];

/* Quarter labels from 00:00 through 24:00. The last label closes the 23:45 quarter. */
function axis(): string[] {
  return Array.from({ length: 97 }, (_, index) => {
    const total = index * 15;
    const hour = String(Math.floor(total / 60)).padStart(2, "0");
    const minute = String(total % 60).padStart(2, "0");
    return `${hour}:${minute}`;
  });
}

/* Copy the 23:45 value out to midnight so that quarter has a segment. */
function throughMidnight(values: Array<number | null>): Array<number | null> {
  return [...values, values.at(-1) ?? null];
}

/* Repeat the last known value one quarter ahead so that step has width. */
function holdOneMore(values: Array<number | null>): Array<number | null> {
  const next = values.slice();
  const last = next.findLastIndex((value) => value !== null);
  if (last >= 0 && last + 1 < next.length && next[last + 1] === null)
    next[last + 1] = next[last];
  return next;
}

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* The quarter label a clock belongs to. */
function quarter(clock: string): string {
  const snapped = Math.floor(minutes(clock) / 15) * 15;
  const hour = String(Math.floor(snapped / 60)).padStart(2, "0");
  const minute = String(snapped % 60).padStart(2, "0");
  return `${hour}:${minute}`;
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

/* Last point that falls in each quarter. */
function indexByQuarter<T extends { time: string }>(points: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const point of points)
    map.set(quarter(point.time), point);
  return map;
}

/* Plan value during the slot, zero outside it, empty when the plan has no hours. */
function slotLine(labels: string[], from: string | null, to: string | null, value: number): Array<number | null> {
  if (!from || !to)
    return labels.map(() => null);
  return labels.map((time) => inSlot(time, from, to) ? value : 0);
}

/* One titled row and its chart. */
function addRow(host: HTMLElement, title: string, labels: string[], unit: string, series: RowSeries[], min?: number, max?: number): void {
  const section = document.createElement("section");
  section.className = "day-row";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const wrap = document.createElement("div");
  wrap.className = "day-row-chart";
  const canvas = document.createElement("canvas");
  wrap.append(canvas);
  section.append(heading, wrap);
  host.append(section);
  charts.push(new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: series.map((item): ChartDataset<"line"> => ({
        label: item.label,
        data: item.data,
        borderColor: item.color,
        backgroundColor: item.color,
        borderDash: item.dashed ? [4, 4] : undefined,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        spanGaps: item.spanGaps ?? false,
        stepped: "after",
        fill: item.signed ? { target: "origin", above: "rgba(56, 106, 32, 0.35)", below: "rgba(179, 38, 30, 0.35)" } : false,
        segment: item.signed ? {
          borderColor: (context) => {
            const start = context.p0.parsed.y;
            const end = context.p1.parsed.y;
            if (start === null || end === null)
              return item.color;
            if (start < 0 && end <= 0)
              return "#b3261e";
            if (start > 0 && end >= 0)
              return "#386a20";
            return item.color;
          }
        } : undefined
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: series.length > 1, position: "bottom" } },
      scales: {
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            callback(value) {
              const label = labels[Number(value)] ?? "";
              const [hour, minute] = label.split(":");
              if (minute !== "00" || Number(hour) % 3 !== 0)
                return "";
              return label;
            }
          }
        },
        y: { min, max, title: { display: true, text: unit } }
      }
    }
  }));
}

/* Draw the day. Calling it again replaces the previous rows. */
export function renderDayRows(host: HTMLElement, input: {
  points: RowPoint[];
  plan: RowPlan | null;
  car: CarQuarter[];
  forecastKwh: number | null;
  recordedUntilMinute: number | null;
}): void {
  charts.forEach((chart) => chart.destroy());
  charts.length = 0;
  host.replaceChildren();
  const labels = axis();
  const quarters = labels.slice(0, -1);
  const energy = indexByQuarter(input.points);
  const car = indexByQuarter(input.car);
  const plan = input.plan;
  const recordedUntil = input.recordedUntilMinute;

  let cumulative = 0;
  const madeKwh = throughMidnight(quarters.map((time) => {
    const made = energy.get(time)?.pvKw;
    if (made === null || made === undefined)
      return null;
    cumulative += Math.max(0, made) * 0.25;
    return cumulative;
  }));
  const temperature = throughMidnight(quarters.map((time) => energy.get(time)?.tankTemperatureC ?? null));
  const heater = throughMidnight(quarters.map((time) => {
    const on = energy.get(time)?.heatingOn;
    if (on === null || on === undefined)
      return null;
    return on ? 1 : 0;
  }));
  const grid = throughMidnight(quarters.map((time) => energy.get(time)?.meterKw ?? null));
  const charging = throughMidnight(holdOneMore(quarters.map((time) => {
    const point = car.get(time);
    if (!point)
      return null;
    if (recordedUntil !== null && minutes(time) > recordedUntil)
      return null;
    return point.chargeKw ?? 0;
  })));
  const batteryPlan = throughMidnight(quarters.map((time) => {
    if (!plan)
      return null;
    if (inSlot(time, plan.batteryFrom, plan.batteryTo))
      return -plan.batteryKw;
    if (inSlot(time, plan.batterySellFrom, plan.batterySellTo))
      return plan.batterySellKw;
    if (!plan.batteryFrom && !plan.batterySellFrom)
      return null;
    return 0;
  }));
  const carTitle = plan?.car === "battery"
    ? `Obluda plan, ${plan.carKw.toFixed(0)} kW from the battery${plan.carFrom && plan.carTo ? ` ${plan.carFrom}–${plan.carTo}` : ""}`
    : plan?.car === "surplus"
      ? "Obluda plan, leftover sun"
      : plan?.carFrom && plan.carTo
        ? `Obluda plan ${plan.carFrom}–${plan.carTo}`
        : "Obluda plan off";
  const batterySale = plan?.batterySellFrom ? `sale ${plan.batterySellFrom}–${plan.batterySellTo}` : null;
  const batteryCharge = plan?.batteryFrom ? `charge ${plan.batteryFrom}–${plan.batteryTo}` : null;
  const batteryTitle = batterySale && batteryCharge
    ? `Battery plan, ${batterySale}, ${batteryCharge}`
    : batterySale
      ? `Battery plan, ${batterySale}`
      : batteryCharge
        ? `Battery plan, ${batteryCharge}`
        : "Battery plan off";

  const tankTitle = plan?.tankFrom && plan.tankTo
    ? `Planned heating ${plan.tankFrom}–${plan.tankTo}`
    : "No heating planned";

  addRow(host, "Price", labels, "EUR/MWh", [
    { label: "Price", data: throughMidnight(quarters.map((time) => energy.get(time)?.priceEurPerMwh ?? null)), color: "#6750a4" }
  ]);
  addRow(host, "Sun", labels, "kWh", [
    { label: "Made", data: madeKwh, color: "#386a20", spanGaps: true },
    ...(input.forecastKwh === null ? [] : [{ label: "Forecast", data: labels.map(() => input.forecastKwh), color: "#386a20", dashed: true }])
  ]);
  addRow(host, "Grid · red below zero is import", labels, "kW", [
    { label: "Grid", data: grid, color: "#49454f", signed: true }
  ]);
  addRow(host, "Tank temperature", labels, "°C", [
    { label: "Temperature", data: temperature, color: "#b3261e", spanGaps: true },
    { label: "55°C", data: labels.map(() => 55), color: "#b3261e", dashed: true },
    { label: "40°C", data: labels.map(() => 40), color: "#8a5a00", dashed: true }
  ]);
  addRow(host, tankTitle, labels, "on", [
    { label: "Plan", data: throughMidnight(slotLine(quarters, plan?.tankFrom ?? null, plan?.tankTo ?? null, 1)), color: "#b3261e" }
  ], 0, 1);
  addRow(host, "Heater relay", labels, "on", [
    { label: "Relay", data: heater, color: "#8a5a00" }
  ], 0, 1);
  addRow(host, carTitle, labels, "kW", [
    { label: "Plan", data: throughMidnight(slotLine(quarters, plan?.carFrom ?? null, plan?.carTo ?? null, plan?.carKw ?? 0)), color: "#006a6a" }
  ]);
  addRow(host, "Obluda charging", labels, "kW", [
    { label: "Charging", data: charging, color: "#006a6a" }
  ]);
  addRow(host, batteryTitle, labels, "kW", [
    { label: "Plan", data: batteryPlan, color: "#7d5260" }
  ]);
  addRow(host, "Battery power", labels, "kW", [
    { label: "Battery", data: throughMidnight(quarters.map((time) => energy.get(time)?.batteryKw ?? null)), color: "#7d5260" }
  ]);
  addRow(host, "House battery", labels, "%", [
    { label: "State of charge", data: throughMidnight(quarters.map((time) => energy.get(time)?.socPercent ?? null)), color: "#1d192b", spanGaps: true },
    { label: "50%", data: labels.map(() => 50), color: "#8a5a00", dashed: true },
    { label: "20% floor", data: labels.map(() => 20), color: "#b3261e", dashed: true }
  ], 0, 100);
}
