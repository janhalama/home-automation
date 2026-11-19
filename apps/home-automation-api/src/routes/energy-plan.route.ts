/*
The plan Loxone pulls. The route only answers. It does not switch the heater.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { formatErrorResponse } from "../lib/plain-text-response.js";
import { carJobFromReading, type CarReading } from "../services/car-energy.js";
import { chargeWindow, keepChargeWindow, type ChargeWindow } from "../services/charge-commitment.js";
import { buildEnergyPlan, formatEnergyPlan, type EnergyPlan } from "../services/energy-plan.js";
import {
  chargeJustEnded,
  commandFromDecision,
  formatStoredDecision,
  issueTodayDecision,
  priceKey,
  segmentsFromPlan
} from "../services/plan-decision.js";
import { heaterIsOn, HOUSE_LOAD_DAYS, houseKwByHour, houseLoadDates, houseLoadForPlan } from "../services/recent-house-load.js";
import type { PredictionStore } from "../services/prediction-store.js";
import { alignSunCover } from "../services/sun-cover.js";
import { rememberSunHours } from "../services/sun-hours.js";
import { chargeKwLookup } from "../services/teslamate-history.js";
import type { CarPoint } from "../services/car-day.js";
import { addDays, daylightDate, sunClocks } from "../services/sun-clock.js";
import type { FetchImpl } from "../services/forecast-solar-client.js";
import type { HouseArchive } from "../services/house-archive.js";
import { pragueDate, pragueTimestamp } from "../services/house-collector.js";
import { fetchMorningLowCloud } from "../services/open-meteo-cloud-client.js";
import { cloudBand, expectedPvKwh, seasonOf } from "../services/seasonal-profile.js";

const HOUSE = { lat: 50.6920036, lon: 15.2203556 };
const BATTERY_KWH = 19;
const FLOOR_PERCENT = 20;

export type EnergyPlanDeps = {
  apiKey: string;
  archive: HouseArchive | null;
  readCar: (() => Promise<CarReading>) | null;
  readCarDay: ((date: string) => Promise<CarPoint[]>) | null;
  readChargeKw: ((fromDate: string, untilDate: string) => Promise<(at: string) => number>) | null;
  fetchImpl: FetchImpl;
  predictionStore: PredictionStore | null;
  forecastSolarApiKey: string;
  timeoutMs: number;
  readNightCharging?: () => Promise<boolean>;
  clock?: () => Date;
};

/* Refuse a call that has no server key or the wrong client key. */
function rejectUnauthorized(apiKey: string, request: FastifyRequest, reply: FastifyReply, queryApiKey?: string): boolean {
  if (!apiKey) {
    reply.status(503).type("text/plain; charset=utf-8").send(formatErrorResponse("server_misconfigured"));
    return true;
  }
  const header = request.headers["x-api-key"];
  const presented = typeof header === "string" ? header : queryApiKey;
  if (presented !== apiKey) {
    reply.status(401).type("text/plain; charset=utf-8").send(formatErrorResponse("unauthorized"));
    return true;
  }
  return false;
}

/* State of charge for the live plan. A future day uses the last sample from before it. */
function socPercentFor(archive: HouseArchive, date: string): number | null {
  const sameDay = archive.listPowerSamples(date).at(-1);
  if (sameDay)
    return sameDay.socPercent;
  return archive.latestPowerSampleBefore(date)?.socPercent ?? null;
}

/* State of charge before this day's charge. The first sample of the day, or the one before it. */
function socAtOpen(archive: HouseArchive, date: string): number | null {
  const first = archive.listPowerSamples(date)[0];
  if (first)
    return first.socPercent;
  return archive.latestPowerSampleBefore(date)?.socPercent ?? null;
}

