# Energy management spikes

Research log for the October 2026 charging work. Findings are recorded as each spike is run. Decisions below are what the spikes have shown so far, not a finished design.

## Direction

evcc owns when the cars may charge. Loxone and the home-automation API own the house: the Wattsonic inverter, the hot-water tank, spot prices, and the PV forecast.

The two Loxone wallboxes stay under the Wallbox Manager. Either car can use either wallbox. evcc sets a wallbox to Off, Eco, or Priority. The Wallbox Manager keeps `Pmax` and `Peco` and is the only thing that assigns amps. evcc does not write Wattsonic registers.

## What is already on the network

Checked from the home LAN on 25 October 2026.

| System | Address | What we found |
| --- | --- | --- |
| TrueNAS | `192.168.1.3` | SSH works. TeslaMate, Grafana, Mosquitto, and Postgres are running. |
| Prediction API | `192.168.1.3:3001` | `home-automation-api` container is running. A request without parameters returns `error=bad_request`. |
| Loxone Miniserver | `192.168.1.137` (`ms6a74`) | HTTPS answers. |
| evcc | `192.168.1.3:7070` | TrueNAS custom app `evcc`, beside TeslaMate and the automation API. Both loadpoints were left Off. |

The address `192.168.1.50` used in the API notes does not answer.

## Spike: Tesla charging without a schedule in the car

Ran on 25 October 2026 with the Model Y plugged into a Loxone wallbox. TeslaMate on the NAS was the meter. The car was the only actor in the Tesla app. No Fleet API command was sent.

### What blocked charging

The car was plugged in and reporting online. Waking it did not start a charge.

| Reading | Value |
| --- | --- |
| Battery | 60% |
| Charge limit | 60% |
| Charging state | Complete |
| Scheduled start | 25 October 2026, 23:00 UTC (midnight local) |
| Power | 0 kW |

Raising the limit to 66% changed the state from Complete to Stopped. Power stayed at 0 kW, and the midnight schedule was still set. The limit was no longer the block. The schedule was.

Pressing Start charging in the Tesla app overrode the schedule. The car charged. The limit at that point was 70%.

### Fresh plug-in with the schedule removed

All schedules were then disabled in the car. TeslaMate stopped reporting a scheduled start. The existing session stayed Stopped, with the wallbox offering no voltage. That is the red wallbox state: connected, no power.

Unplugging and plugging back in started charging with no tap in the Tesla app. At 17:43 local the car was charging, battery 61%, limit 71%, no scheduled start.

### Wallbox fault on every start

Both the manual start and the fresh plug-in show the same sequence. Times are UTC.

Manual start:

| Time | Power | Actual current | Pilot | Voltage | Phases |
| --- | --- | --- | --- | --- | --- |
| 16:28:55 | 0 kW | 0 A | 6 A | 240 V | 1 |
| 16:29:01 | 0 kW | 0 A | 0 A | 4 V | 1 |
| 16:29:20 | 1 kW | 2 A | 16 A | 238 V | 2 |
| 16:29:25 | 3 kW | 6 A | 16 A | 235 V | 2 |
| 16:29:45 | 11 kW | 16 A | 16 A | 233 V | 2 |

Fresh plug-in, schedule already deleted:

| Time | Power | Actual current | Pilot | Voltage | Phases |
| --- | --- | --- | --- | --- | --- |
| 16:42:30 | 0 kW | 0 A | 6 A | 238 V | 1 |
| 16:42:35 | 0 kW | 0 A | 0 A | 2 V | 1 |
| 16:42:54 | 1 kW | 3 A | 16 A | 236 V | 2 |
| 16:43:00 | 3 kW | 6 A | 16 A | 236 V | 2 |

The offer starts at 6 A on one phase, the pilot drops to 0 A, then the offer returns at 16 A and the car ramps. 11 kW at 16 A is a three-phase charge. This matches the Wallbox Manager startup rule: it allows a small current so a session can begin, then reallocates the real power once charging is detected. Tesla treats the change as a fault and retries. The session recovers by itself.

A connected wallbox with no allocated power shows red. That is the idle state. It is not, on its own, a failed charger.

### Conclusion

A Tesla with an empty charging schedule starts when the wallbox offers current, on a fresh plug-in, while the battery is below the charge limit. evcc can own the timetable by deciding when the Wallbox Manager may give power. The car does not need `charge_start` for that path.

The charge limit in the car remains a hard cap. evcc cannot charge past it. A session that was stopped by a schedule or by the stop button does not resume when power returns. The next plug-in does.

The phase fault is separate. It happens on every start and clears itself. It is not a reason to keep a schedule in the Tesla app.

## Spike: Wattsonic charge and discharge

