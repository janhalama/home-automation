# Reduces saved Wattsonic days to the two figures the house uses.
#
# Each day becomes a PV total and the grid energy imported from 18:00 to
# 06:00. Mornings are grouped by season and by low cloud from 06:00 to 11:00. A night with any import above 6 kW is set aside as a car night.
# Days without a cloud file are skipped. The production download can still
# be running; only files already on disk are read.

import json
from pathlib import Path

DAYS = Path("data/wattsonic/days")
CLOUDS = Path("data/open-meteo")
SEASONS = (
    ("winter", (12, 1, 2)),
    ("spring", (3, 4, 5)),
    ("summer", (6, 7, 8)),
    ("autumn", (9, 10, 11)),
)


# Loads hourly low cloud keyed by YYYY-MM-DDTHH:00.
def load_low_cloud():
    by_hour = {}
    for path in sorted(CLOUDS.glob("*-cloud-layers.json")):
        hourly = json.loads(path.read_text()).get("hourly", {})
        for stamp, low in zip(hourly.get("time", []), hourly.get("cloud_cover_low", [])):
            by_hour[stamp] = low
    return by_hour


# Integrates one power series between two clock times. Negative values can be kept.
def integrate(series, times, start, end, negative_only):
    total = 0.0
    peak = 0.0
    for left, right, t0, t1 in zip(series, series[1:], times, times[1:]):
        if t0 < start or t0 >= end:
            continue
        if not left or not right:
            continue
        raw_left = left.get("value")
        raw_right = right.get("value")
        if raw_left in (None, "") or raw_right in (None, ""):
            continue
        h0, m0, _s0 = (int(part) for part in t0.split(":"))
        h1, m1, _s1 = (int(part) for part in t1.split(":"))
        hours = ((h1 * 60 + m1) - (h0 * 60 + m0)) / 60
        if hours <= 0:
            continue
        a = float(raw_left)
        b = float(raw_right)
        if negative_only:
            a = min(a, 0.0)
            b = min(b, 0.0)
            peak = min(peak, a, b)
        total += (a + b) / 2 * hours
    if negative_only:
        return -total, -peak
    return total, peak


# Reads PV energy, evening-to-morning import, and whether a car-sized load was present.
def read_day(path):
    body = json.loads(path.read_text())["body"]
    labels = body["legend"]
    times = body["xaxis"]
    pv = integrate(body["data"][labels.index("PpvInput")], times, "00:00:00", "24:00:00", False)[0]
    evening, evening_peak = integrate(
        body["data"][labels.index("PmeterTotal")], times, "18:00:00", "24:00:00", True
    )
    night, night_peak = integrate(
        body["data"][labels.index("PmeterTotal")], times, "00:00:00", "06:00:00", True
    )
    return pv, evening + night, max(evening_peak, night_peak) >= 6


# Mean low cloud from 06:00 through 11:00. None when the morning is incomplete.
def morning_low_cloud(by_hour, day):
    values = []
    for hour in range(6, 12):
        value = by_hour.get(f"{day}T{hour:02d}:00")
        if value is not None:
            values.append(value)
    if len(values) < 4:
        return None
    return sum(values) / len(values)


# Maps a low-cloud percentage to the band used for the sun figure.
def band_name(low):
    if low < 20:
        return "clear"
    if low < 70:
        return "mixed"
    return "covered"


# Returns the middle value of a list.
def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


# Prints one median line when the group has any days.
def report(label, values):
    if not values:
        print(f"{label}  n=0")
        return
    print(f"{label}  n={len(values)}  median={median(values):.1f} kWh")


def main():
    by_hour = load_low_cloud()
    groups = {}
    nights = {}
    skipped = 0
    for path in sorted(DAYS.glob("*.json")):
        day = path.stem
        low = morning_low_cloud(by_hour, day)
        if low is None:
            skipped += 1
            continue
        pv, imported, car_night = read_day(path)
        month = int(day[5:7])
        season = next(name for name, months in SEASONS if month in months)
        key = (season, band_name(low))
        groups.setdefault(key, []).append(pv)
        if not car_night:
            nights.setdefault(season, []).append(imported)
    print(f"days without a cloud morning: {skipped}")
    print("PV from midnight to midnight")
    for season, _months in SEASONS:
        for band in ("clear", "mixed", "covered"):
            report(f"{season:8} {band:8}", groups.get((season, band), []))
    print("grid import from 18:00 to 06:00, car nights set aside")
    for season, _months in SEASONS:
        report(f"{season:8} overnight", nights.get(season, []))


if __name__ == "__main__":
    main()
