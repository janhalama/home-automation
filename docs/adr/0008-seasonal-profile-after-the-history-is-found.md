# 0008. Seasonal behavior comes from the Wattsonic Cloud day history

Date: 2026-10-26

Status: Accepted

## Context

Consumption changes with the season. A summer night and a winter night do not need the same energy from the battery, and a sunny season does not need the same grid purchases as a dark one. The daylight rule and the size of the cheap slot both depend on that difference. One number for the whole year will buy too much in summer and too little in winter.

The Wattsonic is reached by Modbus through the Loxone extension. That path exposes live power and energy counters: today, the month, the year, and running totals. It does not provide an interval history.

The Wattsonic Cloud app, and the Solinteg cloud behind it, keep that history. A day view is PV power, battery power, grid power, and state of charge every five minutes. Day detail is still present for 2023, so the seasons from 2023 through 2026 are in the account. The web login issues a session token that the day-detail page already uses. The European portal sends it as a request header named `token` to `lb-eu.solinteg-cloud.com`, not as a Bearer token and not as a cookie. The station id is in the path. That header is enough to download the curves. It expires, so it is a pull credential, not a credential the planner keeps, and it is never written into the repository. The documented Solinteg Open API token is a separate, longer-lived access and is not required for this pull.

## Decision

The planner looks up two figures. The overnight figure is the grid energy the house imports from 18:00 to 06:00, with nights that draw more than 6 kW set aside. The expected PV figure is the day's PV total, looked up by season and by the low-cloud band for 06:00–11:00. Low cloud is the layer up to about 2 km. The bands are under 20%, 20–70%, and 70% or more.

These medians come from the saved days: all of 2024, and 2025 through 28 August. Autumn is mostly 2024.

Overnight import, median:

| Season | kWh |
| --- | --- |
| Winter | 7.3 |
| Spring | 0.8 |
| Summer | 0.7 |
| Autumn | 2.0 |

Expected PV, median kWh:

| Season | Clear | Mixed | Covered |
| --- | --- | --- | --- |
| Winter | 12.8 | 6.0 | 1.5 |
| Spring | 35.7 | 30.3 | 15.7 |
| Summer | 38.3 | 31.9 | 22.4 |
| Autumn | 21.7 | 14.3 | 4.6 |

The 20% floor stays 3.8 kWh and is not part of either figure. Energy above that floor is what can be spent before morning.

For the house, the cheap slot buys `max(0, overnight - aboveFloor)`. It buys a further `max(0, overnight - expectedPv)` when tomorrow's band will not refill that night. Hot water and the car are still separate jobs, ahead of this one. The tank script's single 20 kWh line is retired for this decision.

Tomorrow's band comes from the day-ahead low-cloud forecast. Until five stored forecast-versus-actual pairs exist for that season and band, expected PV is the median in the table. After that, expected PV is the median production of those stored pairs.

Limited mode does not use the profile. It uses the rules in ADR 0007.

## Consequences

The advisor can size the battery purchase from this table. The purchase itself can be a daytime period on a weekend or a bank holiday, as ADR 0005 describes. Autumn will move once September 2025 and later are in the reduction. The table is realized cloud, not the forecast that was issued, so the live day-ahead low cloud is what selects the column. A sunny-morning export of all PV, before charging, is a separate rule and is not in this decision.
