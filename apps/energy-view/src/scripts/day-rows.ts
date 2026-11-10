/*
One day on a shared clock. Each row has its own axis.
Price and sun are what drive the plan. Then each job shows the plan and what happened.
*/

import { Chart, type ChartDataset } from "chart.js/auto";
import { batteryPlanKw, batteryPlanTitle } from "./battery-plan-series.ts";

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
  reserveSoc: number | null;
};

export type SunCoverPoint = {
  time: string;
  pvKw: number;
  houseKw: number;
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
  trade?: boolean;
};

const BUY = "#386a20";
const SELL = "#b3261e";
const BUY_FILL = "rgba(56, 106, 32, 0.35)";
const SELL_FILL = "rgba(179, 38, 30, 0.35)";

/* Green on a buy, red on a sale. The grid row keeps red for import. */
function tradeStroke(item: RowSeries, start: number, end: number): string {
  const buying = item.trade ? BUY : SELL;
  const selling = item.trade ? SELL : BUY;
  if (start < 0 && end <= 0)
    return buying;
  if (start > 0 && end >= 0)
    return selling;
  return item.color;
}

const charts: Chart[] = [];
const CZK_PER_EUR = 25;
const SALE_GAP_CZK = 3;

/* Quarter labels from 00:00 through 24:00. The last label closes the 23:45 quarter. */
function axis(): string[] {
  return Array.from({ length: 97 }, (_, index) => {
    const total = index * 15;
    const hour = String(Math.floor(total / 60)).padStart(2, "0");
    const minute = String(total % 60).padStart(2, "0");
    return `${hour}:${minute}`;
  });
}

