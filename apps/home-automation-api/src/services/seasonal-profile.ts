/*
Seasonal overnight energy and expected PV from the reduced Wattsonic days.
The figures are the medians in ADR 0008. The clock for buying them is a later step.
*/

export type Season = "winter" | "spring" | "summer" | "autumn";
export type CloudBand = "clear" | "mixed" | "covered";

const OVERNIGHT_KWH: Record<Season, number> = {
  winter: 7.3,
  spring: 0.8,
  summer: 0.7,
  autumn: 2.0
};

const EXPECTED_PV_KWH: Record<Season, Record<CloudBand, number>> = {
  winter: { clear: 12.8, mixed: 6.0, covered: 1.5 },
  spring: { clear: 35.7, mixed: 30.3, covered: 15.7 },
  summer: { clear: 38.3, mixed: 31.9, covered: 22.4 },
  autumn: { clear: 21.7, mixed: 14.3, covered: 4.6 }
};

/* Return the median grid import from 18:00 to 06:00 for a quiet night in that season. */
export function overnightKwh(season: Season): number {
  return OVERNIGHT_KWH[season];
}

/* Map a calendar date to the season used by the overnight and PV tables. */
export function seasonOf(date: string): Season {
  const month = Number(date.slice(5, 7));
  if (month === 12 || month <= 2)
    return "winter";
  if (month <= 5)
    return "spring";
  if (month <= 8)
    return "summer";
  return "autumn";
}

/* Return the median PV total for that season and morning low-cloud band. */
export function expectedPvKwh(season: Season, band: CloudBand): number {
  return EXPECTED_PV_KWH[season][band];
}

/* Return the grid kWh still needed above the floor so the house reaches morning. */
export function houseGridKwh(season: Season, band: CloudBand, aboveFloorKwh: number): number {
  const stored = Math.max(0, aboveFloorKwh);
  const overnight = overnightKwh(season);
  const expected = expectedPvKwh(season, band);
  const toReachMorning = Math.max(0, overnight - stored);
  const sunWillNotRefill = Math.max(0, overnight - expected);
  return toReachMorning + sunWillNotRefill;
}

/* Place a low-cloud percentage into the band used by the seasonal table. */
export function cloudBand(lowCloudPercent: number): CloudBand {
  if (lowCloudPercent < 20)
    return "clear";
  if (lowCloudPercent < 70)
    return "mixed";
  return "covered";
}
