# 0010. A house charge clears 2 Kč, a trade clears 3 Kč

Date: 2026-11-08

Status: Accepted

## Context

The battery purchase in ADR 0008 was sized from overnight grid import. That import misses the hours the battery itself runs the house. House load on a saved Wattsonic day is PV power, minus the meter, plus the battery. The meter is negative while the grid sends power in. The battery is positive while it is emptying. A night that imports 2 kWh can still be a 6 kWh night once the battery's share is counted.

A season is too coarse for that load. Daylight at the house runs from about 04:46 to 21:16 on 21 June and from about 07:59 to 15:56 on 21 December. One week, after car-sized loads are set aside, often has only two or three quiet days, so the median jumps. Fourteen days still has a median. The fortnights on either side of a clock change moved by about 1 kWh, and an ordinary step from one fortnight to the next is about 2.6 kWh, so the clock change does not get a block of its own.

A charge from the grid wears the pack and loses energy on the round trip. The pack already bought was helped by a state grant, so that invoice is not the cost of a future cycle. The cost is a replacement at today's lower shelf price. A GoodWe Lynx 15 kWh stack at 129,541 Kč is about 8,600 Kč per kWh. Nineteen kilowatt-hours at that rate is about 164,000 Kč. WattMatic rates the chemistry at 8,000 cycles to 70% health, at 90% depth of discharge and 25°C. Lifetime energy back out of this pack is 19 × 0.9 × 8,000 = 136,800 kWh, which is 1.2 Kč per kWh delivered. A 90% round trip at a cheap hour of 2.5 Kč/kWh adds about 0.3 Kč. A bought cycle needs a gap above 1.5 Kč/kWh before it pays for the battery.

The house is going to buy the energy it still needs. A trade is optional. One solar cycle a day for ten years is about 3,650 cycles and stays inside 8,000. A second full cycle every day spends the rest.

## Decision

House load is read from the saved days in blocks of 14 days from 1 January. The 30th and 31st of December stay in the last block. Daylight of each day is sunrise to sunset at the house. Night is the dark hours of that same calendar day. A day or a night that reaches 6 kW of house load or of import is set aside. The medians, in kWh:

| From | Daylight | Night |
| --- | --- | --- |
| 1 Jan | 5.0 | 14.3 |
| 15 Jan | 5.8 | 13.3 |
| 29 Jan | 7.7 | 9.1 |
| 12 Feb | 6.6 | 9.3 |
| 26 Feb | 11.4 | 7.7 |
| 12 Mar | 11.6 | 9.1 |
| 26 Mar | 13.9 | 6.7 |
| 9 Apr | 9.7 | 5.8 |
| 23 Apr | 15.5 | 4.8 |
| 7 May | 16.5 | 3.2 |
| 21 May | 18.9 | 3.4 |
| 4 Jun | 18.6 | 2.6 |
| 18 Jun | 15.0 | 2.9 |
| 2 Jul | 12.6 | 2.7 |
| 16 Jul | 15.7 | 2.8 |
| 30 Jul | 10.5 | 2.9 |
| 13 Aug | 8.3 | 3.4 |
| 27 Aug | 10.9 | 3.5 |
| 10 Sep | 9.2 | 5.0 |
| 24 Sep | 10.0 | 4.9 |
| 8 Oct | 10.6 | 8.2 |
| 22 Oct | 9.2 | 8.8 |
| 5 Nov | 7.8 | 13.8 |
| 19 Nov | 3.5 | 9.9 |
| 3 Dec | 3.0 | 13.9 |
| 17 Dec | 6.1 | 10.5 |

The reserve is the 20% outage floor plus the night, plus the part of the daylight the expected sun will not cover. The night stays in the reserve because the sun is down then, and the house still has to draw from the battery while the grid is on. Expected sun is still the seasonal PV table in ADR 0008. The reserve is capped at 100%.

An expensive hour is one whose price is more than 2 Kč/kWh above the cheapest hour in the prices the slot may use. House energy in those hours uses the fortnight's daylight figure across that day's sunrise-to-sunset, and the night figure across the dark hours.

The planner keeps two battery purchases.

The house charge buys the expensive-hour load that the expected sun will not make and that the energy already above the 20% floor does not already hold. It runs when the gap is above 2 Kč/kWh. The slot is the cheapest run long enough, as in ADR 0005, and it may cross midnight.

The trading charge buys the empty room up to a full pack that the expected sun will not fill. It runs when the gap is at least 3 Kč/kWh. When both charges want energy, the plan buys the larger of the two.

The rate that turns EUR/MWh into Kč/kWh stays 25 Kč per euro. Two crowns is 80 EUR/MWh. Three crowns is 120 EUR/MWh.

## Consequences

ADR 0008 still supplies expected PV, and its overnight import table remains the record of grid import. The battery purchase size in ADR 0008 is replaced by the two charges above. ADR 0005 still chooses the clock of the slot. Limited mode is unchanged.

A covered fortnight in early November needs about 21.6 kWh before the sun is subtracted from the daylight, so the reserve sits near the top of the pack when that sun is small. A clear day leaves the night above the 20% floor. It does not bring the reserve back to the floor, because that would leave the house nothing to draw while the grid is on.

The 2 Kč gate leaves about 0.5 Kč after wear and the round trip. The 3 Kč gate leaves about 1.5 Kč, which is the gain required before an optional cycle. A replacement that is dearer than 8,600 Kč/kWh would make the 2 Kč house charge the one that stops paying.
