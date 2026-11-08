/*
The car day the page draws. The route only answers.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pragueTimestamp } from "../services/house-collector.js";
import type { CarPoint } from "../services/car-day.js";

export type CarDayRouteDeps = {
  apiKey: string;
  readCarDay: ((date: string) => Promise<CarPoint[]>) | null;
  readChargeLimit: (() => Promise<number | null>) | null;
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

/* The current charge limit. A failed reading leaves the history on the chart. */
async function readTodayLimit(readChargeLimit: (() => Promise<number | null>) | null): Promise<number | null> {
  if (!readChargeLimit)
    return null;
  try {
    const limitPercent = await readChargeLimit();
    return Number.isFinite(limitPercent) ? limitPercent : null;
  } catch {
    return null;
  }
}

/* Register the car chart series. */
export function registerCarDayRoute(app: FastifyInstance, deps: CarDayRouteDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/car",
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
        reply.status(400).send({ error: "The date is not a day." });
        return;
      }
      if (!deps.readCarDay) {
        reply.status(200).send({ date, configured: false, points: [], chargeLimitPercent: null });
        return;
      }
      try {
        const points = await deps.readCarDay(date);
        const today = pragueTimestamp(new Date()).slice(0, 10);
        const chargeLimitPercent = date === today ? await readTodayLimit(deps.readChargeLimit) : null;
        reply.status(200).send({ date, configured: true, points, chargeLimitPercent });
      } catch (error) {
        request.log.error({ err: error }, "car history was not read");
        reply.status(200).send({ date, configured: false, points: [], chargeLimitPercent: null });
      }
    }
  });
}
