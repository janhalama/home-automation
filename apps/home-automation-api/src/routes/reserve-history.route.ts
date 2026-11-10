/*
The last 30 days of the house reserve, for the chart that replaced the flat 50% line.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FetchImpl } from "../services/forecast-solar-client.js";
import type { HouseArchive } from "../services/house-archive.js";
import { fetchMorningLowCloudSpan } from "../services/open-meteo-cloud-client.js";
import type { CarPoint } from "../services/car-day.js";
import { heaterIsOn, HOUSE_LOAD_DAYS } from "../services/recent-house-load.js";
import { reserveHistory } from "../services/reserve-history.js";
import { chargeKwLookup } from "../services/teslamate-history.js";
import { addDays } from "../services/sun-clock.js";

const HOUSE = { lat: 50.6920036, lon: 15.2203556 };
const HISTORY_DAYS = 30;

export type ReserveHistoryDeps = {
  apiKey: string;
  archive: HouseArchive | null;
  fetchImpl: FetchImpl;
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

/* Register the reserve history the page draws. */
export function registerReserveHistoryRoute(app: FastifyInstance, deps: ReserveHistoryDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/reserve-history",
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
      if (!deps.archive) {
        reply.status(503).send({ error: "server_misconfigured" });
        return;
      }
      const archive = deps.archive;
      const clouds = await fetchMorningLowCloudSpan(
        HOUSE.lat,
        HOUSE.lon,
        addDays(query.date, -(HISTORY_DAYS - 1)),
        query.date,
        deps.fetchImpl
      );
      const heatingPeriods = archive.listHeatingPeriodsOverlapping(
        `${addDays(query.date, -(HISTORY_DAYS - 1 + HOUSE_LOAD_DAYS))}T00:00:00`,
        `${addDays(query.date, 1)}T00:00:00`
      );
      const carDates = Array.from(
        { length: HISTORY_DAYS - 1 + HOUSE_LOAD_DAYS },
        (_, index) => addDays(query.date, -(index + 1))
      );
      const carChargeKw = await chargeKwLookup({
        dates: carDates,
        readChargeKw: deps.readChargeKw,
        readCarDay: deps.readCarDay
      });
      const days = reserveHistory({
        endDate: query.date,
        readDay: (day) => archive.listPowerSamples(day),
        morningCloud: (day) => clouds.get(day) ?? null,
        tankOn: (at) => heaterIsOn(heatingPeriods, at),
        carChargeKw
      });
      reply.status(200).send({ days });
    }
  });
}
