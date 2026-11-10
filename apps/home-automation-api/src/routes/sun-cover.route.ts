/*
Hourly forecast against the house, for the chart that shows when the sun covers demand.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CarPoint } from "../services/car-day.js";
import type { FetchImpl } from "../services/forecast-solar-client.js";
import type { HouseArchive } from "../services/house-archive.js";
import type { PredictionStore } from "../services/prediction-store.js";
import { heaterIsOn, HOUSE_LOAD_DAYS, houseKwByHour, houseLoadDates } from "../services/recent-house-load.js";
import { alignSunCover } from "../services/sun-cover.js";
import { addDays } from "../services/sun-clock.js";
import { rememberSunHours } from "../services/sun-hours.js";
import { chargeKwLookup } from "../services/teslamate-history.js";

export type SunCoverRouteDeps = {
  apiKey: string;
  archive: HouseArchive | null;
  predictionStore: PredictionStore | null;
  fetchImpl: FetchImpl;
  forecastSolarApiKey: string;
  timeoutMs: number;
  readCarDay: ((date: string) => Promise<CarPoint[]>) | null;
  readChargeKw: ((fromDate: string, untilDate: string) => Promise<(at: string) => number>) | null;
};

/* Refuse a call that has no server key or the wrong client key. */
function rejectUnauthorized(apiKey: string, request: FastifyRequest, reply: FastifyReply, queryApiKey?: string): boolean {
  if (!apiKey) {
    reply.status(503).send({ error: "server_misconfigured" });
    return true;
  }
  const header = request.headers["x-api-key"];
  const presented = typeof header === "string" ? header : queryApiKey;
  if (presented !== apiKey) {
    reply.status(401).send({ error: "unauthorized" });
    return true;
  }
  return false;
}

/* Register the sun-cover series the day chart draws. */
export function registerSunCoverRoute(app: FastifyInstance, deps: SunCoverRouteDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/sun-cover",
    schema: {
      querystring: Type.Object({
        date: Type.String(),
        apiKey: Type.Optional(Type.String())
      }, { additionalProperties: false })
    },
    handler: async (request, reply) => {
      const query = request.query as { date: string; apiKey?: string };
      if (rejectUnauthorized(deps.apiKey, request, reply, query.apiKey))
        return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
        reply.status(400).send({ error: "bad_request" });
        return;
      }
      if (!deps.archive || !deps.predictionStore) {
        reply.status(503).send({ error: "server_misconfigured" });
        return;
      }
      const archive = deps.archive;
      const store = deps.predictionStore;
      try {
        await rememberSunHours({
          store,
          fetchImpl: deps.fetchImpl,
          apiKey: deps.forecastSolarApiKey,
          timeoutMs: deps.timeoutMs,
          now: new Date()
        });
      } catch {
        // A stale forecast is still worth drawing.
      }
      const heatingPeriods = archive.listHeatingPeriodsOverlapping(
        `${addDays(query.date, -HOUSE_LOAD_DAYS)}T00:00:00`,
        `${query.date}T00:00:00`
      );
      const carChargeKw = await chargeKwLookup({
        dates: houseLoadDates(query.date, query.date),
        readChargeKw: deps.readChargeKw,
        readCarDay: deps.readCarDay
      });
      const demand = houseKwByHour({
        planDate: query.date,
        readDay: (day) => archive.listPowerSamples(day),
        tankOn: (at) => heaterIsOn(heatingPeriods, at),
        carChargeKw
      });
      reply.status(200).send(alignSunCover(store.listSunHours(query.date), demand));
    }
  });
}
