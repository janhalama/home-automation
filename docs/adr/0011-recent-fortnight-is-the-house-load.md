# 0011. The plan reads the last 14 days of house load

Date: 2026-11-08

Status: Accepted

## Context

ADR 0010 sizes the reserve and the house charge from a fixed table, one median for each fortnight of the year. That table is the house as it was. A new device, a heater, or a change in how the house is lived in does not appear until the same fortnight has been lived again and the table is rebuilt.

The plan only has to cover the coming night and the coming daylight. Those hours are the same season as the days just past. Across the saved Wattsonic days, a trailing window moved like this from one week to the next:

| Window | Typical step | Worst step | Quiet days | Quiet nights |
| --- | --- | --- | --- | --- |
| 7 days | 3.3 kWh | 17.4 kWh | 4 | 6 |
| 14 days | 1.8 kWh | 8.2 kWh | 8 | 11 |
| 21 days | 1.3 kWh | 7.0 kWh | 11 | 17 |
| 28 days | 1.1 kWh | 6.4 kWh | 14 | 23 |

Seven days is too thin once car-sized loads are set aside. Twenty-eight days is steadier, and a new steady load takes the whole month to fill the window. Fourteen days takes a new load in about two weeks. On the saved days, an extra 4 kWh by day and 4 kWh by night starting 1 November 2025 was fully inside the 14-day median by 15 November.

The archive already stores the same three powers every 15 minutes: PV, meter, and battery. The meter is negative while the grid sends power in. The battery is negative while it is charging. House load is PV minus the meter plus the battery, as in ADR 0010.

A year-shaped table plus an offset from recent days was the other way to keep both the seasons and a new device. The coming night does not need a table of next July. The offset would be a second source for a period the last fortnight already is.

## Decision

The planner's night consumption is the median of the quiet nights in the 14 completed days before the plan date. Daylight in the reserve is chosen by ADR 0012, because a Saturday and a Sunday use more than a workday while the night does not. Daylight is sunrise to sunset at the house. Night is the dark hours of that day. A day or a night that reaches 6 kW of house load or of import is set aside. The samples are the quarter-hour archive rows.

The reserve is the 20% outage floor plus the night, plus the part of that daylight the expected sun will not cover. The house charge in ADR 0010 uses the same two figures for the expensive hours. The trading charge is unchanged.

When a side has fewer than five quiet periods in those 14 days, that side uses the fortnight table in ADR 0010. Five is below the eight quiet days and eleven quiet nights a 14-day window usually has, so a car-heavy stretch does not rest on two days.

## Consequences

A device that stays on shows up in the reserve and the house charge within two weeks, and it leaves on the same delay once it is switched off. A weekend of guests moves the median less than the mean would. An empty house lowers the prediction while the empty days fill the window.

ADR 0010 still holds the price gaps, the wear figure, and the yearly table. The table is no longer the first source for the night. ADR 0012 chooses the daylight. ADR 0008 still supplies expected PV. The seasonal day and night figures stay in the code only until this trailing fortnight is what the plan reads.
