# Energy management

Product definition for the house. This is the set of outcomes. The system design comes after these are agreed.

## Why

The house has to decide when to buy electricity and who gets the power. Hot water, the car, and the home battery can run at the same time, and they have to stay inside the main breaker. Hot water comes first because the house needs it.

## What changes at home

1. Hot water is kept up before the car and before charging the home battery above its floor.
2. The car reaches its own charge limit by 6 a.m. without a schedule in the Tesla app. Its charging power is limited so the house stays under the main breaker.
3. The home battery is not emptied into the car. On the grid it stays at or above 20%. Charging it above that floor waits until the tank and the car are satisfied.
4. Either car can use either wallbox. The Wallbox Manager still sets the amps. The new logic only decides whether a wallbox is off, allowed to use surplus, or allowed to use the grid.
5. A second car can take a turn later.

## Power

The main breaker is 3×25 A, about 17 kW from the grid. The tank heater is 2.5 kW. The home battery is 19 kWh.

## Hot water

The tank holds about 200 l. It has one temperature sensor at the bottom, and it will get a second sensor of the same type in the upper part, near the hot outlet. Hot water sits above cold water, so the bottom sensor reads cold while a lot of hot water remains at the top. The upper sensor shows whether there is enough hot water for the morning. The bottom sensor shows when the tank has been heated all the way through.

Hot water, the car, and battery charging may run together. When the sum would pass 17 kW, battery charging above the floor is reduced first. The car is limited next. The tank keeps its 2.5 kW.

The phases are already well distributed. The cars and the home battery charge on three phases. The tank is on one phase. Its 2.5 kW does not need its own phase schedule. The limit to plan against is the 17 kW total.

## When to buy from the grid

Spot prices decide which hours are worth buying. The PV forecast decides whether a purchase can wait. The amount still missing decides how long a slot has to be.

Charging starts when the chosen low-price period begins. Hot water for the morning and the car’s charge limit use the cheapest period that finishes before 6 a.m. The home battery above its floor is charged only after those two are covered, in the cheapest period long enough for the missing energy. That period may be in the daytime. On weekends and bank holidays the daytime price is often the cheap one, and the battery charges then. A shorter cheap slot is used when it is enough. A longer one is used only when the shorter ones cannot finish the job.

On a weekday, during daylight, if tomorrow will be sunny enough, grid charging runs only when the tank does not already hold enough hot water for the morning, or the battery does not already hold enough energy for the house until morning. Stored energy that covers the morning is left for the sun. A weekend or bank holiday daytime period that is the cheap one remains a charging period for the battery.

If tomorrow will not be sunny enough, the cheap spot-price hours are used to fill what the sun will not cover. The car still has to be at its charge limit by 6 a.m., which is before that next sun, so its charge is bought in the cheap hours of the night when today's sun will not finish it.

## Season

Summer and winter do not use the same night-time energy, and they do not get the same sun. The overnight figure is the house's grid import from 18:00 to 06:00. The expected PV figure depends on the season and on how much low cloud the morning has. The medians from 2024 and from 2025 through August are in ADR 0008. A quiet winter night is about 7.3 kWh. A quiet summer night is about 0.7 kWh. A covered winter day produces about 1.5 kWh. A clear summer day produces about 38 kWh. The single 20 kWh line is retired for this decision.

## Battery reserve

20% of 19 kWh is about 3.8 kWh. That energy stays in the battery during normal running so it is there if the grid fails. It is not spent on the car or the tank.

Once a month the battery is charged to 100%. That charge uses a cheap slot, after the tank and the 6 a.m. car are covered.

## Architecture

The build decisions are in `docs/adr/`. evcc is not part of the system. Loxone is the engine that always runs, including a limited mode when the price, the forecast, or the NAS is missing. The home-automation API advises it with the cheapest slot when those inputs are fresh.
