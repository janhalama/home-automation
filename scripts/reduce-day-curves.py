# Reduces saved Wattsonic days to the figures the house uses.
#
# Each day becomes a PV total and the grid energy imported from 18:00 to
# 06:00. Mornings are grouped by season and by low cloud from 06:00 to 11:00.
# A night with any import above 6 kW is set aside as a car night.
# Days without a cloud file are skipped for those two figures.
#
# House load is PV minus the meter plus the battery, so power the battery
# covers still counts. Daylight runs from sunrise to sunset at the house.
# Night is the dark hours of that same calendar day. A period with any house
# load or import of 6 kW or more is set aside. The reserve uses 14-day blocks
# from 1 January, and the last two days of the year stay with the block before.

import json
import math
from datetime import date
from pathlib import Path

DAYS = Path("data/wattsonic/days")
CLOUDS = Path("data/open-meteo")
LATITUDE = 50.6920036
LONGITUDE = 15.2203556
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


# Last Sunday of a month, the day Europe changes the clock.
def last_sunday(year, month):
    cursor = date(year, month, 31)
    while cursor.weekday() != 6:
        cursor = date.fromordinal(cursor.toordinal() - 1)
    return cursor


# Hours to add to UTC. The spring change is already in force at sunrise.
def prague_offset_hours(day):
    if last_sunday(day.year, 3) <= day < last_sunday(day.year, 10):
        return 2
    return 1


# Sunrise and sunset as local clock strings for one calendar day.
def sun_clocks(day):
    ordinal = day.timetuple().tm_yday
    longitude_hours = LONGITUDE / 15

    def utc_hours(t, rising):
        mean = (0.9856 * t) - 3.289
        ecliptic = (mean + 1.916 * math.sin(math.radians(mean)) + 0.020 * math.sin(math.radians(2 * mean)) + 282.634) % 360
        right_ascension = math.degrees(math.atan(0.91764 * math.tan(math.radians(ecliptic)))) % 360
        right_ascension += math.floor(ecliptic / 90) * 90 - math.floor(right_ascension / 90) * 90
        right_ascension /= 15
        sin_declination = 0.39782 * math.sin(math.radians(ecliptic))
        cos_declination = math.cos(math.asin(sin_declination))
        cos_hour = (math.cos(math.radians(90.833)) - sin_declination * math.sin(math.radians(LATITUDE))) / (
            cos_declination * math.cos(math.radians(LATITUDE))
        )
        cos_hour = max(-1.0, min(1.0, cos_hour))
        hour_angle = 360 - math.degrees(math.acos(cos_hour)) if rising else math.degrees(math.acos(cos_hour))
        return (hour_angle / 15 + right_ascension - (0.06571 * t) - 6.622 - longitude_hours) % 24

    offset = prague_offset_hours(day)

    def clock(hours):
        hours = (hours + offset) % 24
        hour = int(hours)
        minute = int(round((hours - hour) * 60))
        if minute == 60:
            hour = (hour + 1) % 24
            minute = 0
        return f"{hour:02d}:{minute:02d}:00"

    rise = utc_hours(ordinal + (6 - longitude_hours) / 24, True)
    sett = utc_hours(ordinal + (18 - longitude_hours) / 24, False)
    return clock(rise), clock(sett)


# One sample as a float. Missing points stay missing.
def sample_value(point):
    if not isinstance(point, dict):
        return None
    raw = point.get("value")
    if raw in (None, ""):
        return None
    return float(raw)


# Energy, peak power, and the share of the window that had samples.
def integrate_house(series, times, start, end):
    total = 0.0
    peak = 0.0
    covered = 0.0
    span = 0.0
    for left, right, t0, t1 in zip(series, series[1:], times, times[1:]):
        if t0 < start or t0 >= end:
            continue
        h0, m0, _s0 = (int(part) for part in t0.split(":"))
        h1, m1, _s1 = (int(part) for part in t1.split(":"))
        hours = ((h1 * 60 + m1) - (h0 * 60 + m0)) / 60
        if hours <= 0:
            continue
        span += hours
        if left is None or right is None:
            continue
        a = max(left, 0.0)
        b = max(right, 0.0)
        peak = max(peak, a, b)
        total += (a + b) / 2 * hours
        covered += hours
    complete = span > 0 and covered / span >= 0.8
    return total, peak, complete


# Fourteen-day block from 1 January. 30 and 31 December stay in the previous block.
def fortnight_index(day):
    slot = (day.timetuple().tm_yday - 1) // 14
    return min(slot, 25)


# House energy in daylight and in the dark, and whether a car-sized load was in each.
def read_house_day(path, day):
    body = json.loads(path.read_text())["body"]
    labels = body["legend"]
    times = body["xaxis"]
    series = {name: body["data"][labels.index(name)] for name in ("PpvInput", "PmeterTotal", "Battery_P")}
    house = []
    imported = []
    for index in range(len(times)):
        pv = sample_value(series["PpvInput"][index])
        meter = sample_value(series["PmeterTotal"][index])
        battery = sample_value(series["Battery_P"][index])
        if pv is None or meter is None or battery is None:
            house.append(None)
            imported.append(None)
            continue
        house.append(pv - meter + battery)
        imported.append(max(0.0, -meter))
    rise, sett = sun_clocks(day)
    day_kwh, day_peak, day_complete = integrate_house(house, times, rise, sett)
    early_kwh, early_peak, early_complete = integrate_house(house, times, "00:00:00", rise)
    late_kwh, late_peak, late_complete = integrate_house(house, times, sett, "24:00:00")
    import_day_peak = integrate_house(imported, times, rise, sett)[1]
    import_early_peak = integrate_house(imported, times, "00:00:00", rise)[1]
    import_late_peak = integrate_house(imported, times, sett, "24:00:00")[1]
    return {
        "day_kwh": day_kwh,
        "night_kwh": early_kwh + late_kwh,
        "day_complete": day_complete,
        "night_complete": early_complete and late_complete,
        "car_day": day_peak >= 6 or import_day_peak >= 6,
        "car_night": max(early_peak, late_peak) >= 6 or max(import_early_peak, import_late_peak) >= 6,
    }


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

    daylight = {}
    dark = {}
    fortnight_day = {}
    fortnight_night = {}
    for path in sorted(DAYS.glob("*.json")):
        day = date.fromisoformat(path.stem)
        month = day.month
        season = next(name for name, months in SEASONS if month in months)
        house = read_house_day(path, day)
        slot = fortnight_index(day)
        if house["day_complete"] and not house["car_day"]:
            daylight.setdefault(season, []).append(house["day_kwh"])
            fortnight_day.setdefault(slot, []).append(house["day_kwh"])
        if house["night_complete"] and not house["car_night"]:
            dark.setdefault(season, []).append(house["night_kwh"])
            fortnight_night.setdefault(slot, []).append(house["night_kwh"])
    print("house load, sunrise to sunset, car periods set aside")
    for season, _months in SEASONS:
        report(f"{season:8} daylight", daylight.get(season, []))
    print("house load during the dark hours, car periods set aside")
    for season, _months in SEASONS:
        report(f"{season:8} night", dark.get(season, []))
    print("house load by 14-day block from 1 January, car periods set aside")
    for slot in range(26):
        start = date(2025, 1, 1).toordinal() + slot * 14
        label = date.fromordinal(start).isoformat()[5:]
        report(f"{slot:2} {label} daylight", fortnight_day.get(slot, []))
        report(f"{slot:2} {label} night   ", fortnight_night.get(slot, []))


if __name__ == "__main__":
    main()
