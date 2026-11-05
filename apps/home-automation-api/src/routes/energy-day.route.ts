/*
Serves one day's energy score from the OTE archive and a Wattsonic day curve.
*/

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { formatErrorResponse } from "../lib/plain-text-response.js";
import { scoreDay } from "../services/day-score.js";
import { renderDayPage, renderMissingDay } from "../services/energy-day-page.js";
import type { HouseArchive } from "../services/house-archive.js";
import type { PredictionStore } from "../services/prediction-store.js";
import { forecastDeviation } from "../services/pv-forecast-learning.js";
import { seasonOf } from "../services/seasonal-profile.js";
import { samplesFromWattsonicDay } from "../services/wattsonic-day.js";

export type EnergyDayDeps = {
  apiKey: string;
  archive: HouseArchive | null;
  wattsonicDaysDir: string;
  predictionStore: PredictionStore | null;
};

const querySchema = Type.Object(
  {
    date: Type.String(),
    lowCloud: Type.Number(),
    apiKey: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

/* Register the day page. Missing prices stay a sentence on the page. */
export function registerEnergyDayRoute(app: FastifyInstance, deps: EnergyDayDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/day",
    schema: { querystring: querySchema },
    handler: async (request, reply) => {
      const query = request.query as { date: string; lowCloud: number; apiKey?: string };
      const headerApiKey = request.headers["x-api-key"];
      if (!deps.apiKey) {
        reply.status(503).type("text/plain; charset=utf-8").send(formatErrorResponse("server_misconfigured"));
        return;
      }
      const presented = typeof headerApiKey === "string" ? headerApiKey : query.apiKey;
      if (presented !== deps.apiKey) {
        reply.status(401).type("text/plain; charset=utf-8").send(formatErrorResponse("unauthorized"));
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
        reply.status(400).type("text/html; charset=utf-8").send(renderMissingDay(query.date, "The date is not a day."));
        return;
      }
      if (!deps.archive || !deps.wattsonicDaysDir) {
        reply.status(503).type("text/html; charset=utf-8").send(renderMissingDay(query.date, "The archive is not configured."));
        return;
      }

      const prices = deps.archive.listSpotPrices(query.date);
      if (prices.length === 0) {
        reply.status(200).type("text/html; charset=utf-8").send(renderMissingDay(query.date, "The price for this day is missing."));
        return;
      }

      let samples;
      try {
        const payload = JSON.parse(readFileSync(join(deps.wattsonicDaysDir, `${query.date}.json`), "utf8"));
        samples = samplesFromWattsonicDay(payload);
      } catch {
        reply.status(200).type("text/html; charset=utf-8").send(renderMissingDay(query.date, "The day curve is missing."));
        return;
      }

      const score = scoreDay({
        date: query.date,
        season: seasonOf(query.date),
        lowCloudPercent: query.lowCloud,
        prices,
        samples,
        tankPeriods: deps.archive.hasHeatingHistory() ? deps.archive.listHeatingPeriods(query.date) : null
      });
      const completed = deps.predictionStore?.listCompleted() ?? [];
      const deviation = forecastDeviation(
        completed.flatMap((day) =>
          day.actualKwh === null || day.lowCloud === null
            ? []
            : [{ forecastKwh: day.forecastKwh, actualKwh: day.actualKwh, lowCloud: day.lowCloud }]
        )
      );
      reply.status(200).type("text/html; charset=utf-8").send(renderDayPage(query.date, score, deviation));
    }
  });
}
