# home-automation-api

Fastify API for home automation integrations. It runs on the LAN so Loxone can call it over plain HTTP. The first endpoint is PV production prediction.

## Endpoint

```text
GET /api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5
X-API-Key: <pre-shared-key>
```

Success response (`200`):

```text
today=12.340
tomorrow=17.000
```

Error responses use HTTP status codes (`400`, `401`, `502`, `503`, `504`) with optional plain-text bodies such as `error=unauthorized`.

If Loxone cannot send custom headers, pass `apiKey=<pre-shared-key>` as a query parameter instead.

## Local Development

From the repository root:

```bash
pnpm install
cp .env.example .env
pnpm api:dev
```

Local development loads environment variables from:

1. `.env` in the repository root
2. `apps/home-automation-api/.env` (optional override)

Test the endpoint:

```bash
curl -sS \
  -H "X-API-Key: your-secret-key" \
  "http://localhost:3000/api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5"
```

## Scripts

```bash
pnpm api:dev
pnpm api:test
pnpm api:build
pnpm --filter home-automation-api typecheck
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HOME_AUTOMATION_API_KEY` | yes | — | Pre-shared key for Loxone requests to **your** API |
| `FORECAST_SOLAR_API_KEY` | no | empty | **Leave empty on the free tier.** forecast.solar free access needs no API key (today + tomorrow, hourly data). Only set this if you have a paid subscription with a valid key. |
| `FORECAST_SOLAR_TIMEOUT_MS` | no | `8000` | Upstream request timeout in milliseconds |
| `CACHE_TTL_SECONDS` | no | `3600` | Cache-Control `s-maxage` for successful responses |
| `PORT` | no | `3000` | Port the API process listens on |

## Loxone Integration

Loxone PicoC `httpget` supports plain HTTP only. Run this API on the LAN (for example TrueNAS Scale) and wire the script inputs:

| Input | Example | Purpose |
| --- | --- | --- |
| I1 | trigger | Fetch on event |
| T1 | your API key | `HOME_AUTOMATION_API_KEY` |
| T2 | `192.168.1.50:3001` | TrueNAS IP and port (no `http://`) |

Test from your network before deploying to Loxone:

```bash
curl -sS "http://192.168.1.50:3001/api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5&apiKey=YOUR_KEY"
```

Build the bundled script for Loxone Config:

```bash
cmake -B build -S . && cmake --build build
```

Copy `build/pv-production-prediction.bundled.c` into the PicoC program block.

The script treats HTTP `200` as success and parses `today=` / `tomorrow=` from the plain-text body.

## TrueNAS Scale Deployment

The house NAS already runs this API as the custom app `home-automation-api` on port **3001**. The Home automation page is a second container on port **4321**. Secrets stay in `/mnt/Data/apps/home-automation/.env` on the NAS and are not copied by the scripts.

From the repo root:

```bash
pnpm deploy:api
pnpm deploy:app
```

`deploy:api` rebuilds `home-automation-api:1.0.0` and recreates that custom app. Loxone's forecast call is down for the few seconds of the recreate. `deploy:app` publishes the page at `http://192.168.1.3:4321`.

Heater samples start once `LOXONE_HOST`, `LOXONE_USER`, and `LOXONE_PASSWORD` are in the NAS `.env`. Spot prices are stored without them.

Check the API from the LAN:

```bash
curl -sS "http://192.168.1.3:3001/api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5&apiKey=YOUR_KEY"
```

Loxone still calls `192.168.1.3:3001`. The PicoC inputs stay T1 = API key and T2 = `192.168.1.3:3001`.
