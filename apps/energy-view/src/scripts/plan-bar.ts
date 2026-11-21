/*
The three lanes for one day, and the line that opens the plan as it stood.
Solid means that hour had already started. Hatch means it was still ahead.
*/

import type { StoredSegment } from "./stored-plan-series.ts";

export type { StoredSegment } from "./stored-plan-series.ts";

export type BarBlock = {
  lane: "Tank" | "Car" | "Battery";
  from: string;
  to: string;
  paint: "tank" | "car" | "buy" | "sell" | "wait" | "house";
  ahead: boolean;
  label: string;
};

export type ChangeLine = {
  at: string;
  trigger: string;
  result: string;
  segments: StoredSegment[];
};

const LANES = ["Tank", "Car", "Battery"] as const;
const PAINT = {
  tank: "#8a5a00",
  car: "#006a6a",
  buy: "#386a20",
  sell: "#b3261e",
  wait: "#d7d3dc",
  house: "#3b6ea5"
};

/* Minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* HH:MM, with 24:00 at the end of the day. */
function clock(total: number): string {
  if (total >= 24 * 60)
    return "24:00";
  const hour = String(Math.floor(total / 60)).padStart(2, "0");
  const minute = String(total % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/* One stored segment, from the decision line or a snapshot. */
function parseSegment(value: string): StoredSegment | null {
  const match = /^(tank|car|battery-buy|battery-sell|battery-wait) (\d{2}:\d{2})-(\d{2}:\d{2}) (\d+(?:\.\d+)?)(?: (grid|battery|surplus))?$/.exec(value);
  if (!match)
    return null;
  return {
    kind: match[1] as StoredSegment["kind"],
    from: match[2],
    to: match[3],
    kw: Number(match[4]),
    mode: match[5] ?? ""
  };
}

/* The decision stored for this day. */
export function parseSegmentList(value: string | undefined): StoredSegment[] {
  if (!value)
    return [];
  return value.split(";").flatMap((part) => {
    const segment = parseSegment(part);
    return segment ? [segment] : [];
  });
}

/* Change lines, newest first, each with the plan snapshot taken at that minute. */
export function parseChangeList(changes: string | undefined, snapshots: string | undefined): ChangeLine[] {
  const shots = new Map<string, StoredSegment[]>();
  for (const part of (snapshots ?? "").split(";").filter(Boolean)) {
    const split = part.indexOf("=");
    if (split < 0)
      continue;
    shots.set(part.slice(0, split), parseSegmentList(part.slice(split + 1).replaceAll(",", ";")));
  }
  if (!changes)
    return [];
  return changes.split(";").filter(Boolean).flatMap((part) => {
    const match = /^(\d{2}:\d{2}) (.+) \| (.+)$/.exec(part);
    if (!match)
      return [];
    return [{ at: match[1], trigger: match[2], result: match[3], segments: shots.get(match[1]) ?? [] }];
  });
}

/* A window that has not started is still a plan. */
function ahead(from: string, now: string | null): boolean {
  if (now === null)
    return false;
  return minutes(from) >= minutes(now);
}

/* Car text names where the energy comes from. */
function carLabel(segment: StoredSegment): string {
  const source = segment.mode === "battery" ? "from the battery" : segment.mode === "surplus" ? "leftover sun" : "from the grid";
  return `${source} ${segment.from}–${segment.to}`;
}

/* Blocks for the tank and the car. */
function jobBlocks(segments: StoredSegment[], now: string | null): BarBlock[] {
  return segments.flatMap((segment) => {
    if (segment.kind !== "tank" && segment.kind !== "car")
      return [];
    const lane = segment.kind === "tank" ? "Tank" : "Car";
    return [{
      lane,
      from: segment.from,
      to: segment.to,
      paint: segment.kind === "tank" ? "tank" as const : "car" as const,
      ahead: ahead(segment.from, now),
      label: segment.kind === "tank" ? `${segment.from}–${segment.to}` : carLabel(segment)
    }];
  });
}

/* Buy, sale, and wait, then the hours left as the battery running the house. */
function batteryBlocks(segments: StoredSegment[], now: string | null): BarBlock[] {
  const rows = segments.filter((segment) => segment.kind === "battery-buy" || segment.kind === "battery-sell" || segment.kind === "battery-wait");
  const painted: BarBlock[] = rows.map((segment) => ({
    lane: "Battery",
    from: segment.from,
    to: segment.to,
    paint: segment.kind === "battery-buy" ? "buy" : segment.kind === "battery-sell" ? "sell" : "wait",
    ahead: ahead(segment.from, now),
    label: segment.kind === "battery-buy"
      ? `Buy ${segment.from}–${segment.to}`
      : segment.kind === "battery-sell"
        ? `Sale ${segment.from}–${segment.to}`
        : `Wait ${segment.from}–${segment.to}`
  }));
  if (segments.length === 0)
    return [];
  const covered: Array<[number, number]> = rows.map((segment) => [minutes(segment.from), minutes(segment.to)]);
  let cursor = 0;
  const gaps: Array<[number, number]> = [];
  covered.sort((left, right) => left[0] - right[0]);
  for (const [start, end] of covered) {
    if (start > cursor)
      gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 24 * 60)
    gaps.push([cursor, 24 * 60]);
  const house = gaps.flatMap(([start, end]) => splitHouse(start, end, now));
  return [...painted, ...house];
}

/* A house stretch is solid up to now and hatched after it. */
function splitHouse(start: number, end: number, now: string | null): BarBlock[] {
  if (end <= start)
    return [];
  if (now === null)
    return [houseBlock(start, end, false)];
  const at = minutes(now);
  if (at <= start)
    return [houseBlock(start, end, true)];
  if (at >= end)
    return [houseBlock(start, end, false)];
  return [houseBlock(start, at, false), houseBlock(at, end, true)];
}

/* One run-the-house block. */
function houseBlock(start: number, end: number, isAhead: boolean): BarBlock {
  return {
    lane: "Battery",
    from: clock(start),
    to: clock(end),
    paint: "house",
    ahead: isAhead,
    label: `Runs the house ${clock(start)}–${clock(end)}`
  };
}

/* Three lanes. An empty store draws nothing, so a day from before the store stays blank. */
export function planBarBlocks(segments: StoredSegment[], now: string | null): BarBlock[] {
  return [...jobBlocks(segments, now), ...batteryBlocks(segments, now)];
}

/* Prague HH:MM, for the red line on today. */
export function pragueClock(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/* Escape text that is written into the picture. */
function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/* The picture. Every lane has the same track, so an empty car stays visible. The red line is drawn only for today. */
export function renderPlanBar(host: HTMLElement, segments: StoredSegment[], now: string | null, showLine = true): void {
  const blocks = planBarBlocks(segments, now);
  const laneHeight = 28;
  const gap = 8;
  const header = 16;
  const footer = 18;
  const height = header + LANES.length * (laneHeight + gap) - gap + footer;
  const prefix = `plan-${Math.random().toString(36).slice(2, 8)}`;
  const xAt = (total: number) => total;
  const paints = Object.entries(PAINT);
  const tracks = LANES.map((_, index) => {
    const y = header + index * (laneHeight + gap);
    return `<rect x="0" y="${y}" width="1440" height="${laneHeight}" fill="#ece8f0" />`;
  }).join("");
  const hours = [0, 6, 12, 18, 24].map((hour) => {
    const x = hour * 60;
    const anchor = hour === 0 ? "start" : hour === 24 ? "end" : "middle";
    const grid = `<line x1="${x}" y1="${header}" x2="${x}" y2="${height - footer}" stroke="#d7d3dc" stroke-width="1" />`;
    return `${grid}<text x="${x}" y="${height - 4}" font-size="11" text-anchor="${anchor}" fill="#49454f">${String(hour).padStart(2, "0")}</text>`;
  }).join("");
  const rects = blocks.map((block) => {
    const lane = LANES.indexOf(block.lane);
    const x = xAt(minutes(block.from));
    const w = Math.max(1, xAt(minutes(block.to)) - x);
    const y = header + lane * (laneHeight + gap);
    const fill = block.ahead ? `url(#${prefix}-${block.paint})` : PAINT[block.paint];
    return `<rect x="${x}" y="${y}" width="${w}" height="${laneHeight}" fill="${fill}" stroke="${PAINT[block.paint]}"><title>${escapeXml(block.label)}</title></rect>`;
  }).join("");
  const line = showLine && now !== null
    ? `<line x1="${minutes(now)}" y1="${header}" x2="${minutes(now)}" y2="${height - footer}" stroke="#b3261e" stroke-width="1.5" /><text x="${minutes(now)}" y="12" fill="#b3261e" font-size="11" text-anchor="middle">${escapeXml(now)}</text>`
    : "";
  const names = LANES.map((lane) => `<span>${lane}</span>`).join("");
  host.innerHTML = `<div class="plan-gauge" role="img" aria-label="Tank, car, and battery for the day"><div class="plan-gauge-names">${names}</div><svg viewBox="0 0 1440 ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="height:${height}px">${
    `<defs>${paints.map(([name, color]) => `<pattern id="${prefix}-${name}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${color}" stroke-width="1.5" /></pattern>`).join("")}</defs>`
  }${tracks}${hours}${rects}${line}</svg></div>`;
}

const TRIGGER_KIND = new Map<string, string>([
  ["Booked charge ended", "charge"],
  ["Today's prices", "prices"],
  ["Tomorrow's prices arrived", "prices"],
  ["Tank fell below 55°C", "tank"],
  ["Tank reached 55°C", "tank"],
  ["Car plugged in", "car"],
  ["Car no longer needs a charge", "car"],
  ["Night charging turned off", "car"],
  ["Night charging turned on", "car"],
  ["Battery state of charge", "battery"],
  ["Expected sun", "sun"],
  ["Recent house use", "house"],
  ["Season", "season"],
  ["The clock", "clock"]
]);

/* Badge group for a trigger sentence. An unknown reason stays neutral. */
export function triggerKind(trigger: string): string {
  return TRIGGER_KIND.get(trigger) ?? "other";
}

/* One result sentence becomes one line. The trailing period is display noise. */
export function resultParts(result: string): string[] {
  const parts = result
    .split(/(?<=\.)\s+/)
    .map((part) => part.replace(/\.$/, "").trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts : [result];
}

/* Closed label names how many changes exist. Open label puts them away. */
function changeListLabel(count: number, open: boolean): string {
  return open ? "Hide plan changes" : `Plan changes (${count})`;
}

/* Show or hide the list. The button stays available whenever the day has lines. */
export function toggleChangeList(list: HTMLElement, opener: HTMLElement): void {
  if (list.childElementCount === 0)
    return;
  const open = list.hidden;
  list.hidden = !open;
  opener.setAttribute("aria-expanded", String(open));
  opener.textContent = changeListLabel(list.childElementCount, open);
}

/* One field: a short name, then the trigger badge or the result lines. */
function changeField(label: string, value: HTMLElement): HTMLElement {
  const field = document.createElement("span");
  field.className = "plan-field";
  const name = document.createElement("span");
  name.className = "plan-field-label";
  name.textContent = label;
  field.append(name, value);
  return field;
}

/* The lines under the bar, closed until asked. Choosing one opens that plan over the day. */
export function renderChangeList(list: HTMLElement, snapshot: HTMLElement, lines: ChangeLine[]): void {
  const opener = document.querySelector("#plan-changes-open");
  const keepOpen = !list.hidden && list.childElementCount > 0 && lines.length > 0;
  list.replaceChildren();
  snapshot.hidden = true;
  for (const line of lines) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-change";
    const time = document.createElement("time");
    time.dateTime = line.at;
    time.textContent = line.at;
    const badge = document.createElement("span");
    badge.className = "plan-trigger";
    badge.dataset.kind = triggerKind(line.trigger);
    badge.textContent = line.trigger;
    const results = document.createElement("span");
    results.className = "plan-results";
    for (const part of resultParts(line.result)) {
      const result = document.createElement("span");
      result.textContent = part;
      results.append(result);
    }
    const body = document.createElement("span");
    body.className = "plan-change-body";
    body.append(changeField("Trigger", badge), changeField("Result", results));
    button.append(time, body);
    button.addEventListener("click", () => openSnapshot(snapshot, line));
    item.append(button);
    list.append(item);
  }
  list.hidden = !keepOpen;
  if (opener instanceof HTMLElement) {
    opener.hidden = lines.length === 0;
    opener.setAttribute("aria-expanded", String(keepOpen));
    opener.textContent = changeListLabel(lines.length, keepOpen);
  }
}

/* The plan as it stood at that line. Dismissing it closes the picture. */
function openSnapshot(host: HTMLElement, line: ChangeLine): void {
  host.hidden = false;
  host.replaceChildren();
  const sheet = document.createElement("div");
  sheet.className = "plan-snapshot-sheet";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const picture = document.createElement("div");
  close.addEventListener("click", () => {
    host.hidden = true;
  });
  sheet.append(close, picture);
  host.append(sheet);
  renderPlanBar(picture, line.segments, line.at);
  host.onclick = (event) => {
    if (event.target === host)
      host.hidden = true;
  };
}
