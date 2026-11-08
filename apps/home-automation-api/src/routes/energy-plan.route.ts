/*
The plan Loxone pulls. The route only answers. It does not switch the heater.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { formatErrorResponse } from "../lib/plain-text-response.js";
import { carJobFromReading, type CarReading } from "../services/car-energy.js";
import { buildEnergyPlan, formatEnergyPlan } from "../services/energy-plan.js";
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
  fetchImpl: FetchImpl;
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

/* State of charge for this plan. A future day uses the last sample from before it. */
function socPercentFor(archive: HouseArchive, date: string): number | null {
  const sameDay = archive.listPowerSamples(date).at(-1);
  if (sameDay)
    return sameDay.socPercent;
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

/* Energy already produced today. Each stored sample stands for one quarter-hour. */
function producedPvKwh(samples: { pvKw: number }[]): number {
  return samples.reduce((sum, sample) => sum + Math.max(0, sample.pvKw) * 0.25, 0);
}

/* Kilowatt-hours already stored above the 20% floor. */
function aboveFloorKwh(socPercent: number | null): number | null {
  if (socPercent === null)
    return null;
  return Math.max(0, socPercent - FLOOR_PERCENT) / 100 * BATTERY_KWH;
}

/* Register the plan Loxone pulls once a day. */
export function registerEnergyPlanRoute(app: FastifyInstance, deps: EnergyPlanDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/plan",
    schema: {
      querystring: Type.Object({
        date: Type.Optional(Type.String()),
        apiKey: Type.Optional(Type.String())
      }, { additionalProperties: false })
    },
    handler: async (request, reply) => {
      const query = request.query as { date?: string; apiKey?: string };
      if (rejectUnauthorized(deps.apiKey, request, reply, query.apiKey))
        return;
      const date = query.date ?? pragueTimestamp(new Date()).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        reply.status(400).type("text/plain; charset=utf-8").send(formatErrorResponse("bad_request"));
        return;
      }
      if (!deps.archive) {
        reply.status(503).type("text/plain; charset=utf-8").send(formatErrorResponse("server_misconfigured"));
        return;
      }
      const prices = deps.archive.listSpotPrices(date);
      if (prices.length === 0) {
        reply.status(200).type("text/plain; charset=utf-8").send(formatErrorResponse("missing_price"));
        return;
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
      const pvRemainingKwh = expectedPv === null
        ? null
        : Math.max(0, expectedPv - producedPvKwh(deps.archive.listPowerSamples(date)));
      const today = pragueTimestamp(new Date()).slice(0, 10);
      const tomorrowDate = pragueDate(new Date(), 1);
      const tomorrowCloud = date === today
        ? await fetchMorningLowCloud(HOUSE.lat, HOUSE.lon, tomorrowDate, deps.fetchImpl)
        : null;
      const tomorrowPvKwh = tomorrowCloud === null ? null : expectedPvKwh(seasonOf(tomorrowDate), cloudBand(tomorrowCloud));
      const heating = deps.archive.latestHeating();
      const plan = buildEnergyPlan({
        prices,
        tomorrowPrices: date === today ? deps.archive.listSpotPrices(pragueDate(new Date(), 1)) : [],
        startAt: date === today ? pragueClock(new Date()) : null,
        bottomTemperatureC: heating?.temperatureC ?? null,
        aboveFloorKwh: aboveFloorKwh(socPercentFor(deps.archive, date)),
        socPercent: socPercentFor(deps.archive, date),
        season,
        lowCloudPercent: lowCloud,
        pvRemainingKwh,
        tomorrowPvKwh: date === today ? tomorrowPvKwh : null,
        car
      });
      reply.status(200).type("text/plain; charset=utf-8").send(formatEnergyPlan(plan));
    }
  });
}
