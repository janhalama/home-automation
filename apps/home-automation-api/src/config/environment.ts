/*
This module reads runtime environment variables for the home automation API.
It keeps deployment configuration in one place for route and service wiring.
*/

export type EnvironmentConfig = {
  apiKey: string;
  forecastSolarApiKey: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  predictionDbPath: string;
  houseArchivePath: string;
  wattsonicDaysDir: string;
  loxoneHost: string;
  loxoneUser: string;
  loxonePassword: string;
  teslamateMqttHost: string;
  teslamateDatabaseHost: string;
  teslamateDatabaseUser: string;
  teslamateDatabasePassword: string;
  teslamateDatabaseName: string;
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
    cacheTtlSeconds: readPositiveInt(process.env.CACHE_TTL_SECONDS, 3600),
    predictionDbPath: process.env.PREDICTION_DB_PATH?.trim() ?? "",
    houseArchivePath: process.env.PREDICTION_DB_PATH?.trim() ?? "",
    wattsonicDaysDir: process.env.WATTSONIC_DAYS_DIR?.trim() ?? "",
    loxoneHost: process.env.LOXONE_HOST?.trim() ?? "",
    loxoneUser: process.env.LOXONE_USER?.trim() ?? "",
    loxonePassword: process.env.LOXONE_PASSWORD ?? "",
    teslamateMqttHost: process.env.TESLAMATE_MQTT_HOST?.trim() ?? "",
    teslamateDatabaseHost: process.env.TESLAMATE_DATABASE_HOST?.trim() ?? "",
    teslamateDatabaseUser: process.env.TESLAMATE_DATABASE_USER?.trim() ?? "",
    teslamateDatabasePassword: process.env.TESLAMATE_DATABASE_PASSWORD ?? "",
    teslamateDatabaseName: process.env.TESLAMATE_DATABASE_NAME?.trim() ?? ""
  };
}