The Miniserver HTTP API can read the live values. Basic authentication against `https://192.168.1.137` works with the user in `.env`. The Wattsonic is not directly on the LAN. Its state is the Modbus data Loxone already polls, plus the text outputs of the PicoC block.

### Baseline, 25 October 2026, about 17:50 local

No mode was changed. This is what the script is doing on its own.

| Reading | Value |
| --- | --- |
| Working mode | General mode |
| Inverter state text | Grid injection enabled |
| Battery state of charge | 19.5% (shown as 20%) |
| Battery power | 0 kW, idle |
| On-grid end SOC | 20%, and the general-mode user setting is also 20% |
| Charge/discharge power limit | 0 kW |
| Grid injection limit in the script | 80 kW |
| House grid meter | 0.57 kW import |
| Inverter energy-meter total | -0.4 kW |
| PV power now | 0 kW |
| PV prediction | 11.5 kWh today, 13.7 kWh tomorrow |
| Solar produced today | 1.8 kWh |
| Spot price now | 3.44 Kč/kWh |
| Spot range today | 2.37 to 7.95 Kč/kWh |
| Grid-charge price limit | -1.50 Kč/kWh |
| Discharge price limit | 8.00 Kč/kWh |
| SOC required before discharge to grid | 50% |
| Hot-water tank | heating on, 51.7°C |

The script is following its current rules. The price is far above -1.50 Kč/kWh, so it does not command a grid charge. The price is also below 8 Kč/kWh and the battery is below 50%, so it does not command a discharge. General mode with grid injection enabled is the remaining branch, and that is the branch that is active. The on-grid end SOC matches the user setting because the charge branch, which overwrites that value with the current SOC, is not running.

### Charge command, about 19:15 local

The spot price had risen to 4.02 Kč/kWh. The grid-charge slider allows -1.50 to 6.00. It was set to 5.00, held for 20 seconds, then restored to -1.50.

| Time | Slider | Mode | State text | Battery | Grid meter | End SOC | Period power limit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| +5 s | 5.00 | Economic | Charging from grid | 0 kW | 1.31 kW | 20% | 0 |
| +10 s | 5.00 | Economic | Charging from grid | 0 kW | 1.34 kW | 19% | 0 |
| +20 s | 5.00 | Economic | Charging from grid | 0 kW | 1.34 kW | 19% | 0 |
| +5 s after restore | -1.50 | General | Grid injection enabled | 0 kW | 1.28 kW | 20% | 0 |

The script entered the charge branch and left it again as soon as the slider was restored. During the charge branch the on-grid end SOC moved from the 20% user setting to 19%, the current state of charge. That is the overwrite in the charge branch. No energy moved: battery power stayed 0 kW and the house import stayed near 1.3 kW. The period power limit read back as 0 for the whole test, which matches the comment in the script that this limit is not applied. The inverter was told to charge and was given no charge power.

### What the script emits, about 19:45 local

The same test was repeated with the slider at 4.52, just above the 4.02 Kč/kWh spot price, for 32 seconds. The slider was then restored to -1.50 and the mode returned to general.

While the state text said “Charging from grid,” the script’s own debug line said:

- Battery charge/discharge power limit: 30 kW
- On-grid end SOC protection: 19.45, against a user setting of 20
- Grid injection power limit: 0 kW

The battery power stayed 0 kW. The house import stayed about 1.3 kW. `Period 1 - Power Limit` stayed 0 for every sample. That control is not showing the script output, because the script had already computed 30 and the output written from that branch is `30 * 10`. The Miniserver API cannot see the raw PicoC analog output, only controls placed on a page.

So the charge branch runs and the limit variable is 30. The value that reaches the inverter’s period power limit stays 0, and no watts enter the battery. Changing the number 30 in the script is not the fix. The actuator `Period 1 - Power Limit` is Modbus register `53010` (address AMQ6). Its correction starts at input 0 → target 0, and the next input point is 1000, which is the register’s full-scale value for 100%. The script writes `30 * 10 = 300`, so 30% if that correction is one-to-one.

The fifth analog output is wired to that actuator, and the project was already saved in the Miniserver before the 19:53 test. A further run at 20:08, with the spot price at 3.74 Kč/kWh and the slider at 4.24, did the same thing for 40 seconds. The script reported 30 kW. `Period 1 - Power Limit` stayed 0. Battery power stayed 0 kW. The slider was restored to -1.50.

The wire and the save are not the missing step. The script computes 300, and the value visible on the actuator stays 0. The actuator correction dialog shows input 0 → target 0, and a second input of 1000. The target for that second point was not visible. If that point does not pass 300 through on the 0–1000 scale, the register written to the inverter is 0.

### Writing 30 instead of 300, about 20:30 local

