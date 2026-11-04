# 0003. The Wallbox Manager keeps the amps

Date: 2026-10-25

Status: Accepted

## Context

Two Loxone wallboxes sit under the Wallbox Manager. Either car can use either box. The cars and the home battery use three phases. The tank is on one phase at 2.5 kW. The phases are already balanced, so the limit to plan against is the 17 kW total, not a per-phase schedule.

The manager assigns the amps from `Pmax` and `Peco`. A direct manual limit takes that job away from the manager. The trial also showed that Off / Eco / Priority cannot be the interface: Priority has no working command, and Eco does not stick on the inner wallbox while its enable input is driven by the old logic.

The plug is visible on the wallbox block output `Vc`. The state named `connected` stays 0 while `Vc` is 1, which is the lamp the Loxone app shows.

## Decision

The planner sets two numbers for the car: whether charging is allowed, and the power cap in kW. The cap is what remains of 17 kW after the house and the tank's 2.5 kW. The Wallbox Manager turns that cap into amps. The old eco script stops being the decider.

Which box has the car is read from `Vc`. If both boxes show a car at once and the cars cannot be told apart, the planner does not guess.

## Consequences

Nothing writes inverter registers from the car path, and nothing writes a manual wallbox limit. Replacing the eco script's enable output is required before the inner wallbox will follow the planner. A second car later is another `Vc` plus a state of charge, with the same cap shared across the boxes.
