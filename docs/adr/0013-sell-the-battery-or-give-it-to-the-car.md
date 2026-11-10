# 0013. Sell the battery, or give it to the car

Date: 2026-11-08

Status: Accepted

## Context

Energy above the house reserve has two uses. Obluda can take it, which saves a purchase at the night price. The same kilowatt-hour can be sold at the day's peak. Both paths discharge the pack once, so the wear is the same. The sale earns the peak price. The car path is worth only the night price it avoids.

The difference is the gap. ADR 0010 already requires 3 Kč/kWh before an optional cycle, which leaves about 1.5 Kč after wear and the round trip. A smaller gap does not pay for selling energy the car could have used. Once the peak has passed, the sale is gone and the battery is the cheaper source for the car.

The reserve itself is not part of the choice. The house keeps it. Only the energy above that line moves.

## Decision

When the day's peak is still ahead and it is at least 3 Kč/kWh above the cheapest hour, the plan sells the pack down to the reserve and buys Obluda from the grid in the cheap hour. Direct sun still charges the car when the day covers the house and the car, and then the sale still stands.

When the gap is under 3 Kč/kWh, or the peak has already passed, Obluda takes the house battery at 6 kW down to the reserve, and that energy is not sold.

## Consequences

A wide day no longer spends the tradable half of the pack on the car. The car is bought at the cheap hour instead, at 11 kW. A narrow day, and any hour after the peak, keeps today's battery charge. The house reserve is unchanged.
