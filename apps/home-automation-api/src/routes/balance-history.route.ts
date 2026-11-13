/*
The last 30 days of grid money, for the chart beside the house reserve.
*/

import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { balanceHistory, BALANCE_HISTORY_DAYS } from "../services/balance-history.js";
import { czkPerEurOn, fetchCnbEurRates, type CnbResponse } from "../services/cnb-eur.js";
import type { FetchImpl } from "../services/forecast-solar-client.js";
import type { HouseArchive } from "../services/house-archive.js";
import { addDays } from "../services/sun-clock.js";

export type BalanceHistoryDeps = {
  apiKey: string;
  archive: HouseArchive | null;
  fetchImpl: FetchImpl;
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

/* Read ČNB text through the shared fetch, which only types a JSON body. */
async function readCnb(url: string, fetchImpl: FetchImpl): Promise<CnbResponse> {
  const response = await fetchImpl(url) as { ok: boolean; status: number; text?: () => Promise<string> };
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text?.() ?? Promise.resolve("")
  };
}

/* Register the balance history the page draws. */
export function registerBalanceHistoryRoute(app: FastifyInstance, deps: BalanceHistoryDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/balance-history",
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
      const start = addDays(query.date, -(BALANCE_HISTORY_DAYS - 1));
      let rates: Awaited<ReturnType<typeof fetchCnbEurRates>> = [];
      try {
        rates = await fetchCnbEurRates(addDays(start, -7), query.date, (url) => readCnb(url, deps.fetchImpl));
      } catch {
        rates = [];
      }
      const days = balanceHistory({
        endDate: query.date,
        readDay: (date) => archive.listPowerSamples(date),
        readPrices: (date) => archive.listSpotPrices(date),
        czkPerEur: (date) => czkPerEurOn(date, rates)
      });
      reply.status(200).send({ days });
    }
  });
}
