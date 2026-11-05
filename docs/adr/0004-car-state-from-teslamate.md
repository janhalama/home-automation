# 0004. Car state comes from TeslaMate

Date: 2026-10-25

Status: Accepted

## Context

The car must reach its own charge limit by 6 a.m. without a schedule in the Tesla app. A fresh plug-in charges when the wallbox is allowed to offer current, and the car stops at its own limit.

TeslaMate is already authorized for the Fleet API and publishes the state of charge, the charge limit, and whether the car is plugged in. A second Fleet API application would be another login on the same developer account. Commanding the car to start, stop, or set amps would duplicate the Wallbox Manager.

## Decision

The planner reads the car from TeslaMate. It uses the state of charge and the charge limit to compute the missing energy. It does not send charge commands or amp commands to the car. The wallbox permission is what starts the session.

## Consequences

The 6 a.m. target is the car's own limit, not a separate target stored in the house. Obluda is the first car. A later car needs its own state-of-charge source and the same wallbox rules.
