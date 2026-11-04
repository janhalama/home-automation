# 0009. The car plan follows the car while it is at home

Date: 2026-11-03

Status: Accepted

## Context

Obluda is driven during the day. One drive can change the energy still missing by tens of kilowatt-hours inside an hour. The night slot has to be built again from that reading, in time for the charge that must finish by the next 6 a.m.

The car also leaves home. On a trip it may be plugged in somewhere else, and a slot on this house's prices would buy energy the house cannot deliver. A vacation switch has to be turned on before leaving and turned off after coming back. TeslaMate already has a geofence named Home.

The car keeps its own schedule. That schedule started the charge on the evening of 3 November. The planner does not replace it until Loxone is pulling the plan and the wallbox permission follows that plan.

ADR 0004 still supplies the state of charge and the charge limit. The cable is no longer what decides whether a slot exists.

## Decision

Every plan request reads Obluda again from TeslaMate: usable charge, charge limit, whether the cable is in, and the geofence name. The missing energy is the gap from the usable charge up to the car's own limit, as in ADR 0004.

The car line is on when the geofence name is Home and the missing energy is above zero. The cable is recorded for the chart and is not required for the slot. Any other geofence name, including an empty one, leaves the car line off. A reading that does not arrive leaves the car line `limited`.

The slot is the cheapest contiguous run of quarter-hours that starts at or after the next quarter and ends at or before the next 06:00. The run may cross midnight. It uses the delivery-day prices of the quarters it touches. A calendar day other than Prague today does not receive this live car. Its car line is off, because that night's missing energy was not stored.

The plan text stays the clocks and the power. It does not contain the geofence name. The reader does not subscribe to latitude or longitude.

While the dashboard is showing Prague today, it loads the plan again at least every hour.

## Consequences

A drive home with a lower battery replaces the slot on the next reading. A car outside Home produces no charge plan, including on a cable somewhere else. The Tesla schedule is untouched by this decision. The wallbox still starts the session only when a later program block writes the plan through, as in ADR 0001 and ADR 0003.
