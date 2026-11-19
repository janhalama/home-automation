# 0016. The day keeps the decision that was in force

Date: 2026-11-19

Status: Accepted

## Context

On 19 November the heater ran in the early morning and again in the afternoon. By evening the page called the whole day a plan to heat from 23:15 to 02:15, and drew every earlier hour as off. Overnight the battery charged until 03:00 and then sat while the grid ran the house. The page had no decision called "the battery is waiting," and no line that said what changed at 03:00 or at 07:30.

The page builds that picture again on each look. Hours that already happened are filled from a fresh calculation, or from the latest decision, so a later change replaces the whole day.

ADR 0015 keeps a battery charge that has started until that charge ends. It does not keep the tank, the car, or a decision that the battery should wait. It does not keep a line for why the hours still ahead changed.

The product note for this is `docs/2026-11-19-seeing-the-day-prd.md`.

## Decision

The plan shown for an hour that has started is the decision that was in force during that hour. That decision is stored when it is issued.

A later decision may change only hours that have not started. A tank decision, a car decision, or a battery charge that has started stays until it ends. ADR 0015 is this rule for a battery charge. The tank and the car follow the same rule.

While a stored tank or car decision is on and the battery is not charging, the stored decision says the battery is waiting. The page shows that wait. It is not taken from how the inverter behaved afterwards.

When the part of the decision that is still ahead changes, one line is stored. The line has the time, what changed, and the cause in one sentence. The cause is the price, how full the battery is, the tank temperature, what the car still needs, the expected sun, or a decision that ended so the next one could start. The line also keeps the plan as it stood at that moment: the tank, the car, and the battery, for the whole day. The page does not show that picture until it is asked for. It then opens over the day. It is the plan, not the measured flows. A look that leaves that future part the same adds no line. The page shows the latest lines for the day.

The page reads this store for the plan. It does not paint past hours from a fresh calculation.

## Consequences

The planner still proposes. The route keeps what has started, replaces only the future, and writes a line when that future changes. The follower still follows the latest text for the current minute. Because a started decision stays in that text, the current minute does not drop it.

A day from before this store exists has no past plan to show. The measured flows of the car, the tank, the battery, the grid, and the house stay a separate picture. This decision does not change how they are read.
