/*
One day on a shared clock. Spot price, grid, then one sun chart with the prediction and the production.
Then each job shows the plan and what happened. Tank temperature follows.
Today draws a thin red line at the current minute, with the time above it.
*/

import { Chart, type ChartDataset } from "chart.js/auto";
import { batteryFlowParts, batteryPlanSeries, carPlanSeries, heaterSeries, tankPlanSeries, type StoredSegment } from "./stored-plan-series.ts";

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
  batteryDischargeFrom: string | null;
  batteryDischargeTo: string | null;
  batteryDischargeKw: number;
  reserveSoc: number | null;
  batteryCharges?: { from: string; to: string; kw: number }[];
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
  fill?: boolean;
  hatched?: boolean;
  stack?: string;
};

const BUY = "#386a20";
const HOUSE = "#8a5a00";
const SELL = "#b3261e";
const BUY_FILL = "rgba(56, 106, 32, 0.35)";
const HOUSE_FILL = "rgba(138, 90, 0, 0.35)";
const SELL_FILL = "rgba(179, 38, 30, 0.35)";

/* Diagonal hatch for a plan row. Measured rows stay solid. */
function hatchPattern(color: string): CanvasPattern | string {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d");
  if (!context)
    return color;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 8);
  context.lineTo(8, 0);
  context.stroke();
  return context.createPattern(canvas, "repeat") ?? color;
}

/* Translucent fill for a series that stays on one side of zero. */
function fillColor(color: string): string {
  if (color === BUY)
    return BUY_FILL;
  if (color === HOUSE)
    return HOUSE_FILL;
  if (color === SELL)
    return SELL_FILL;
  return color;
}

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
const NOW = "#b3261e";
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

/* Last point that falls in each quarter. */
function indexByQuarter<T extends { time: string }>(points: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const point of points)
    map.set(quarter(point.time), point);
  return map;
}

/* Stack name for this series. A stacked row puts every series in one stack. */
function seriesStack(item: RowSeries, stacked: boolean): string | undefined {
  return item.stack ?? (stacked ? "row" : undefined);
}

/* Where this filled series meets the one under it. The first series in a stack meets zero. */
function areaTarget(series: RowSeries[], index: number, stacked: boolean): "origin" | number {
  const stack = seriesStack(series[index], stacked);
  if (!stack)
    return "origin";
  for (let previous = index - 1; previous >= 0; previous--)
    if (seriesStack(series[previous], stacked) === stack)
      return previous;
  return "origin";
}

/* Pixel of a minute on the quarter axis. 00:00 is the first tick and 24:00 is the last. */
function xForMinute(scale: { getPixelForTick(index: number): number }, at: number): number {
  const slot = at / 15;
  const lower = Math.min(96, Math.floor(slot));
  const upper = Math.min(96, lower + 1);
  const start = scale.getPixelForTick(lower);
  const end = scale.getPixelForTick(upper);
  return start + (end - start) * (slot - lower);
}

/* Thin red line at the current minute, with the time above it. Past and future days draw none. */
function nowLine(now: string | null) {
  return {
    id: "nowLine",
    afterDraw(chart: Chart) {
      if (now === null)
        return;
      const scale = chart.scales.x;
      const area = chart.chartArea;
      if (!scale || !area)
        return;
      const x = xForMinute(scale, minutes(now));
      const context = chart.ctx;
      context.save();
      context.strokeStyle = NOW;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x, area.top);
      context.lineTo(x, area.bottom);
      context.stroke();
      context.fillStyle = NOW;
      context.font = "11px sans-serif";
      context.textBaseline = "bottom";
      context.textAlign = x > area.right - 24 ? "right" : x < area.left + 24 ? "left" : "center";
      context.fillText(now, x, area.top - 2);
      context.restore();
    }
  };
}

