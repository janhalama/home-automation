# Downloads hourly cloud height for the house from Open-Meteo.
#
# Each hour has the low, mid, and high cloud cover, visibility, and the
# weather code. Low cloud is the layer up to about 2 km. Pass one or more
# years on the command line. A year that is already on disk is left in place.

import json
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

HOST = "https://previous-runs-api.open-meteo.com/v1/forecast"
LATITUDE = "50.6920036"
LONGITUDE = "15.2203556"
OUTPUT_DIR = Path("data/open-meteo")
HOURLY = ",".join(
    [
        "cloud_cover_low",
        "cloud_cover_mid",
        "cloud_cover_high",
        "visibility",
        "weather_code",
    ]
)


# Downloads one calendar year, clipped at today when the year is still open.
def download_year(year):
    target = OUTPUT_DIR / f"{year}-cloud-layers.json"
    if target.exists() and target.stat().st_size > 1000:
        print(f"Keeping {target}", flush=True)
        return
    start = date(year, 1, 1)
    end = min(date(year, 12, 31), date.today())
    if start > end:
        raise SystemExit(f"{year} is still in the future")
    query = urllib.parse.urlencode(
        {
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "timezone": "Europe/Prague",
            "models": "icon_d2",
            "hourly": HOURLY,
        }
    )
    request = urllib.request.Request(HOST + "?" + query)
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.load(response)
    if payload.get("error"):
        raise SystemExit(payload.get("reason") or "Open-Meteo rejected the request")
    hours = payload.get("hourly", {}).get("time", [])
    if len(hours) < 24:
        raise SystemExit(f"Expected hourly data for {year}, received {len(hours)} hours")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload))
    print(f"Saved {len(hours)} hours to {target}", flush=True)


def main():
    years = [int(arg) for arg in sys.argv[1:]] or [2024]
    for year in years:
        download_year(year)


if __name__ == "__main__":
    main()
