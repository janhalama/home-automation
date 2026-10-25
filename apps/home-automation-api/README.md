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

TrueNAS Scale can run the API as a Docker container — no Raspberry Pi needed. Loxone calls the TrueNAS LAN IP over plain HTTP; the container calls forecast.solar over HTTPS.

**Requirements:** TrueNAS **Scale** (not Core) with Apps enabled.

### 1. Clone the repo on TrueNAS

Use the TrueNAS Shell or SSH. Pick a dataset path, e.g. `/mnt/tank/apps/home-automation`:

```bash
cd /mnt/tank/apps
git clone <your-repo-url> home-automation
cd home-automation
```

### 2. Set environment variables

Create `.env` in the repo root:

```bash
HOME_AUTOMATION_API_KEY=your-secret-key
FORECAST_SOLAR_API_KEY=
FORECAST_SOLAR_TIMEOUT_MS=8000
CACHE_TTL_SECONDS=3600
```

### 3. Start the container

From the repo root:

```bash
docker compose -f apps/home-automation-api/docker-compose.yml up -d --build
```

The API is published on host port **3001** (the process inside the container listens on 3000). Give TrueNAS a static IP (or DHCP reservation) on your LAN.

### 4. Test from your network

```bash
curl -sS "http://TRUENAS_IP:3001/api/pv/production-prediction?lat=50.6920036&lon=15.2203556&slope=45&eastAzimuth=-63&eastKwp=5.5&westAzimuth=113&westKwp=4.5&apiKey=YOUR_KEY"
```

### 5. Wire Loxone

| Input | Value |
| --- | --- |
| T1 | your API key |
| T2 | `TRUENAS_IP:3001` (no `http://`) |

Rebuild the Loxone script (`cmake --build build`) and paste `build/pv-production-prediction.bundled.c` into the PicoC block.

### TrueNAS Custom App (alternative)

Instead of Shell, use **Apps → Discover Apps → Custom App** and deploy the same `docker-compose.yml`, or build the image elsewhere:

```bash
docker build -f apps/home-automation-api/Dockerfile -t home-automation-api .
```

