/*
The day's grid money.
Import pays the spot price plus a fixed distribution charge.
Export pays the spot price only. Sun that stayed in the house is valued as the import it replaced.
*/

export const DISTRIBUTION_CZK_PER_KWH = 1.5;
const QUARTER_HOURS = 0.25;

export type BalancePoint = {
  time: string;
  meterKw: number | null;
  priceEurPerMwh: number | null;
  pvKw?: number | null;
  batteryKw?: number | null;
  carKw?: number | null;
  tankKw?: number | null;
};

export type ImportSplit = {
  house: number;
  battery: number;
  car: number;
  tank: number;
};

export type DayBalance = {
  importKwh: number;
  exportKwh: number;
  importCzk: number;
  exportCzk: number;
  balanceCzk: number;
  houseCzk: number;
  batteryCzk: number;
  carCzk: number;
  tankCzk: number;
  sunCzk: number;
  unpricedKwh: number;
};

/* Clock HH:MM or HH:MM:SS to minutes after midnight. */
function minutes(clock: string): number {
  const [hour, minute, second] = clock.split(":");
  return Number(hour) * 60 + Number(minute) + Number(second ?? 0) / 60;
}

/* Kč/kWh from an EUR/MWh spot price at the given Kč per euro. */
function spotCzk(eurPerMwh: number, czkPerEur: number): number {
  return eurPerMwh * czkPerEur / 1000;
}

/* Hours this reading covers. The last reading of the day covers one quarter, and never past midnight. */
function spanHours(time: string, next: string | null): number {
  if (next === null)
    return Math.min(QUARTER_HOURS, Math.max(0, (24 * 60 - minutes(time)) / 60));
  return (minutes(next) - minutes(time)) / 60;
}

/* Share of this quarter's import, in kW, for each load. The shares add up to the import. */
function importShares(point: BalancePoint): ImportSplit {
  const meterKw = point.meterKw ?? 0;
  const importKw = Math.max(0, -meterKw);
  const battery = Math.max(0, -(point.batteryKw ?? 0));
  const car = Math.max(0, point.carKw ?? 0);
  const tank = Math.max(0, point.tankKw ?? 0);
  const house = Math.max(0, (point.pvKw ?? 0) - meterKw + (point.batteryKw ?? 0) - tank - car);
  const demand = house + battery + car + tank;
  if (demand <= 0)
    return { house: importKw, battery: 0, car: 0, tank: 0 };
  const scale = importKw / demand;
  return {
    house: house * scale,
    battery: battery * scale,
    car: car * scale,
    tank: tank * scale
  };
}

/* Purchase cost, export income, and the net for the measured quarters that have a spot price. */
export function dayBalance(points: BalancePoint[], czkPerEur: number): DayBalance {
  const measured = points
    .filter((point) => point.meterKw !== null)
    .sort((left, right) => minutes(left.time) - minutes(right.time));
  let importKwh = 0;
  let exportKwh = 0;
  let importCzk = 0;
  let exportCzk = 0;
  let houseCzk = 0;
  let batteryCzk = 0;
  let carCzk = 0;
  let tankCzk = 0;
  let sunCzk = 0;
  let unpricedKwh = 0;
  measured.forEach((point, index) => {
    const meterKw = point.meterKw ?? 0;
    const span = spanHours(point.time, measured[index + 1]?.time ?? null);
    if (span <= 0)
      return;
    const kwh = Math.abs(meterKw) * span;
    if (point.priceEurPerMwh === null) {
      if (meterKw !== 0)
        unpricedKwh += kwh;
      return;
    }
    const spot = spotCzk(point.priceEurPerMwh, czkPerEur);
    const exportKw = Math.max(0, meterKw);
    const sunKw = Math.max(0, (point.pvKw ?? 0) - exportKw);
    sunCzk += sunKw * span * (spot + DISTRIBUTION_CZK_PER_KWH);
    if (meterKw === 0)
      return;
    if (meterKw < 0) {
      const shares = importShares(point);
      const price = spot + DISTRIBUTION_CZK_PER_KWH;
      importKwh += kwh;
      importCzk += kwh * price;
      houseCzk += shares.house * span * price;
      batteryCzk += shares.battery * span * price;
      carCzk += shares.car * span * price;
      tankCzk += shares.tank * span * price;
      return;
    }
    exportKwh += kwh;
    exportCzk += kwh * spot;
  });
  return {
    importKwh,
    exportKwh,
    importCzk,
    exportCzk,
    balanceCzk: exportCzk - importCzk,
    houseCzk,
    batteryCzk,
    carCzk,
    tankCzk,
    sunCzk,
    unpricedKwh
  };
}
