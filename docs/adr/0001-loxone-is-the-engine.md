# 0001. Loxone is the engine, and the API advises it

Date: 2026-10-25

Status: Accepted

## Context

The house has to decide when to buy electricity and who gets it: hot water first, then the car by 6 a.m., then the home battery above its 20% floor, all inside about 17 kW. Spot prices and the PV forecast decide whether a purchase can wait, and which slot is long enough.

Loxone already has those inputs in the Miniserver, and it already runs the Wattsonic, the tank, and the Wallbox Manager. The forecast value is filled by a PicoC call to the home-automation API. The car's state of charge and charge limit are in TeslaMate, on the NAS. The Miniserver is the device that stays up when the NAS does not.

A plan that exists only in the API leaves the house with no behavior when that call fails. The full slot choice is a poor fit for PicoC: it needs the car's missing energy from TeslaMate, and it needs to compare the night's prices. The local rules Loxone already runs are enough for a reduced night.

## Decision

Loxone is the engine that always runs. While a fresh plan is present, the scripts follow it: tank on or off, car charging allowed and a power cap in kW, battery hold, grid-charge above the floor, or the monthly charge to 100%.

The home-automation API is the advisor. It reads the same prices and forecast, adds the car from TeslaMate, chooses the cheapest slot that finishes the jobs, and writes that plan into Loxone.

When the plan is missing, or the price or the forecast has stopped updating, Loxone does not wait. It runs the limited mode in ADR 0007.

## Consequences

The scripts keep a local path. They do not become empty actuators. The advisor must not be required for the 20% floor, for heating a cold tank, or for a conservative car charge in a locally cheap hour. The clever slot, the daylight forecast gate, and the car's missing kWh belong to the advisor.
