# 0017. A heater run outside the plan is the house acting

Date: 2026-11-19

Status: Accepted

## Context

The day needs to show when the heater ran because the plan said so, and when it ran for some other reason. The house can heat because the plan says so, because someone switched it on, or because the tank is cold enough that the house heats it on its own.

The page can already see whether the heater was on. The house does not say which of those reasons it was. Waiting for that report would leave the two kinds of run looking the same.

The product note for this is `docs/2026-11-19-seeing-the-day-prd.md`. The stored tank hours come from ADR 0016.

## Decision

Compare the heater with the stored tank hours.

Heater time inside those hours belongs with the plan. Heater time outside those hours is shown as the house acting, not the plan. The page makes those two looks different. The line for the day says the house did it.

This step does not ask the house to name the control. It does not claim which switch it was.

## Consequences

A priority switch, a manual on, and heating a cold tank on the house's own rule look the same: the house acted. A later change can split them when the house reports which control it was. Until then, no new signal is required from the house.
