/*
Fills the house archive with OTE prices and heater samples.
Today and tomorrow are fetched when missing. One older curve day is fetched per run. The heater is sampled when the Miniserver is configured.
*/

import { existsSync, readdirSync } from "node:fs";
import { fetchDayAheadPrices, type OtePost } from "./ote-day-ahead.js";
import type { HeatingSample, HouseArchive, PowerReading } from "./house-archive.js";

const FIRST_QUARTER_HOUR_DAY = "2025-10-01";

export type HouseSnapshot = {
  archive: HouseArchive;
  now: Date;
  post: OtePost;
  wattsonicDaysDir: string;
  readHeating: (() => Promise<HeatingSample>) | null;
  readPower: (() => Promise<PowerReading>) | null;
};

/* Calendar date in Europe/Prague, shifted by whole days. */
export function pragueDate(now: Date, dayOffset: number): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year, month, day] = formatted.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + dayOffset)).toISOString().slice(0, 10);
}

/* Local Prague timestamp for a heater sample. */
export function pragueTimestamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

/* Store one delivery day when the archive does not already have it. */
async function storeIfMissing(archive: HouseArchive, post: OtePost, date: string): Promise<void> {
  if (archive.listSpotPrices(date).length > 0)
    return;
  archive.saveSpotPrices(await fetchDayAheadPrices(date, post));
}

/* Fetch the oldest curve day that OTE publishes in 15-minute steps and that is not stored yet. */
async function storeOldestMissingCurve(
  archive: HouseArchive,
  post: OtePost,
  wattsonicDaysDir: string,
  today: string
): Promise<void> {
  const dates = readdirSync(wattsonicDaysDir)
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((date): date is string => date !== undefined)
    .filter((date) => date >= FIRST_QUARTER_HOUR_DAY && date < today)
    .sort();
  const missing = dates.find((date) => archive.listSpotPrices(date).length === 0);
  if (missing)
    await storeIfMissing(archive, post, missing);
}

/* Store prices and, when a reader is configured, one heater sample and one power sample. */
export async function collectHouseSnapshot(snapshot: HouseSnapshot): Promise<void> {
  if (snapshot.readPower)
    snapshot.archive.savePowerSample(await snapshot.readPower());
  const today = pragueDate(snapshot.now, 0);
  const tomorrow = pragueDate(snapshot.now, 1);
  await storeIfMissing(snapshot.archive, snapshot.post, today);
  try {
    await storeIfMissing(snapshot.archive, snapshot.post, tomorrow);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no prices"))
      throw error;
  }
  if (snapshot.wattsonicDaysDir && existsSync(snapshot.wattsonicDaysDir))
    await storeOldestMissingCurve(
      snapshot.archive,
      snapshot.post,
      snapshot.wattsonicDaysDir,
      today
    );
  if (snapshot.readHeating)
    snapshot.archive.applyHeatingSample(await snapshot.readHeating());
}
