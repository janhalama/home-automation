# Downloads Wattsonic Cloud day curves for one inverter.
#
# The session token is read from WATTSONIC_TOKEN or from the repo-root .env.
# It is never printed and never written next to the downloaded days.
#
# Each day is the portal call
# /gen2api/pc/owner/inverter/power_generate/selective
# with dateType=DAY. That is the five-minute PV, battery, grid, and SOC curve.
#
# Pace stays slower than clicking through the portal. One run asks for a
# small number of missing days, waits between them, and stops for good on
# any limit or auth signal. It does not retry. Run it again later to continue.
# Days already saved are skipped and do not count as requests.

import json
import os
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

HOST = "https://lb-eu.solinteg-cloud.com"
ORIGIN = "https://new.wattsonic.cloud"
DEFAULT_SN = "5112300101230151"
OUTPUT_DIR = Path("data/wattsonic/days")
GAP_SECONDS = 8
REST_EVERY = 12
REST_SECONDS = 90
DEFAULT_LIMIT = 24
STOP_STATUSES = {401, 403, 429, 503}


# Reads the session token from the environment or the gitignored .env file.
def load_token():
    token = os.environ.get("WATTSONIC_TOKEN", "").strip()
    if token:
        return token
    env_path = Path(".env")
    if not env_path.exists():
        raise SystemExit("Set WATTSONIC_TOKEN or add it to .env. Do not pass it on the command line.")
    for line in env_path.read_text().splitlines():
        if line.startswith("WATTSONIC_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
            if token:
                return token
    raise SystemExit("WATTSONIC_TOKEN is missing from the environment and from .env.")


# Builds the headers the Wattsonic web portal sends with a session token.
def request_headers(token):
    return {
        "accept": "application/json, text/plain, */*",
        "lang": "cs_CZ",
        "odm": "WAT",
        "offset": "-60",
        "origin": ORIGIN,
        "plant": "admin",
        "referer": ORIGIN + "/",
        "requestid": str(uuid.uuid4()),
        "token": token,
        "var": "pc",
    }


# Performs one GET and returns the status code and response body.
# A timeout is a stop, not a retry.
def get_json(path, token):
    request = urllib.request.Request(HOST + path, headers=request_headers(token))
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (TimeoutError, urllib.error.URLError) as error:
        raise SystemExit(f"Stopped with no retry: {error}")


# Builds the day-curve path for one inverter and one calendar day.
def day_path(sn, day):
    query = urllib.parse.urlencode({"sn": sn, "date": day.isoformat(), "dateType": "DAY"})
    return "/gen2api/pc/owner/inverter/power_generate/selective?" + query


# A portal system exception is one bad day, not a reason to abandon the year.
def is_system_exception(body):
    text = body.decode("utf-8", errors="replace")
    return "error.0000" in text or "Systémová výjimka" in text


# Stops the run when the portal refuses the session or asks us to slow down.
def limit_signal(status, body):
    if status in STOP_STATUSES:
        return True
    text = body.decode("utf-8", errors="replace").lower()
    phrases = ("too many", "too frequent", "rate limit", "throttl", "频繁", "请求过于", "invalid token", "token expire", "unauthorized")
    if any(phrase in text for phrase in phrases):
        return True
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return True
    if payload.get("successful") is False:
        return True
    error_code = payload.get("errorCode")
    if error_code is not None and str(error_code) not in {"0", "200"}:
        return True
    code = payload.get("code", payload.get("status"))
    if code is None:
        return False
    return str(code) not in {"0", "200"}


# Waits between calls. A longer rest lands after every small batch.
def wait_after(saved):
    if saved % REST_EVERY == 0:
        print(f"Resting {REST_SECONDS}s after {saved} requests.", flush=True)
        time.sleep(REST_SECONDS)
        return
    time.sleep(GAP_SECONDS)


# Downloads one JSON file per day, up to the request cap. Saved days are skipped.
def download_range(sn, start, end, token, limit):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    day = start
    saved = 0
    while day <= end and saved < limit:
        target = OUTPUT_DIR / f"{day.isoformat()}.json"
        if target.exists() and target.stat().st_size > 20:
            day += timedelta(days=1)
            continue
        status, body = get_json(day_path(sn, day), token)
        if is_system_exception(body):
            print(f"Server exception on {day.isoformat()}, waiting 60s for one retry.", flush=True)
            time.sleep(60)
            status, body = get_json(day_path(sn, day), token)
            if is_system_exception(body):
                print(f"Skipped {day.isoformat()} after a second system exception.", flush=True)
                day += timedelta(days=1)
                time.sleep(GAP_SECONDS)
                continue
        if limit_signal(status, body):
            snippet = body[:180].decode("utf-8", errors="replace")
            raise SystemExit(f"Stopped on {day.isoformat()} ({status}) with no retry: {snippet}")
        target.write_bytes(body)
        saved += 1
        print(day.isoformat(), len(body), flush=True)
        day += timedelta(days=1)
        if day <= end and saved < limit:
            wait_after(saved)
    print(f"Saved {saved} new days in {OUTPUT_DIR}. Run again later to continue.", flush=True)


# Parses a YYYY-MM-DD argument.
def parse_day(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def main():
    args = sys.argv[1:]
    start = date(2023, 1, 1)
    end = date.today()
    sn = os.environ.get("WATTSONIC_INVERTER_SN", DEFAULT_SN).strip()
    limit = DEFAULT_LIMIT
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--from":
            start = parse_day(args[index + 1])
            index += 2
            continue
        if arg == "--to":
            end = parse_day(args[index + 1])
            index += 2
            continue
        if arg == "--sn":
            sn = args[index + 1]
            index += 2
            continue
        if arg == "--limit":
            limit = int(args[index + 1])
            index += 2
            continue
        raise SystemExit(f"Unknown argument {arg}")
    if start > end:
        raise SystemExit("--from is after --to")
    if limit < 1:
        raise SystemExit("--limit must be at least 1")
    token = load_token()
    download_range(sn, start, end, token, limit)


if __name__ == "__main__":
    main()
