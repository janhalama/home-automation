# 0007. Loxone keeps a limited mode without external inputs

Date: 2026-10-25

Status: Accepted

## Context

The Miniserver is the device that remains when the NAS, the forecast fetch, or TeslaMate is down. Spot price and the PV forecast are inputs Loxone already holds, but both are refreshed from outside. A stuck low price must not be treated as a fresh buy signal. The car's state of charge is not in Loxone, so a limited mode cannot know how many kWh are missing before 6 a.m.

The outcomes that must survive are: hot water is not left cold, the battery is not taken below the outage floor, and the battery is not emptied into the car.

## Decision

Limited mode is the path when there is no fresh plan, or the spot price or the forecast has stopped updating.

- The battery stays at the 20% on-grid floor. It is not grid-charged above that floor, and it is not discharged into the car. The monthly charge to 100% waits for a fresh plan.
- The tank heats when its sensor is below the hard low threshold. Price and forecast are not consulted for that heat.
- The car may charge only while the spot price is still updating and is in the local cheap band. The power cap leaves the tank's 2.5 kW inside the 17 kW total. The car stops at its own charge limit. Surplus can still be offered from the local PV power reading, which is a meter on the Miniserver.
- A price or a forecast that has stopped updating is missing. It is not used as a reason to buy.

## Consequences

A night in limited mode can miss the single cheapest slot, and it cannot promise the car reaches its limit by 6 a.m. after a late plug-in. It does keep hot water, the outage reserve, and a bounded car charge. The upper tank sensor, once fitted, is the sensor for the hard low threshold. Until then the bottom sensor is used, and heating starts earlier.