/* One titled row and its chart. */
function addRow(host: HTMLElement, title: string, labels: string[], unit: string, series: RowSeries[], now: string | null, min?: number, max?: number, stacked = false): void {
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
  const scaleStacks = stacked ? true : series.some((item) => item.stack) ? undefined : false;
  charts.push(new Chart(canvas, {
    type: "line",
    plugins: [nowLine(now)],
    data: {
      labels,
      datasets: series.map((item, index): ChartDataset<"line"> => ({
        label: item.label,
        data: item.data,
        borderColor: item.color,
        backgroundColor: item.hatched ? hatchPattern(item.color) : item.fill ? fillColor(item.color) : item.color,
        borderDash: item.dashed || item.hatched ? [4, 4] : undefined,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        spanGaps: item.spanGaps ?? false,
        stepped: "after",
        stack: seriesStack(item, stacked),
        fill: item.fill
          ? { target: areaTarget(series, index, stacked) }
          : item.signed || item.trade
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
      layout: { padding: { top: now === null ? 0 : 14 } },
      plugins: {
        legend: { display: series.length > 1, position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              const raw = context.raw;
              const value = typeof raw === "number" ? raw : context.parsed.y;
              return `${context.dataset.label}: ${value}`;
            }
          }
        }
      },
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
        y: {
          afterFit(scale) {
            scale.width = 72;
          },
          stacked: scaleStacks,
          min,
          max,
          title: { display: true, text: unit }
        }
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
  decisions: StoredSegment[];
  now: string | null;
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
  const temperature = throughMidnight(quarters.map((time) => energy.get(time)?.tankTemperatureC ?? null));
  const heaterQuarters = quarters.map((time) => {
    const on = energy.get(time)?.heatingOn;
    if (on === null || on === undefined)
      return null;
    return on ? 1 : 0;
  });
  const grid = throughMidnight(quarters.map((time) => energy.get(time)?.meterKw ?? null));
  const charging = throughMidnight(holdOneMore(quarters.map((time) => {
    const point = car.get(time);
    if (!point)
      return null;
    if (recordedUntil !== null && minutes(time) > recordedUntil)
      return null;
    return point.chargeKw ?? 0;
  })));
  const segments = input.decisions;
  const heaterSplit = heaterSeries(quarters, heaterQuarters, segments);
  const tankPlan = throughMidnight(tankPlanSeries(quarters, segments));
  const carPlan = throughMidnight(carPlanSeries(quarters, segments));
  const storedBattery = batteryPlanSeries(quarters, segments);
  const batteryFlow = quarters.map((time) => {
    const point = energy.get(time);
    return batteryFlowParts(point?.batteryKw ?? null, point?.meterKw ?? null);
  });
  const reserve = plan?.reserveSoc ?? null;
  const heatingTitle = heaterSplit.houseActed ? "Tank heating. The house heated then." : "Tank heating";
  const heatingSeries: RowSeries[] = [
    { label: "With the plan", data: throughMidnight(heaterSplit.plan), color: "#b3261e" }
  ];
  if (heaterSplit.houseActed)
    heatingSeries.push({ label: "House", data: throughMidnight(heaterSplit.house), color: HOUSE });

  const price = throughMidnight(quarters.map((time) => energy.get(time)?.priceEurPerMwh ?? null));
  const spread = priceSpread(price);
  const priceTitle = spread
    ? `Spot price ${Math.round(spread.low)}–${Math.round(spread.high)} EUR/MWh, gap ${spread.gapCzk.toFixed(1)} Kč/kWh, ${spread.gapCzk >= SALE_GAP_CZK ? "sale allowed" : "sale not allowed"}`
    : "Spot price";
  const now = input.now;
  addRow(host, priceTitle, labels, "EUR/MWh", [
    { label: "Spot price", data: price, color: "#6750a4" },
    ...(spread ? [
      { label: "High", data: labels.map(() => spread.high), color: "#6750a4", dashed: true },
      { label: "Low", data: labels.map(() => spread.low), color: "#8a5a00", dashed: true }
    ] : [])
  ], now);
  addRow(host, "Grid. Red below zero is import", labels, "kW", [
    { label: "Grid", data: grid, color: "#49454f", signed: true }
  ], now);
  const sunByHour = new Map((input.sunCover?.points ?? []).map((point) => [point.time.slice(0, 2), point]));
  const sunAt = (time: string) => sunByHour.get(time.slice(0, 2));
  addRow(host, "Sun. Solid is production, dashed is the prediction", labels, "kW", [
    {
      label: "Production",
      data: throughMidnight(quarters.map((time) => {
        if (recordedUntil !== null && minutes(time) > recordedUntil)
          return null;
        const made = energy.get(time)?.pvKw;
        return made === null || made === undefined ? null : made;
      })),
      color: "#386a20",
      spanGaps: true
    },
    {
      label: "Prediction",
      data: throughMidnight(quarters.map((time) => sunAt(time)?.pvKw ?? null)),
      color: "#386a20",
      dashed: true,
      spanGaps: true
    }
  ], now);
  addRow(host, "Tank plan", labels, "kW", [
    { label: "Plan", data: tankPlan, color: HOUSE, hatched: true, fill: true }
  ], now);
  addRow(host, heatingTitle, labels, "on", heatingSeries, now, 0, 1);
  addRow(host, "Car plan", labels, "kW", [
    { label: "Plan", data: carPlan, color: "#006a6a", hatched: true, fill: true }
  ], now, 0, 12);
  addRow(host, "Car charging", labels, "kW", [
    { label: "Charging", data: charging, color: "#006a6a" }
  ], now);
  addRow(host, "Battery plan. Green below zero is a buy, red above zero is a sale", labels, "kW", [
    { label: "Buy", data: throughMidnight(storedBattery.buy), color: BUY, hatched: true, fill: true },
    { label: "Sale", data: throughMidnight(storedBattery.sale), color: SELL, hatched: true, fill: true }
  ], now);
  addRow(host, "Battery power. Green below zero is a buy, orange above zero is the house, red above zero is a sale", labels, "kW", [
    { label: "Buy", data: throughMidnight(batteryFlow.map((part) => part.buy)), color: BUY, fill: true },
    { label: "House", data: throughMidnight(batteryFlow.map((part) => part.house)), color: HOUSE, fill: true },
    { label: "Sale", data: throughMidnight(batteryFlow.map((part) => part.sale)), color: SELL, fill: true }
  ], now);
  addRow(host, "House battery", labels, "%", [
    { label: "State of charge", data: throughMidnight(quarters.map((time) => energy.get(time)?.socPercent ?? null)), color: "#1d192b", spanGaps: true },
    ...(reserve === null ? [] : [{ label: `${reserve.toFixed(0)}% reserve`, data: labels.map(() => reserve), color: "#8a5a00", dashed: true }]),
    { label: "20% floor", data: labels.map(() => 20), color: "#b3261e", dashed: true }
  ], now, 0, 100);
  const cover = input.sunCover;
  const coverTitle = cover?.from && cover.to
    ? `Sun covers the house ${cover.from}–${cover.to}`
    : "Sun stays under the house";
  const coverValue = (pick: (point: SunCoverPoint) => number) => throughMidnight(quarters.map((time) => {
    const point = sunAt(time);
    return point ? pick(point) : null;
  }));
  addRow(host, coverTitle, labels, "kW", [
    { label: "Forecast", data: coverValue((point) => point.pvKw), color: "#386a20", spanGaps: false },
    { label: "House", data: coverValue((point) => point.houseKw), color: "#8a5a00", spanGaps: false }
  ], now);
  addRow(host, "Tank temperature", labels, "°C", [
    { label: "Temperature", data: temperature, color: "#b3261e", spanGaps: true },
    { label: "55°C", data: labels.map(() => 55), color: "#b3261e", dashed: true },
    { label: "40°C", data: labels.map(() => 40), color: "#8a5a00", dashed: true }
  ], now);
}
