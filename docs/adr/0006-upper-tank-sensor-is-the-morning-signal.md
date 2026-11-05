# 0006. The upper tank sensor is the morning signal

Date: 2026-10-25

Status: Accepted

## Context

The tank holds about 200 l and is heated by a 2.5 kW element on one phase. It has one temperature sensor at the bottom. Hot water sits above cold water, so that sensor reads cold while a lot of hot water remains at the top. The morning decision needs to know whether usable hot water is still there. The bottom reading is still the sign that the tank has been heated all the way through.

## Decision

A second sensor of the same type is added in the upper part of the tank, near the hot outlet. The planner treats the upper temperature as "enough hot water for the morning". The bottom temperature says the tank is heated through. The heater is turned on or off by the planner. The existing tank script stops choosing from price and forecast on its own.

## Consequences

Until the upper sensor is fitted, the bottom sensor is the only input and the tank will be heated sooner than it needs. After it is fitted, a draw during the night that cools the top starts heating again inside the rules of ADR 0005.