/* Day's low, high, and the Kč gap a sale needs. A sale wants at least 3 Kč/kWh. */
function priceSpread(prices: Array<number | null>): { low: number; high: number; gapCzk: number } | null {
  const known = prices.filter((price): price is number => price !== null);
  if (known.length === 0)
    return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  return { low, high, gapCzk: (high - low) * CZK_PER_EUR / 1000 };
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

/* A slot that finishes before now is tomorrow morning, so it is not drawn on the rest of today. */
function slotIsAhead(from: string, to: string, recordedUntil: number): boolean {
  const start = minutes(from);
  const end = minutes(to);
  if (end <= start)
    return true;
  return end > recordedUntil;
}

/* Tank plan the row titles. A passed window stays the morning one. */
function tankPlanForChart(live: RowPlan | null, opening: RowPlan | null, recordedUntil: number | null): RowPlan | null {
  if (recordedUntil === null)
    return opening ?? live;
  if (live?.tankFrom && live.tankTo && slotIsAhead(live.tankFrom, live.tankTo, recordedUntil))
    return live;
  return opening ?? live;
}

/* 1 while this quarter is in the tank plan that belongs on this part of the day. */
function tankPlanOn(
  time: string,
  live: RowPlan | null,
  opening: RowPlan | null,
  recordedUntil: number | null
): number | null {
  const past = recordedUntil !== null && minutes(time) < recordedUntil;
  const source = past ? (opening ?? live) : tankPlanForChart(live, opening, recordedUntil);
  if (!source?.tankFrom || !source.tankTo)
    return null;
  if (!past && recordedUntil !== null && !slotIsAhead(source.tankFrom, source.tankTo, recordedUntil))
    return 0;
  return inSlot(time, source.tankFrom, source.tankTo) ? 1 : 0;
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
        fill: item.signed || item.trade
          ? {
              target: "origin",
              above: item.trade ? SELL_FILL : BUY_FILL,
              below: item.trade ? BUY_FILL : SELL_FILL
            }
          : false,
        segment: item.signed || item.trade ? {
          borderColor: (context) => {
            const start = context.p0.parsed.y;
            const end = context.p1.parsed.y;
            if (start === null || end === null)
              return item.color;
            return tradeStroke(item, start, end);
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
  openingPlan: RowPlan | null;
  car: CarQuarter[];
  forecastKwh: number | null;
  sunCover: { from: string | null; to: string | null; points: SunCoverPoint[] } | null;
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
  const opening = input.openingPlan;
  const batteryPlan = throughMidnight(quarters.map((time) =>
    batteryPlanKw(time, plan, opening, recordedUntil)
  ));
  const reserve = plan?.reserveSoc ?? null;
  const carTitle = plan?.car === "battery"
    ? `Obluda plan, ${plan.carKw.toFixed(0)} kW from the battery${reserve === null ? "" : ` down to ${reserve.toFixed(0)}%`}${plan.carFrom && plan.carTo ? ` ${plan.carFrom}–${plan.carTo}` : ""}`
    : plan?.car === "surplus"
      ? "Obluda plan, leftover sun"
      : plan?.carFrom && plan.carTo
        ? `Obluda plan ${plan.carFrom}–${plan.carTo}`
        : "Obluda plan off";
  const batteryTitle = batteryPlanTitle(plan, opening, recordedUntil);

  const tankSource = tankPlanForChart(plan, opening, recordedUntil);
  const tankTitle = tankSource?.tankFrom && tankSource.tankTo
    ? `Planned heating ${tankSource.tankFrom}–${tankSource.tankTo}`
    : "No heating planned";

  const price = throughMidnight(quarters.map((time) => energy.get(time)?.priceEurPerMwh ?? null));
  const spread = priceSpread(price);
  const priceTitle = spread
    ? `Price ${Math.round(spread.low)}–${Math.round(spread.high)} EUR/MWh, gap ${spread.gapCzk.toFixed(1)} Kč/kWh, ${spread.gapCzk >= SALE_GAP_CZK ? "sale allowed" : "sale not allowed"}`
    : "Price";
  addRow(host, priceTitle, labels, "EUR/MWh", [
    { label: "Price", data: price, color: "#6750a4" },
    ...(spread ? [
      { label: "High", data: labels.map(() => spread.high), color: "#6750a4", dashed: true },
      { label: "Low", data: labels.map(() => spread.low), color: "#8a5a00", dashed: true }
    ] : [])
  ]);
  addRow(host, "Sun", labels, "kWh", [
    { label: "Made", data: madeKwh, color: "#386a20", spanGaps: true },
    ...(input.forecastKwh === null ? [] : [{ label: "Forecast", data: labels.map(() => input.forecastKwh), color: "#386a20", dashed: true }])
  ]);
  const cover = input.sunCover;
  const coverTitle = cover?.from && cover.to
    ? `Sun covers the house ${cover.from}–${cover.to}`
    : "Sun stays under the house";
  const byHour = new Map((cover?.points ?? []).map((point) => [point.time.slice(0, 2), point]));
  const coverValue = (pick: (point: SunCoverPoint) => number) => throughMidnight(quarters.map((time) => {
    const point = byHour.get(time.slice(0, 2));
    return point ? pick(point) : null;
  }));
  addRow(host, coverTitle, labels, "kW", [
    { label: "Forecast", data: coverValue((point) => point.pvKw), color: "#386a20", spanGaps: false },
    { label: "House", data: coverValue((point) => point.houseKw), color: "#8a5a00", spanGaps: false }
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
    {
      label: "Plan",
      data: throughMidnight(quarters.map((time) => tankPlanOn(time, plan, opening, recordedUntil))),
      color: "#b3261e"
    }
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
  addRow(host, `${batteryTitle}. Green is a buy, red is a sale`, labels, "kW", [
    { label: "Plan", data: batteryPlan, color: "#7d5260", trade: true }
  ]);
  addRow(host, "Battery power. Green is charge, red is discharge", labels, "kW", [
    { label: "Battery", data: throughMidnight(quarters.map((time) => energy.get(time)?.batteryKw ?? null)), color: "#7d5260", trade: true }
  ]);
  addRow(host, "House battery", labels, "%", [
    { label: "State of charge", data: throughMidnight(quarters.map((time) => energy.get(time)?.socPercent ?? null)), color: "#1d192b", spanGaps: true },
    ...(reserve === null ? [] : [{ label: `${reserve.toFixed(0)}% reserve`, data: labels.map(() => reserve), color: "#8a5a00", dashed: true }]),
    { label: "20% floor", data: labels.map(() => 20), color: "#b3261e", dashed: true }
  ], 0, 100);
}
