# Energy plan

Date: 2026-10-27

Loxone pulls a fresh plan from the home-automation API, the same way it already pulls the PV forecast. The API chooses the slot. The program block writes the result into the Miniserver. The existing scripts follow it only while the plan is fresh. When the call fails, they keep the limited mode in ADR 0007.

## What the API reads

TeslaMate on the NAS publishes Obluda on MQTT, broker `mosquitto` on the `ix-teslamate_default` network, car id 1. The API reads three retained values: `usable_battery_level`, `charge_limit_soc`, and `plugged_in`. It sends nothing to the car.

Missing energy is `max(0, charge limit − usable level) / 100 × 75 kWh`. The 75 kWh is this Model Y. A reading that cannot be made leaves the car line as `limited`, and Loxone keeps its own car rule.

The tank is 200 l and the heater is 2.5 kW. The target is 55°C. The equipment can reach 65°C, and that higher figure is not the target. Energy is `200 × 4.186 × (55 − measured) / 3600` kWh. The slot is that energy divided by 2.5 kW, rounded up to the next 15 minutes. A tank at 55°C or above is off. A missing temperature leaves the tank line as `limited`.

The home battery uses the seasonal table. Energy already above the 20% floor is `(state of charge − 20) / 100 × 19 kWh`. The grid purchase is `houseGridKwh`. The charge rate used to size the slot is 3 kW, the 30% cap the inverter script already applies on the 10 kW inverter. Morning low cloud selects the seasonal column. When that cloud cannot be read, the battery line is `hold`.

## What the plan says

Hot water and the car take the cheapest period that finishes by 06:00. The period is the shortest one that can finish the job. A longer one is used only when the shorter ones cannot.

The tank keeps 2.5 kW. The car charges at 11 kW, which is the limit of the Tesla and of both wallboxes. Another 1 kW stays free for the household. 1 + 2.5 + 11 is 14.5 kW, inside the 17 kW breaker, so the tank does not slow the car. When the tank and the car are both on, the battery charges at 2.5 kW instead of 3 kW, because 1 + 2.5 + 11 + 3 would be 17.5 kW. An unplugged car, or a car with nothing missing, is off. The Wallbox Manager still turns the cap into amps. The plan does not write a manual current.

The battery has no 06:00 deadline. Its period is the cheapest one long enough for `houseGridKwh`, and that period may be in the daytime. When the seasonal table asks for nothing, the battery line is `hold`. The monthly charge to 100% is not in this version.

The plain-text body Loxone already knows how to parse:

```
tank=1
tankFrom=01:00
tankTo=02:30
car=0
carKw=0
battery=hold
```

`tank` and `car` are `1`, `0`, or `limited`. `battery` is `grid-charge` or `hold`, with `batteryFrom` and `batteryTo` when it charges. A `limited` line means the script keeps the rule it already has.

## What stays unchanged until Config

The route only answers. The heater and the wallboxes keep their current logic until the program block is loaded and its outputs are connected. evcc stays up. No Tesla developer application is created.
