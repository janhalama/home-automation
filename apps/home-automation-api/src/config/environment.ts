/*
This module reads runtime environment variables for the home automation API.
It keeps deployment configuration in one place for route and service wiring.
*/

export type EnvironmentConfig = {
  apiKey: string;
  forecastSolarApiKey: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
};

/* Read API key configuration without crashing serverless startup. */
function readApiKey(value: string | undefined): string {
  return value?.trim() ?? "";
}

/* Parse a positive integer configuration value with fallback. */
function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value)
    return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error("Expected positive integer environment variable value");
  return parsed;
}

/* Build normalized environment configuration for the API runtime. */
export function readEnvironmentConfig(): EnvironmentConfig {
  const forecastSolarApiKey = process.env.FORECAST_SOLAR_API_KEY?.trim() ?? "";

  return {
    apiKey: readApiKey(process.env.HOME_AUTOMATION_API_KEY),
    forecastSolarApiKey,
    timeoutMs: readPositiveInt(process.env.FORECAST_SOLAR_TIMEOUT_MS, 8000),
    cacheTtlSeconds: readPositiveInt(process.env.CACHE_TTL_SECONDS, 3600)
  };
}
