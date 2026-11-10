# 0012. Weekend daylight is a separate reserve input

Date: 2026-11-08

Status: Accepted

## Context

ADR 0011 reads house load from the last 14 days. Those 14 days hold ten workdays and four weekend days, so the median is a workday. The saved curves, with anything that reached 6 kW set aside, do not support using that median for a Saturday or a Sunday.

Daylight, median kWh:

| Season | Monday–Friday | Saturday–Sunday | Difference |
| --- | --- | --- | --- |
| Winter | 4.9 | 9.7 | +4.8 |
| Spring | 13.6 | 15.6 | +2.0 |
| Summer | 12.8 | 13.2 | +0.5 |
| Autumn | 7.7 | 13.3 | +5.6 |

Friday sits with Monday–Thursday. Saturday and Sunday are the high pair, about 11 kWh of daylight against 7–8 kWh on a weekday across the whole record. The nights differ by less than 1 kWh in every season, so a separate night series would not move the reserve.

Five kilowatt-hours is about a quarter of the 19 kWh pack. A winter or autumn Saturday planned from workdays would keep too little.

A single fortnight holds only four weekend days, and several of those are set aside with the car. Eight weekends are sixteen days, which is enough to find five quiet ones in a normal stretch.

## Decision

The daylight inside the reserve follows the calendar day of that daylight. Saturday and Sunday use Saturday and Sunday. Monday to Friday use Monday to Friday. The night stays the mixed 14 days from ADR 0011.

A workday figure is the median of the quiet weekdays in the 14 completed days before that daylight. A weekend figure is the median of the quiet Saturdays and Sundays in the previous eight weekends. A day that reaches 6 kW of house load or of import is set aside, as before.

When the chosen side has fewer than five quiet days, the plan uses the seasonal daylight median above for that side.

The house charge uses this same daylight figure. The trading charge does not.

## Consequences

A Saturday in the heating season keeps about 5 kWh more daylight in the reserve than the Friday before it. Summer barely changes. A new device that runs on weekends only enters the weekend figure after a few weekends, on the same delay ADR 0011 gives a device that runs every day. The night prediction is untouched.
