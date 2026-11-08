# The battery or the tank

Research note, 5 November 2026. Not a decision, and nothing here is implemented.

## What the current plan does

On the night of 5 November the tank bottom was 16°C. The plan for Friday 6 November heats it from 01:15 to 05:00, about 9.4 kWh at 2.5 kW, up to 55°C. Those hours cost about 235 EUR/MWh.

The inverter is in general mode during that slot. It is not a grid charge and it is not a sale. General mode covers the heater from the home battery until the 20% floor, and only then from the grid. At 23:35 the battery was at 52%, about 6 kWh above the floor of the 19 kWh pack. The heater would take that 6 kWh, the house would take some of it too, and the grid would finish the tank.

That spends the battery while the grid is cheap, and arrives at the morning with the battery on its floor.

## Friday's prices

The night slot is the cheap one. The early morning is not. The highest prices are later, after the sun is up.

| Hours | About, EUR/MWh |
| --- | --- |
| 01:00–05:00, the tank slot | 235 |
| 06:00–08:00 | 303–325 |
| 11:00–13:00 | 237–240 |
| 15:45–16:00, the day's maximum | 398 |

The issued forecast for Friday is about 15.6 kWh. That is a decent autumn day, not a clear one. The midday price is as low as the night. If the sun shows up, the house does not need the battery at 16:00. It needs the battery from about 06:00 until the sun covers the house.

A morning reserve is justified on this Friday. A reserve held for the 16:00 peak is not, unless the sun fails.

## The rule to test

One plan, rebuilt through the day from three forecasts.

Production is the PV forecast for the rest of today and for tomorrow.

House consumption is the repeating load with the car's charging taken out of the history. In autumn the quiet overnight house is about 2 kWh. That is the load the battery is for.

The car is not part of that forecast. It is added only when Obluda is at home, connected, and short of its own charge limit. Away, unplugged, or already at the limit, the car term is zero. A night with an empty car at the wallbox is a different day from a night with no car, and a mixed history is wrong for both. The car is bought in its own cheap slot, or from surplus. It does not spend the battery kept for the house.

The 20% floor stays. No tank heat and no car charge takes the battery down to it.

Above the floor, hold the house forecast for the next stretch that is actually more expensive than the tank's cheap slot, and only until the sun is forecast to cover the house. If that stretch is not expensive, do not hold the battery for it.

Heat the tank from the grid in the cheap slot. Do not let the battery cover that heater while the battery is being held.

If tomorrow is sunny, energy above the hold and above the floor may go into the tank, because the sun replaces it. If tomorrow is not sunny, the battery is not spent on the tank.

Heating the tank from the sun during the day is the surplus path. It loses to the battery covering the house through a real price spike.

## What Friday would do under that rule

The 06:00–08:00 price is about 80 EUR/MWh above the night slot, and the sun is not up yet. Hold the battery for the house through that morning. Buy the tank's 9.4 kWh from the grid at 01:15. Do not follow general mode down to 20%. The 16:00 peak is left to the sun unless the forecast drops.

## Projects that already solve this shape

EMHASS plans the battery and a hot-water load together from a PV forecast, a load forecast, and the prices, and it can refuse to go below a minimum state of charge. Predbat does the battery side from the same kinds of forecasts and can freeze the battery during cheap import so the grid covers the house. Neither knows this Miniserver. The useful part is the shape: one optimization, two forecasts, the car added only when it is actually a load.