/* Prague HH:MM. The car slot starts after this clock. */
function pragueClock(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/* The grid charge the fresh build wants, or nothing when it says hold. */
function proposedCharge(plan: EnergyPlan): ChargeWindow | null {
  if (plan.battery !== "grid-charge" || !plan.batteryFrom || !plan.batteryTo || plan.batteryKw <= 0)
    return null;
  return chargeWindow(plan.batteryFrom, plan.batteryTo, plan.batteryKw);
}

/* Put the stored charge on the text the Miniserver reads. An ended window leaves hold. */
function applyChargeCommitment(plan: EnergyPlan, kept: { active: ChargeWindow | null; booked: ChargeWindow[] }): EnergyPlan {
  const batteryCharges = kept.booked.map((window) => ({
    from: window.from,
    to: window.to,
    kw: window.kw
  }));
  if (!kept.active)
    return {
      ...plan,
      battery: "hold",
      batteryKw: 0,
      batteryFrom: null,
      batteryTo: null,
      batteryCharges
    };
  return {
    ...plan,
    battery: "grid-charge",
    batteryKw: kept.active.kw,
    batteryFrom: kept.active.from,
    batteryTo: kept.active.to,
    batteryCharges
  };
}

/* Today writes the merged decision. Any other look only reads it, and leaves a missing day on the fresh calculation. */
function issuedPlan(
  archive: HouseArchive,
  date: string,
  plan: EnergyPlan,
  lookAhead: boolean,
  opening: boolean,
  now: string,
  reading: {
    prices: { periodInterval: string; eurPerMwh: number }[];
    tomorrowPrices: { periodInterval: string }[];
    heatingTemperatureC: number | null;
    carAtHome: boolean;
    carMissingKwh: number;
    nightCharging: boolean;
    socPercent: number | null;
    expectedSunKwh: number | null;
    nightHouseKwh: number;
    daylightHouseKwh: number;
    season: string;
  }
): EnergyPlan {
  const stored = archive.listDayDecisions(date);
  if (!lookAhead)
    return stored.length > 0 ? commandFromDecision(plan, stored, opening ? "00:00" : now) : plan;
  const previous = archive.readPlanInputs(date);
  return issueTodayDecision({
    archive,
    date,
    now,
    plan,
    inputs: {
      bookedChargeEnded: chargeJustEnded(stored, previous, now),
      clock: now,
      todayPrices: priceKey(reading.prices),
      tomorrowPricesArrived: reading.tomorrowPrices.length > 0,
      tankC: reading.heatingTemperatureC,
      carAtHome: reading.carAtHome,
      carMissingKwh: reading.carMissingKwh,
      nightCharging: reading.nightCharging,
      socPercent: reading.socPercent,
      expectedSunKwh: reading.expectedSunKwh,
      nightHouseKwh: reading.nightHouseKwh,
      daylightHouseKwh: reading.daylightHouseKwh,
      season: reading.season
    }
  });
}

/* Energy already produced today. Each stored sample stands for one quarter-hour. */
function producedPvKwh(samples: { pvKw: number }[]): number {
  return samples.reduce((sum, sample) => sum + Math.max(0, sample.pvKw) * 0.25, 0);
}

/* True when tomorrow's prices already include the hours before sunrise. */
function nextMorningIsPriced(tomorrow: { periodInterval: string }[], nextDate: string): boolean {
  if (tomorrow.length === 0)
    return false;
  const rise = sunClocks(nextDate).rise.slice(0, 5);
  return tomorrow.some((quarter) => quarter.periodInterval.split("-")[0] < rise);
}

/* Kilowatt-hours already stored above the 20% floor. */
function aboveFloorKwh(socPercent: number | null): number | null {
  if (socPercent === null)
    return null;
  return Math.max(0, socPercent - FLOOR_PERCENT) / 100 * BATTERY_KWH;
}

/* Record how long the plan pull took. The query holds the key, so it stays out of the log. */
function registerPlanPollLog(app: FastifyInstance): void {
  app.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path !== "/api/energy/plan")
      return;
    request.log.info({ statusCode: reply.statusCode, ms: Math.round(reply.elapsedTime) }, "plan poll");
  });
}

