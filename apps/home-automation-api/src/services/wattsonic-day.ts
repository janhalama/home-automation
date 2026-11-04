/*
Reads one Wattsonic day curve into the samples the day score uses.
Negative meter power is import. Negative battery power is charging.
*/

import type { PowerSample } from "./day-score.js";

type Point = { value?: string | null } | null;

type WattsonicDay = {
  body?: {
    legend?: string[];
    xaxis?: string[];
    data?: Point[][];
  };
};

/* Read PV, meter, battery, and state of charge samples. A missing series is an error. */
export function samplesFromWattsonicDay(payload: WattsonicDay): PowerSample[] {
  const body = payload.body;
  const legend = body?.legend;
  const times = body?.xaxis;
  const data = body?.data;
  if (!legend || !times || !data)
    throw new Error("The day curve is missing a series");

  const indexes = {
    pv: legend.indexOf("PpvInput"),
    meter: legend.indexOf("PmeterTotal"),
    battery: legend.indexOf("Battery_P"),
    soc: legend.indexOf("SOC")
  };
  if (Object.values(indexes).some((index) => index < 0))
    throw new Error("The day curve is missing a series");

  const samples: PowerSample[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const pv = numberOrNull(data[indexes.pv]?.[index]);
    const meter = numberOrNull(data[indexes.meter]?.[index]);
    const battery = numberOrNull(data[indexes.battery]?.[index]);
    const soc = numberOrNull(data[indexes.soc]?.[index]);
    if (pv === null || meter === null || battery === null || soc === null)
      continue;
    samples.push({
      time: times[index],
      meterKw: meter,
      batteryKw: battery,
      pvKw: pv,
      socPercent: soc
    });
  }
  return samples;
}

/* Parse one curve point. Null and blank samples are gaps in the day. */
function numberOrNull(point: Point | undefined): number | null {
  const value = point?.value;
  if (value === null || value === undefined || value === "")
    return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error("The day curve contains a value that is not a number");
  return parsed;
}
