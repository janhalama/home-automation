/*
Overview groups that ignore the date picker.
Now is the plant. Sun is today's forecast beside the meter. This month is grid money.
*/

export type LiveSnapshot = {
  todayKwh: number | null;
  tomorrowKwh: number | null;
  heatingOn: boolean | null;
  tankTemperatureC: number | null;
  priceEurPerMwh: number | null;
  priceInterval: string | null;
  medianEurPerMwh: number | null;
  socPercent: number | null;
  monthImportCzk: number | null;
  monthExportCzk: number | null;
  todayProductionKwh: number | null;
};

export type LiveCard = {
  label: string;
  value: string;
  detail: string;
};

export type LiveGroups = {
  now: LiveCard[];
  sun: LiveCard[];
  month: LiveCard[];
};

/* Kč with a leading minus when the figure is a cost. */
function crowns(value: number): string {
  const text = `${Math.abs(value).toFixed(2)} Kč`;
  return value < 0 ? `−${text}` : text;
}

/* One measured figure, or a waiting label when the archive has nothing yet. */
function recorded(value: number | null | undefined, text: (value: number) => string): string {
  if (value === null || value === undefined)
    return "not yet";
  return text(value);
}

/* One energy total, to a tenth of a kilowatt-hour. */
function kwh(value: number): string {
  return `${value.toFixed(1)} kWh`;
}

/* The current price slot, and whether it sits above today's median. */
function priceDetail(live: LiveSnapshot): string {
  const slot = live.priceInterval ? live.priceInterval.replace("-", "–") : "";
  if (live.priceEurPerMwh == null || live.medianEurPerMwh == null)
    return slot;
  const median = live.medianEurPerMwh.toFixed(0);
  const relation = live.priceEurPerMwh > live.medianEurPerMwh
    ? `above today's median of ${median}`
    : live.priceEurPerMwh < live.medianEurPerMwh
      ? `below today's median of ${median}`
      : `at today's median of ${median}`;
  return slot ? `${slot}, ${relation}` : relation;
}

/* Forecast left for today. Both figures are required, and the remainder never goes below zero. */
function stillToCome(forecast: number | null, produced: number | null): string {
  if (forecast === null || produced === null)
    return "not yet";
  return kwh(Math.max(0, forecast - produced));
}

/* Heater state written under the tank temperature. */
function heater(heatingOn: boolean | null): string {
  if (heatingOn === null)
    return "heater unknown";
  return heatingOn ? "heater on" : "heater off";
}

/* Cards for now, the sun, and this month. */
export function liveGroups(live: LiveSnapshot): LiveGroups {
  const price = live.priceEurPerMwh === null ? "unknown" : `${live.priceEurPerMwh.toFixed(1)} EUR/MWh`;
  const battery = live.socPercent == null ? "unknown" : `${live.socPercent.toFixed(0)}%`;
  const temperature = live.tankTemperatureC === null ? "unknown" : `${live.tankTemperatureC.toFixed(1)} °C`;
  const forecast = live.todayKwh === null ? "unknown" : kwh(live.todayKwh);
  const tomorrow = live.tomorrowKwh === null ? "unknown" : kwh(live.tomorrowKwh);
  const monthNet = live.monthImportCzk === null || live.monthExportCzk === null
    ? "not yet"
    : crowns(live.monthExportCzk - live.monthImportCzk);
  return {
    now: [
      { label: "Price now", value: price, detail: priceDetail(live) },
      { label: "Battery", value: battery, detail: "" },
      { label: "Tank", value: temperature, detail: heater(live.heatingOn) }
    ],
    sun: [
      { label: "Forecast today", value: forecast, detail: "" },
      { label: "Produced", value: recorded(live.todayProductionKwh, kwh), detail: "" },
      { label: "Still to come", value: stillToCome(live.todayKwh, live.todayProductionKwh), detail: "" },
      { label: "Tomorrow", value: tomorrow, detail: "" }
    ],
    month: [
      { label: "Bought", value: recorded(live.monthImportCzk, crowns), detail: "" },
      { label: "Sold", value: recorded(live.monthExportCzk, crowns), detail: "" },
      { label: "Net", value: monthNet, detail: "" }
    ]
  };
}
