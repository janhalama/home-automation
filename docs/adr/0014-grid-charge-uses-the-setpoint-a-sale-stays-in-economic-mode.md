# 0014. A grid charge uses the setpoint, a sale stays in economic mode

Date: 2026-11-17

Status: Accepted

## Context

On the morning of 17 November the plan bought energy for the house battery from 03:30 to 05:15. The battery power stayed at 0 kW. The program running through that night charged in economic mode and wrote a percent into the period power limit. That register does not set kilowatts. The same program had set the on-grid end SOC to the live state of charge, which tells the inverter the target is already reached.

Register 50207 is the battery power setting. It is valid in mode 771, EMS battery control, and the scale is 100. A negative value charges. At 21:49 a setpoint of -200, with the end SOC held at 100%, took about 2 kW from the grid. The script caps that command at 6 kW.

A positive value on the same register is not, by itself, a discharge. Mode 771 also needs the export ceiling on 50208 and the import floor on 50209. This block does not drive those registers. A sale sent as mode 771 with a setpoint of +200, while the period limit was still 80%, charged the battery at about 10 kW. That is 80% of the inverter's 12 kW, not the 2 kW setpoint.

The discharge that exported before is economic mode. The period is marked discharge, grid injection is allowed, the setpoint stays 0, and the end-SOC register sits below the battery. On 25 October, with that floor at 10% and the battery at 19.8%, battery power went positive at about 0.5 to 0.8 kW. The percent still did not set the kilowatts. The end-SOC register is the level the inverter sits at. A floor above the live state of charge makes economic mode charge toward it. A reserve of 0 is a missing reading and stays the old 50% line. A reserve the battery has already reached does not sell.

On the evening of 17 November the battery was already at the 20% outage floor. The economic sale ran, the text said "Discharging to grid", and the power stayed at 0 kW.

## Decision

A grid charge uses mode 771 and a negative setpoint on register 50207. The end SOC stays at 100% for the charge, then just under the live state of charge for 20 seconds, so the pack does not immediately empty what it just bought.

A sale stays in economic mode. Register 50207 stays 0. The sale runs only while the battery is above the plan reserve, and the end-SOC register is that reserve. The period is enabled for the whole day and marked discharge. Grid injection stays allowed.

## Consequences

The next planned grid charge uses the command that took 2 kW on 17 November. A sale no longer charges the pack up to the reserve. It also does not deliver a chosen number of kilowatts, and it does nothing while the battery is already sitting on the floor.
