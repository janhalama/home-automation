/*
Plan rows and the heater split, read from the stored decision.
A day with no stored decision leaves the plan rows empty.
*/

export type StoredSegment = {
  kind: "tank" | "car" | "battery-buy" | "battery-sell" | "battery-wait";
  from: string;
  to: string;
  kw: number;
  mode: string;
};

/* Minutes after midnight. 24:00 is the end of the day. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* True when this quarter sits inside the segment. The end minute is not included. */
function covers(segment: StoredSegment, time: string): boolean {
  const at = minutes(time);
  const start = minutes(segment.from);
  const end = minutes(segment.to);
  return at >= start && at < end;
}

/* One plan row. No stored decision, or none of this kind, leaves the row empty. */
function planValues(labels: string[], segments: StoredSegment[], kind: StoredSegment["kind"], value: (segment: StoredSegment) => number): Array<number | null> {
  if (segments.length === 0)
    return labels.map(() => null);
  const rows = segments.filter((segment) => segment.kind === kind);
  if (rows.length === 0)
    return labels.map(() => null);
  return labels.map((time) => {
    const hit = rows.find((segment) => covers(segment, time));
    return hit ? value(hit) : 0;
  });
}

/* Tank plan in kW. Hatched on the chart. */
export function tankPlanSeries(labels: string[], segments: StoredSegment[]): Array<number | null> {
  return planValues(labels, segments, "tank", (segment) => segment.kw);
}

/* Car plan in kW. Hatched on the chart. */
export function carPlanSeries(labels: string[], segments: StoredSegment[]): Array<number | null> {
  return planValues(labels, segments, "car", (segment) => segment.kw);
}

/* Battery plan. A buy is below zero. A sale is above zero. */
export function batteryPlanSeries(labels: string[], segments: StoredSegment[]): { buy: Array<number | null>; sale: Array<number | null> } {
  return {
    buy: planValues(labels, segments, "battery-buy", (segment) => -segment.kw),
    sale: planValues(labels, segments, "battery-sell", (segment) => segment.kw)
  };
}

/* Measured battery power. Buy below zero, the house above zero, a sale above zero when the meter is exporting. */
export function batteryFlowParts(batteryKw: number | null, meterKw: number | null): { buy: number | null; house: number | null; sale: number | null } {
  if (batteryKw === null)
    return { buy: null, house: null, sale: null };
  if (batteryKw < 0)
    return { buy: batteryKw, house: 0, sale: 0 };
  if (batteryKw > 0 && meterKw !== null && meterKw > 0)
    return { buy: 0, house: 0, sale: batteryKw };
  return { buy: 0, house: Math.max(0, batteryKw), sale: 0 };
}

/* Heater minutes inside a stored tank window stay with the plan. Minutes outside are the house. */
export function heaterSeries(
  labels: string[],
  heating: Array<number | null>,
  segments: StoredSegment[]
): { plan: Array<number | null>; house: Array<number | null>; houseActed: boolean } {
  const tanks = segments.filter((segment) => segment.kind === "tank");
  if (tanks.length === 0)
    return { plan: heating, house: labels.map(() => null), houseActed: false };
  const plan: Array<number | null> = [];
  const house: Array<number | null> = [];
  labels.forEach((time, index) => {
    const on = heating[index];
    if (on === null || on === undefined) {
      plan.push(null);
      house.push(null);
      return;
    }
    const inside = tanks.some((segment) => covers(segment, time));
    plan.push(on === 1 && inside ? 1 : 0);
    house.push(on === 1 && !inside ? 1 : 0);
  });
  return { plan, house, houseActed: house.some((value) => value === 1) };
}
