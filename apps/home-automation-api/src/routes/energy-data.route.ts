/*
JSON the energy view loads: one aligned day, and the forecast Loxone is given now.
*/

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { formatErrorResponse } from "../lib/plain-text-response.js";
import { czkPerEurOn, fetchCnbEurRates, type CnbResponse } from "../services/cnb-eur.js";
import { scoreDay } from "../services/day-score.js";
import { alignEnergyDay, tankTemperatureClocks } from "../services/energy-series.js";
import type { ForecastClientDeps } from "../services/forecast-solar-client.js";
import type { HouseArchive } from "../services/house-archive.js";
import { pragueTimestamp } from "../services/house-collector.js";
import { monthSoFar, type MonthSoFar } from "../services/month-so-far.js";
import { fetchMorningLowCloud } from "../services/open-meteo-cloud-client.js";
import type { PredictionStore } from "../services/prediction-store.js";
import { aggregatePvPrediction } from "../services/pv-production-aggregator.js";
import { forecastDeviation } from "../services/pv-forecast-learning.js";
import { seasonOf } from "../services/seasonal-profile.js";
import { addDays } from "../services/sun-clock.js";
import { samplesFromWattsonicDay } from "../services/wattsonic-day.js";

const HOUSE = {
  lat: 50.6920036,
  lon: 15.2203556,
  slope: 45,
  eastAzimuth: -63,
  eastKwp: 5.5,
  westAzimuth: 113,
  westKwp: 4.5
};

export type EnergyDataDeps = {
  apiKey: string;
  archive: HouseArchive | null;
  wattsonicDaysDir: string;
  forecastClientDeps: ForecastClientDeps;
  predictionStore: PredictionStore | null;
};

const seriesQuery = Type.Object(
  {
    date: Type.String(),
    lowCloud: Type.Optional(Type.Number()),
    apiKey: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

/* Accept the same key the prediction route already requires. */
function isAuthorized(apiKey: string, request: FastifyRequest, queryApiKey: string | undefined): boolean {
  const header = request.headers["x-api-key"];
  const presented = typeof header === "string" ? header : queryApiKey;
  return presented === apiKey;
}

/* Refuse a call that has no server key or the wrong client key. */
function rejectUnauthorized(apiKey: string, request: FastifyRequest, reply: FastifyReply, queryApiKey?: string): boolean {
  if (!apiKey) {
    reply.status(503).type("application/json; charset=utf-8").send(formatErrorResponse("server_misconfigured"));
    return true;
  }
  if (!isAuthorized(apiKey, request, queryApiKey)) {
    reply.status(401).type("application/json; charset=utf-8").send(formatErrorResponse("unauthorized"));
    return true;
  }
  return false;
}

/* Minutes after midnight from HH:MM:SS. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":");
  return Number(hour) * 60 + Number(minute);
}

/* Middle price. An even count uses the mean of the two middle prices. */
function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1)
    return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/* Read ČNB text through the shared fetch, which only types a JSON body. */
async function readCnb(url: string, fetchImpl: ForecastClientDeps["fetchImpl"]): Promise<CnbResponse> {
  const response = await fetchImpl(url) as { ok: boolean; status: number; text?: () => Promise<string> };
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text?.() ?? Promise.resolve("")
  };
}

/* This month's purchases and sales, and the sun already measured today. */
async function readMonthOverview(deps: EnergyDataDeps, today: string): Promise<MonthSoFar> {
  const empty = { importCzk: null, exportCzk: null, productionKwh: null };
  if (!deps.archive)
    return empty;
  const archive = deps.archive;
  const start = `${today.slice(0, 7)}-01`;
  let rates: Awaited<ReturnType<typeof fetchCnbEurRates>> = [];
  try {
    rates = await fetchCnbEurRates(addDays(start, -7), today, (url) => readCnb(url, deps.forecastClientDeps.fetchImpl));
  } catch {
    rates = [];
  }
  return monthSoFar({
    today,
    readDay: (date) => archive.listPowerSamples(date),
    readPrices: (date) => archive.listSpotPrices(date),
    czkPerEur: (date) => czkPerEurOn(date, rates)
  });
}

