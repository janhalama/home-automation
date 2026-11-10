/*
Seasonal energy from the reduced Wattsonic days.
Overnight grid import and expected PV are the medians in ADR 0008.
Daylight and night house load by season are the medians from scripts/reduce-day-curves.py.
The live plan reads the recent archive. These tables are the fallback when that window is thin.
*/

export type Season = "winter" | "spring" | "summer" | "autumn";
export type CloudBand = "clear" | "mixed" | "covered";

const PACK_KWH = 19;
const FLOOR_PERCENT = 20;

const OVERNIGHT_KWH: Record<Season, number> = {
  winter: 7.3,
  spring: 0.8,
  summer: 0.7,
  autumn: 2.0
};

const DAYLIGHT_HOUSE_KWH: Record<Season, number> = {
  winter: 5.7,
  spring: 13.6,
  summer: 12.8,
  autumn: 8.6
};

const NIGHT_HOUSE_KWH: Record<Season, number> = {
  winter: 11.2,
  spring: 5.5,
  summer: 2.8,
  autumn: 6.4
};

const WORKDAY_DAYLIGHT_KWH: Record<Season, number> = {
  winter: 4.9,
  spring: 13.6,
  summer: 12.8,
  autumn: 7.7
};

const WEEKEND_DAYLIGHT_KWH: Record<Season, number> = {
  winter: 9.7,
  spring: 15.6,
  summer: 13.2,
  autumn: 13.3
};

const FORTNIGHT_NIGHT_KWH = [
  14.3, 13.3, 9.1, 9.3, 7.7, 9.1, 6.7, 5.8, 4.8, 3.2, 3.4, 2.6, 2.9,
  2.7, 2.8, 2.9, 3.4, 3.5, 5.0, 4.9, 8.2, 8.8, 13.8, 9.9, 13.9, 10.5
];

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

/* Median house energy from sunrise to sunset in that season, with car periods set aside. */
export function daylightHouseKwh(season: Season): number {
  return DAYLIGHT_HOUSE_KWH[season];
}

/* Median house energy during the dark hours in that season, with car periods set aside. */
export function nightHouseKwh(season: Season): number {
  return NIGHT_HOUSE_KWH[season];
}

/* Seasonal night plus seasonal daylight. The live plan uses the recent fortnight instead. */
export function sunlessHouseKwh(season: Season): number {
  return nightHouseKwh(season) + daylightHouseKwh(season);
}

/* Seasonal daylight for a workday or a weekend, used when the recent window is thin. */
export function seasonalDaylightKwh(season: Season, weekend: boolean): number {
  return weekend ? WEEKEND_DAYLIGHT_KWH[season] : WORKDAY_DAYLIGHT_KWH[season];
}

/* Night median for the 14-day block that contains this calendar date. */
export function fortnightNightKwh(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match)
    throw new Error(`The consumption date is missing: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  const dayOfYear = Math.floor((current - start) / 86_400_000) + 1;
  const index = Math.min(25, Math.floor((dayOfYear - 1) / 14));
  return FORTNIGHT_NIGHT_KWH[index];
}

/* State of charge the house keeps. The night always sits above the 20% outage floor, because the sun is down and the house still has to draw from the battery. Expected sun is taken off the daylight only. */
export function reserveSocPercent(nightKwh: number, daylightKwh: number, expectedPvKwh: number | null): number {
  const uncoveredDaylight = expectedPvKwh === null ? daylightKwh : Math.max(0, daylightKwh - expectedPvKwh);
  const uncovered = nightKwh + uncoveredDaylight;
  const percent = FLOOR_PERCENT + uncovered / PACK_KWH * 100;
  return Math.min(100, Math.round(percent * 10) / 10);
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
