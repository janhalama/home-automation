# 0005. Buy the cheapest slot that finishes the job

Date: 2026-10-25

Status: Accepted

## Context

Spot prices decide which hours are worth buying. The PV forecast decides whether a purchase can wait. The missing energy decides how long the slot has to be. Charging starts when that period begins.

During daylight, a sunny tomorrow means grid charging runs only when the tank is short of hot water for the morning, or the battery is short of energy for the house until morning. The car's 6 a.m. deadline is before the next sun, so a charge the daylight will not finish is bought at night.

Inside a slot the tank keeps 2.5 kW, the car takes what remains of 17 kW, and battery charging above 20% is reduced first. The 20% floor is about 3.8 kWh of the 19 kWh battery and is kept for a grid failure. Once a month the battery is charged to 100% after the tank and the car are covered.

## Decision

The planner computes the energy still missing for three jobs, in this order: hot water for the morning, the car's charge limit by 6 a.m., then battery energy above 20%. Hot water for the morning and the car use the cheapest period that finishes before 6 a.m. A shorter cheap period is used when it is enough.

The home battery above 20% does not have that deadline. Its period is the cheapest one long enough for the missing energy, and that period may be in the daytime. Weekends and bank holidays are the days when the daytime price is often the cheap one, so the battery charges then. A weekday daylight period stays closed when tomorrow's forecast is enough and the tank and the battery already cover the morning. Surplus still follows the same order. The monthly charge to 100% is an extra job in a cheap slot after the tank and the 6 a.m. car.

## Consequences

ADR 0008 sizes how much the house buys for the battery. It does not pin that buy to the night. The upper tank sensor is required before "enough hot water" is trusted; until it is fitted, the bottom sensor is used and heating starts early.