/* Register the plan Loxone pulls once a day. */
export function registerEnergyPlanRoute(app: FastifyInstance, deps: EnergyPlanDeps): void {
  registerPlanPollLog(app);
  app.route({
    method: "GET",
    url: "/api/energy/plan-log",
    schema: {
      querystring: Type.Object({
        error: Type.String(),
        apiKey: Type.Optional(Type.String())
      }, { additionalProperties: false })
    },
    handler: async (request, reply) => {
      const query = request.query as { error: string; apiKey?: string };
      if (rejectUnauthorized(deps.apiKey, request, reply, query.apiKey))
        return;
      request.log.error({ error: query.error.slice(0, 80) }, "plan poll failed");
      reply.status(200).type("text/plain; charset=utf-8").send("ok\n");
    }
  });
  app.route({
    method: "GET",
    url: "/api/energy/plan",
    schema: {
      querystring: Type.Object({
        date: Type.Optional(Type.String()),
        apiKey: Type.Optional(Type.String()),
        asOf: Type.Optional(Type.String())
      }, { additionalProperties: false })
    },
    handler: async (request, reply) => {
      const query = request.query as { date?: string; apiKey?: string; asOf?: string };
      if (rejectUnauthorized(deps.apiKey, request, reply, query.apiKey))
        return;
      if (query.asOf !== undefined && query.asOf !== "open") {
        reply.status(400).type("text/plain; charset=utf-8").send(formatErrorResponse("bad_request"));
        return;
      }
      const date = query.date ?? pragueTimestamp(new Date()).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        reply.status(400).type("text/plain; charset=utf-8").send(formatErrorResponse("bad_request"));
        return;
      }
      const opening = query.asOf === "open";
      if (!deps.archive) {
        reply.status(503).type("text/plain; charset=utf-8").send(formatErrorResponse("server_misconfigured"));
        return;
      }
      const prices = deps.archive.listSpotPrices(date);
      if (prices.length === 0) {
        reply.status(200).type("text/plain; charset=utf-8").send(formatErrorResponse("missing_price"));
        return;
      }

      let nightCharging = true;
      if (deps.readNightCharging) {
        try {
          nightCharging = await deps.readNightCharging();
        } catch {
          nightCharging = true;
        }
      }
      let car = null;
      if (deps.readCar) {
        try {
          car = carJobFromReading(await deps.readCar());
        } catch {
          car = null;
        }
      }
      const lowCloud = await fetchMorningLowCloud(HOUSE.lat, HOUSE.lon, date, deps.fetchImpl);
      const season = seasonOf(date);
      const expectedPv = lowCloud === null ? null : expectedPvKwh(season, cloudBand(lowCloud));
      const archive = deps.archive;
      const samples = archive.listPowerSamples(date);
      const soc = opening ? socAtOpen(archive, date) : socPercentFor(archive, date);
      const produced = opening ? 0 : producedPvKwh(samples);
      const pvRemainingKwh = expectedPv === null ? null : Math.max(0, expectedPv - produced);
      const now = deps.clock?.() ?? new Date();
      const today = pragueTimestamp(now).slice(0, 10);
      const lookAhead = !opening && date === today;
      const tomorrowDate = pragueDate(new Date(), 1);
      const tomorrowCloud = lookAhead
        ? await fetchMorningLowCloud(HOUSE.lat, HOUSE.lon, tomorrowDate, deps.fetchImpl)
        : null;
      const tomorrowPvKwh = tomorrowCloud === null ? null : expectedPvKwh(seasonOf(tomorrowDate), cloudBand(tomorrowCloud));
      const heating = archive.latestHeating();
      const openingTemperatureC = archive.listHeatingTemperatures(date)[0]?.temperatureC ?? null;
      const startAt = lookAhead ? pragueClock(now) : null;
      const daylight = daylightDate(date, startAt);
      const origin = daylight < date ? daylight : date;
      const latest = daylight > date ? daylight : date;
      const heatingPeriods = archive.listHeatingPeriodsOverlapping(
        `${addDays(origin, -HOUSE_LOAD_DAYS)}T00:00:00`,
        `${addDays(latest, 1)}T00:00:00`
      );
      const carChargeKw = await chargeKwLookup({
        dates: houseLoadDates(date, daylight),
        readChargeKw: deps.readChargeKw,
        readCarDay: deps.readCarDay
      });
      const load = houseLoadForPlan({
        planDate: date,
        daylightDate: daylight,
        readDay: (day) => archive.listPowerSamples(day),
        tankOn: (at) => heaterIsOn(heatingPeriods, at),
        carChargeKw
      });
      const tomorrowPrices = lookAhead ? archive.listSpotPrices(pragueDate(new Date(), 1)) : [];
      const built = buildEnergyPlan({
        prices,
        tomorrowPrices,
        startAt,
        bottomTemperatureC: opening
          ? (openingTemperatureC ?? heating?.temperatureC ?? null)
          : (heating?.temperatureC ?? null),
        openingTemperatureC,
        aboveFloorKwh: aboveFloorKwh(soc),
        socPercent: soc,
        date,
        nightHouseKwh: load.nightKwh,
        daylightHouseKwh: load.daylightKwh,
        season,
        lowCloudPercent: lowCloud,
        pvRemainingKwh,
        tomorrowPvKwh: lookAhead ? tomorrowPvKwh : null,
        car,
        nightCharging,
        coverNextMorning: season !== "summer" && !nextMorningIsPriced(tomorrowPrices, addDays(date, 1))
      });
      let sunCover: { from: string; to: string } | null = null;
      if (deps.predictionStore) {
        try {
          await rememberSunHours({
            store: deps.predictionStore,
            fetchImpl: deps.fetchImpl,
            apiKey: deps.forecastSolarApiKey,
            timeoutMs: deps.timeoutMs,
            now: new Date()
          });
        } catch {
          sunCover = null;
        }
        const demand = houseKwByHour({
          planDate: date,
          readDay: (day) => archive.listPowerSamples(day),
          tankOn: (at) => heaterIsOn(heatingPeriods, at),
          carChargeKw
        });
        const aligned = alignSunCover(deps.predictionStore.listSunHours(date), demand);
        sunCover = aligned.from && aligned.to ? { from: aligned.from, to: aligned.to } : null;
      }
      let committed = built;
      if (lookAhead) {
        const kept = keepChargeWindow(
          archive.listChargeWindows(date),
          proposedCharge(built),
          pragueClock(now),
          samples.map((sample) => ({ clock: sample.at.slice(11, 16), batteryKw: sample.batteryKw }))
        );
        archive.saveChargeWindows(date, kept.booked);
        if (kept.fault)
          request.log.warn({ from: kept.active?.from, to: kept.active?.to }, "battery charge is not reaching the meter");
        committed = applyChargeCommitment(built, kept);
      } else {
        const booked = archive.listChargeWindows(date);
        if (booked.length > 0)
          committed = {
            ...built,
            batteryCharges: booked.map((window) => ({ from: window.from, to: window.to, kw: window.kw }))
          };
      }
      const issued = issuedPlan(archive, date, committed, lookAhead, opening, pragueClock(now), {
        prices,
        tomorrowPrices,
        heatingTemperatureC: heating?.temperatureC ?? null,
        carAtHome: Boolean(car?.atHome),
        carMissingKwh: car?.missingKwh ?? 0,
        nightCharging,
        socPercent: soc,
        expectedSunKwh: pvRemainingKwh,
        nightHouseKwh: load.nightKwh,
        daylightHouseKwh: load.daylightKwh,
        season
      });
      const text = formatEnergyPlan(issued);
      const cover = sunCover ? `sunCoversFrom=${sunCover.from}\nsunCoversTo=${sunCover.to}\n` : "";
      const stored = archive.listDayDecisions(date);
      const picture = stored.length > 0 || date <= today ? stored : segmentsFromPlan(issued);
      const storedText = formatStoredDecision(picture, archive.listPlanChanges(date));
      reply.status(200).type("text/plain; charset=utf-8").send(`${text}${cover}${storedText}`);
    }
  });
}