With the charge branch active, 30 was written directly to the `Period 1 - Power Limit` control, repeatedly, so the `* 10` in the script was bypassed. Loxone accepted the write and echoed 30. Every live reading after that was still 0. Battery power stayed 0 kW. The control was then set back to 0 and the price slider back to -1.50.

Sending 30 does not make this value stick, and it does not start a charge. The protocol and a working Modbus example both say 100% is 1000, so 30% is 300. The `* 10` in the script matches that. Dropping it would send 3%.

The same example writes the period as one block. Start `0` is 00:00. Stop `5947` is 23:59 (`23 * 256 + 59`). Registers `53012` and `53013` are the two actuators on the page with no wires, and the script had no outputs for them. Sources: [smarthome.exposed register table](https://smarthome.exposed/wattsonic-hybrid-inverter-gen3-modbus-rtu-protocol/2/), [protocol PDF](https://www.admach.cz/media/uploads/hybrid_inverter_modbus_rtu_protocol_en0332.pdf), [Home Assistant charge sequence](https://community.home-assistant.io/t/wattsonic-photovoltaic-power-plant-fve-integration/406135?page=2). The script header already points at the smarthome.exposed table.

PicoC cannot send that block as one Modbus write. Each script output is one Loxone actuator, and each actuator writes one register. The script now emits the missing clock on outputs 9 and 10, and it emits them before the power limit in the same loop. A grid charge or a grid discharge sets period 1 to enabled, start `0`, stop `5947`, and the power limit still as percent times 10 (30% is 300). Any other branch disables period 1 and writes start `0` and stop `0`. Reserved registers `53009` and `53011` stay untouched. They are padding inside a multi-register write, and there are no actuators for them.

### Script saved, charge still does not flow, 20:51 local

The updated script was saved to the Miniserver. Before the test the debug text already contained the new fields: period enabled 0, start 0, stop 0. Mode was General, slider -1.50, spot price 3.74 Kč/kWh, battery 0 kW.

The slider was set to 4.25 for 40 seconds, then restored to -1.50. Within 5 seconds the state text was “Charging from grid,” the limit in the debug text was 30 kW, and on-grid end SOC moved from 20% to 19%. Battery power stayed 0.000 kW for every sample. `Period 1 - Power Limit` stayed 0. Grid import stayed about 0.48 kW, with a brief rise to 0.66 kW. After the restore, mode returned to General and the slider read -1.50.

The script’s charge branch runs. No watts entered the battery. The live page still has no reading for registers 53012 and 53013, so this run does not show whether outputs 9 and 10 are wired to the scheduled-period actuators. The charge branch also sets the on-grid end SOC to the current SOC, which tells the inverter that the charge target is already reached.

### Period clock wired, 21:02 local

Outputs 9 and 10 were then wired to registers 53012 and 53013 and saved. The same 40-second test was repeated: spot price 3.74 Kč/kWh, slider 4.25, then restored to -1.50.

The script held the full command for the whole window: economic mode, “Charging from grid,” period enabled 1, start 0, stop 5947, power limit 30. On-grid end SOC moved from 20% to 19%. Battery power stayed 0.000 kW. Grid import stayed 0.475 kW. `Period 1 - Power Limit` stayed 0. After the restore, mode returned to General and the slider read -1.50.

The clock command is now in the script output. It still does not move the battery. The end-SOC write does reach the inverter, because that displayed value followed the script. The power-limit display did not.

The power-limit correction is input 1000 → target 1000, so a script value of 300 is sent as 300. The working end-SOC actuator is input 100 → target 1000, so a script value of 20 is sent as 200. Both registers use 1000 as 100%.

Grid charging did work before the discharge path shared register 52503. The charge branch from 11 August 2024 set that register to 100% so the battery could not discharge while it was being charged. On 6 February 2025 the same line was changed to the current SOC, to stop a full-power charge, and the charge limit was lowered from 50% to 30%. At a current SOC of 19% that write tells the inverter the end SOC is already reached. The 30% limit remains the power cap. The charge branch now sets the end SOC back to 100% for the duration of a grid charge.

### End SOC held at 100% during charge, 21:14 local

The updated script was saved. Spot price was 2.82 Kč/kWh. The slider was set to 3.30 for 40 seconds, then restored to -1.50.

Within 10 seconds the battery was taking power and the house import rose with it.

| Time | Battery | Grid import | End SOC | Script |
| --- | --- | --- | --- | --- |
| Before | 0.000 kW | 0.675 kW | 20% | General, period off |
| +5 s | 0.038 kW | 0.464 kW | 20% | Charging, end SOC command 100, period 0–5947, limit 30 |
| +10 s to +40 s | about -1.7 kW | 2.33 kW | 100% | Same charge command |
| +6 s after restore | -1.756 kW | 2.332 kW | 20% | General, period off, end SOC command 20 |

Negative battery power is charge. The extra grid import is about 1.7 kW, matching the battery. `Period 1 - Power Limit` stayed 0 on the page while the battery was charging, so that control is not the register the inverter is using.

The charge is real. Turning the period off in the script did not stop it. At 21:17 the mode was already General, the battery was at 20%, the end SOC was 20%, and the battery was still drawing 1.76 kW. Setting the general-mode end SOC to 19%, just below the battery, stopped the charge within 12 seconds. Restoring that setting to 20% did not start it again. Battery power was then 0 kW and grid import was about 0.46 kW.

### Charge stop and discharge spike, 21:27 local

The script now holds the end SOC 1% below the battery for 20 seconds after a grid charge, then returns the 20% floor. A discharge price slider of 1.00 Kč skips the day-high and 50% SOC gates. The saved value 8.00 Kč leaves those gates in place.

Spot price was 2.82 Kč/kWh. The charge slider was set to 3.30. Within 10 seconds the battery was drawing 1.72 kW and grid import was 2.37 kW. The slider was restored to -1.50. Five seconds later the script was commanding an end SOC of 18.8%. By ten seconds the battery was at 0.06 kW and grid import was 0.50 kW. At twenty seconds the script returned the end SOC command to 20%, and the battery stayed near 0 kW.

The discharge slider was then set to 1.00 Kč and the general-mode end SOC to 10%, so the 19.8% battery had room to fall. The script reported “Discharging to grid” with an 80% limit. Battery power was positive, about 0.5–0.8 kW. Grid power sat around 0 kW, with one sample at 0.12 kW export, so the battery covered the house and exported little. The 80% command did not produce a proportionally larger flow than the 30% charge. Both sliders and the 20% floor were restored. The mode returned to General, battery power to 0 kW, and grid import to 0.50 kW.

### Car side seen at the same time

The outer wallbox has a vehicle connected and is not drawing power. Its assigned power is 1.38 kW, which is the Wallbox Manager's small starter offer. The inner wallbox is idle.

The eco-power block still reports charging enabled. The SOC threshold is 20% with 2% hysteresis, and the battery is at 19.5%, so a session that was already enabled stays enabled down to 18%. The configured minimum eco power is 11.3 kW, and with no sun that becomes the requested charge power. Priority EV charging is on.

## Spike: evcc modes into the Wallbox Manager

Ran around 22:05 local. evcc 0.318.1 is a TrueNAS custom app named `evcc`, in the same Apps list as TeslaMate and the automation API. The UI and API are at `http://192.168.1.3:7070`, with no login. A bridge in that app reads the two loadpoint modes and writes only the wallbox allow command. evcc's enable and maxcurrent calls are accepted and dropped, so evcc does not assign amps. Neither car was connected, so a mode change could not start a charge.

evcc 0.318 calls the surplus mode `smart`. The bridge maps `off` to `allow/off`, and `smart` (also `pv` and `minpv`) to `allow/on`.

The outer wallbox passed. `smart` made the Wallbox Manager report demand, priority clear, and `limitedBy` 1, which is the Peco bit. Assigned power stayed 0 kW and the wallbox limit stayed 0. `allow/off` removed the demand. The manager still owns the power.

The inner wallbox did not. The same `allow/on` returns HTTP 200 and the manager node stays without a demand. Both wallboxes have the Ec input connected to logic. On the inner block that logic is holding charging off, so the API command does not stick.

Priority is not set by any command in the published wallbox API. `allow/on`, `priority/1`, `priority/pulse`, and `Ecp/pulse` were tried on the unplugged outer box. Only `allow/on` changes the manager, and it sets Eco (`priority` false, `limitedBy` Peco). evcc's `now` mode therefore also becomes Eco. `manualLimit` was not used, because that takes amp control away from the manager.

Both loadpoints and both wallboxes were put back to Off. Assigned power is 0 on both nodes.

The setup wizard was finished at 22:25. Home battery, solar system, grid-export tariff, and solar forecast were skipped. evcc still has no battery and no PV devices. The grid slot is the 0 kW placeholder. The only chargers are `inner` and `outer`, both Off.

At 22:32 the Tesla was added as a TeslaMate vehicle named Obluda. evcc reads it from the TeslaMate broker. It does not use a second Fleet API application and it cannot send charge commands or amps to the car.

At 22:35 the Loxone app showed the car connected on Wallbox vnější in the garage. TeslaMate agreed: plugged in, 60% SOC, charge limit 50%. The wallbox state evcc reads stayed `connected` 0, assigned power 0, and the outer loadpoint stayed Off. Obluda was not attached to that loadpoint.
