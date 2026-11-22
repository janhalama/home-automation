# 0018. The wallbox is open before the car wakes

Date: 2026-11-22

Status: Accepted

## Context

On 22 November the plan booked Obluda from 02:30 to 03:45 at 11 kW. That was the cheapest run that still finished by 06:00 for the 13.5 kWh between 32% and the car's own 50% limit. The car was plugged into the inner wallbox and at home. It had been asleep since the previous afternoon. The tank and the house battery from that same plan both ran. The car took nothing.

The car did not wake, so the planner kept the missed window and added a later one every quarter-hour: 02:45, 03:00, 03:15, 03:30, 03:45, 04:00, 04:15, then the short pieces 05:30 and 05:45. At 06:05 the clock moved what was still missing to 22:45–24:00. Those quarter-hour moves were the missed charge. They were not a new price, a new battery reading, or a new need.

A Model Y on 2026.38.6 wakes itself when a charge schedule stored in the car reaches its start. If it wakes and the wallbox is offering no current, it goes back to sleep and does not try again. The October trial showed the same thing for a session that had already settled: power returning later does not start it. A fresh plug-in does.

ADR 0004 left the Tesla schedule alone and let the wallbox start the session. ADR 0009 says the same. That holds for a car that plugs in while the wallbox is already offering current. It does not hold for a car that was plugged in during the afternoon and then slept.

The follower turns the wallbox on at `carFrom` and off at `carTo`. Those clocks are the booked slot. If the car's schedule uses the same clocks, the car can wake in the same minute the wallbox opens, or a minute before it, and find no power.

## Decision

The booked slot stays the slot. The day stores it, the page draws it, and Tesla is given that slot. The wallbox is given the same slot opened fifteen minutes earlier and closed fifteen minutes later.

Fifteen minutes is one price quarter, which is the step the planner already uses. It covers the Miniserver's ten-minute poll and a car clock that is a few minutes off. The car's own schedule has not started during the early quarter, so the house does not buy that quarter unless the car ignores its schedule. The wallbox stays up for one quarter after Tesla's end, so a late wake still finds current.

A slot that would start before midnight opens at midnight. A slot that ends at midnight stays open until 00:15. A slot that already crosses midnight keeps that shape, with the same fifteen minutes on each side.

Tesla is told with `add_charge_schedule`, for this house's location, and only for a grid slot. The schedule is one-time. It does not repeat on a weekday. The cheap hour is different tomorrow, and a repeating clock would charge at today's time. A surplus slot and a battery slot stay on the wallbox alone. The start Tesla stores is the booked `carFrom`. The end it stores is the booked `carTo`. The API sends the command. TeslaMate does not.

The command goes out when that booked start is first chosen, and when a later poll books a different start for a reason other than the missed charge. The quarter-hour slides on 22 November are that missed charge. They update the house log and they do not write to the car. The 06:05 move to 22:45 is a new slot, after the morning deadline, and it does write.

The schedule is removed when the car no longer needs a charge, or when it leaves home. A schedule left in the car would hold a later plug-in until that clock.

The wallbox hours are the ones in `carFrom` and `carTo` of the text the Miniserver reads. The stored decision keeps the booked slot, so the day bar does not grow by the two quarters.

## Consequences

ADR 0004 still blocks `charge_start` and any amp command. The one command this house sends is the location schedule for the booked grid slot. ADR 0009's sentence that the Tesla schedule is left untouched applies until this command is wired. After that, the home grid slot is written to the car.

A failed write is logged. The wallbox plan still runs. The failure does not book a new slot.

The sentence on the page follows `carFrom` and `carTo`, so it names the wallbox hours. The bar follows the stored decision and names the booked slot.
