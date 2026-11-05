# 0002. evcc is not part of the system

Date: 2026-10-25

Status: Accepted

## Context

evcc is built to decide when a car may charge. It picks cheap hours from a tariff, uses a solar forecast, and aims at a charge limit by a deadline. That is the car half of this house. It also sets the wallbox current, and it can run the home battery and the grid meter. A second car is the case where that car logic earns its keep.

This house cannot hand evcc the current. The tank keeps 2.5 kW, the car gets what remains of about 17 kW, and the home battery is reduced first. The hours required depend on that leftover power. evcc's plan assumes it is the thing setting the amps. The trial had to ignore those amp writes so the Wallbox Manager would keep them. A plan computed at the wrong power finishes at the wrong time.

The trial on 25 October 2026 also showed the wallbox interface evcc expects is not available. Surplus-only works on the outer wallbox. The grid-allowed mode has no working command. The same allow command on the inner wallbox is accepted and does not change the manager. The car's charge and limit are already published by TeslaMate.

The battery half does not fit either. The 20% floor is an on-grid end state of the Wattsonic, kept for a power cut, and a grid charge has to move that end state or the inverter delivers no power. A monthly charge to 100% is a calendar job after the tank and the car. evcc's battery control is a price ceiling and a second writer on the same inverter.

Hot water is the first claim on power. evcc does not know that the bottom sensor reads cold while the top of the tank is still hot, or that a sunny tomorrow cancels a daylight purchase when the tank and the battery already cover the morning.

Keeping evcc as a display still leaves it a writer of wallbox modes. Two writers on the wallboxes is the failure the trial was meant to avoid.

## Decision

evcc is not part of the system. The planner in ADR 0001 chooses the slot and the car's power cap. TeslaMate remains the record of the car. The Wallbox Manager remains the source of the amps.

## Consequences

The cheap-hour choice for one car is code we own, next to the forecast the API already fetches. The evcc app on the NAS is a spike and comes down when the planner is the writer of the wallbox permission. No Tesla developer application is created for evcc.

evcc would be the right tool for a house whose only planned load is a car, on a wallbox evcc is allowed to drive directly. That is not this house.