/* Register the series and the live driving-state routes. */
export function registerEnergyDataRoutes(app: FastifyInstance, deps: EnergyDataDeps): void {
  app.route({
    method: "GET",
    url: "/api/energy/series",
    schema: { querystring: seriesQuery },
    handler: async (request, reply) => {
      const query = request.query as { date: string; lowCloud?: number; apiKey?: string };
      if (rejectUnauthorized(deps.apiKey, request, reply, query.apiKey))
        return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
        reply.status(400).send({ error: "The date is not a day." });
        return;
      }
      if (!deps.archive) {
        reply.status(503).send({ error: "The archive is not configured." });
        return;
      }

      const prices = deps.archive.listSpotPrices(query.date);
      const heating = deps.archive.hasHeatingHistory() ? deps.archive.listHeatingPeriods(query.date) : [];
      const missing: string[] = [];
      if (prices.length === 0)
        missing.push("price");
      if (!deps.archive.hasHeatingHistory())
        missing.push("tank");

      const stored = deps.archive.listPowerSamples(query.date);
      let samples: ReturnType<typeof samplesFromWattsonicDay> = stored.map((sample) => ({
        time: sample.at.slice(11),
        pvKw: sample.pvKw,
        meterKw: sample.meterKw,
        batteryKw: sample.batteryKw,
        socPercent: sample.socPercent
      }));
      if (samples.length === 0 && deps.wattsonicDaysDir) {
        try {
          const payload = JSON.parse(readFileSync(join(deps.wattsonicDaysDir, `${query.date}.json`), "utf8"));
          samples = samplesFromWattsonicDay(payload);
        } catch {
          missing.push("curve");
        }
      } else if (samples.length === 0)
        missing.push("curve");
      if (samples.length === 0 && !missing.includes("curve"))
        missing.push("curve");

      const points = alignEnergyDay({
        date: query.date,
        prices,
        samples,
        heating,
        temperatures: tankTemperatureClocks(deps.archive.listHeatingTemperatures(query.date), heating, query.date)
      });
      const lowCloud = query.lowCloud !== undefined
        ? query.lowCloud
        : await fetchMorningLowCloud(HOUSE.lat, HOUSE.lon, query.date, deps.forecastClientDeps.fetchImpl);
      const score = lowCloud !== null && prices.length > 0 && samples.length > 0
        ? scoreDay({
            date: query.date,
            season: seasonOf(query.date),
            lowCloudPercent: lowCloud,
            prices,
            samples,
            tankPeriods: deps.archive.hasHeatingHistory() ? heating : null
          })
        : null;
      const completed = (deps.predictionStore?.listCompleted() ?? []).flatMap((day) =>
        day.actualKwh === null || day.lowCloud === null
          ? []
          : [{ forecastKwh: day.forecastKwh, actualKwh: day.actualKwh, lowCloud: day.lowCloud }]
      );
      const deviation = forecastDeviation(completed);

      reply.status(200).send({ date: query.date, points, heating, missing, score, deviation });
    }
  });

  app.route({
    method: "GET",
    url: "/api/energy/live",
    schema: {
      querystring: Type.Object({ apiKey: Type.Optional(Type.String()) }, { additionalProperties: false })
    },
    handler: async (request, reply) => {
      const query = request.query as { apiKey?: string };
      if (rejectUnauthorized(deps.apiKey, request, reply, query.apiKey))
        return;

      let todayKwh: number | null = null;
      let tomorrowKwh: number | null = null;
      let forecastError: string | null = null;
      try {
        const prediction = await aggregatePvPrediction(HOUSE, deps.forecastClientDeps);
        todayKwh = prediction.todayKwh;
        tomorrowKwh = prediction.tomorrowKwh;
      } catch {
        forecastError = "The forecast Loxone is given could not be read.";
      }

      const stamp = pragueTimestamp(new Date());
      const date = stamp.slice(0, 10);
      const clock = stamp.slice(11);
      const prices = deps.archive?.listSpotPrices(date) ?? [];
      const price = prices.find((item) => {
        const [start, end] = item.periodInterval.split("-");
        const at = minutes(clock);
        const startMinutes = minutes(start);
        let endMinutes = minutes(end);
        if (endMinutes <= startMinutes)
          endMinutes += 24 * 60;
        return at >= startMinutes && at < endMinutes;
      });
      const latest = deps.archive?.latestHeating() ?? null;
      const latestPower = deps.archive?.latestPowerSampleBefore(addDays(date, 1)) ?? null;
      const month = await readMonthOverview(deps, date);

      reply.status(200).send({
        todayKwh,
        tomorrowKwh,
        forecastError,
        heatingOn: latest?.heatingOn ?? null,
        tankTemperatureC: latest?.temperatureC ?? null,
        heatingSampleAt: latest?.at ?? null,
        priceEurPerMwh: price?.eurPerMwh ?? null,
        priceInterval: price?.periodInterval ?? null,
        medianEurPerMwh: prices.length === 0 ? null : median(prices.map((item) => item.eurPerMwh)),
        socPercent: latestPower?.socPercent ?? null,
        monthImportCzk: month.importCzk,
        monthExportCzk: month.exportCzk,
        todayProductionKwh: month.productionKwh
      });
    }
  });
}
