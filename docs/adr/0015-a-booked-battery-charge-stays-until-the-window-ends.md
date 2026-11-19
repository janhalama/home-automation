# 0015. A booked battery charge stays until the window ends

Date: 2026-11-18

Status: Accepted

## Context

On 18 November the sunrise build booked a 6 kW grid charge from 12:45 to 14:00. The battery power through that window shows sun in the morning and then the house. No grid buy. At 13:57, still inside the window, the plan the Miniserver polls said `battery=hold` with an empty window. A rebuild that ignores the clock and uses the state of charge from the start of the day still returned 12:45–14:00.

Nothing stores the window after it is chosen. Each poll builds a new plan from the current clock, the current state of charge, and whatever prices have arrived. Tomorrow's file, a small change in sun, or the clock moving past the cheap hours can erase the window. The follower raises the charge output only while the latest text says `grid-charge` and the clock is inside that text, so the next poll clears the command.

The chart hides the erasure. Past quarters are painted from a clock-free rebuild, so the green block stays after the Miniserver has been told to hold.

On 17 November a setpoint of −2 kW in mode 771, with the end state of charge held at 100%, did take energy from the grid. That command path is proven. A later poll that says hold is a different failure.

## Decision

A booked grid charge is a commitment.

The from, to, kilowatts, and the kilowatt-hours that window was sized for are stored when the planner chooses them. Every poll until the window ends returns that same charge. A later poll may book the next window. It leaves the current one in place. The commitment ends when the clock reaches `batteryTo`, or when samples inside the window show the pack has taken that energy. The same hours are not opened again after either ending.

The chart and the Miniserver read that store. The green block is a window that was booked. The Miniserver text carries the one commitment still in force, and the list of windows booked today so a finished charge stays on the chart. A clock-free rebuild is not the order.

Inside a commitment, the meter is a check. Battery power should sit on the charge side. A sample in the window that is not charging is a fault on the command path. The fault does not change the window and does not open a new planning rule.

## Consequences

The planner still proposes the slot. The route is what keeps it. The follower is unchanged: it charges while the text says `grid-charge` and the clock is inside the stored hours.

A day that is not today is still a fresh build. The commitment runs on the poll for today. The sunrise rebuild used by the chart no longer supplies the charge row once the stored list is present.
