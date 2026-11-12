# Charge before the next price rise

Date: 2026-11-11

The battery buy is one window. It finishes before the next rise of at least 2 Kč/kWh, and it is large enough for the house while that rise lasts. When that rise is over, the next plan books the same kind of window before the following rise.

Loxone keeps a single `batteryFrom` / `batteryTo`. The chart draws that one window. A second window appears on the next poll, after the first rise has ended.

## Thursday, 12 November 2026

The pack is on the 20% floor. Low cloud from 06:00 through 11:00 is 100%, and the day is about 4.6–5.7 kWh of sun. The price sits near 4.6 Kč/kWh around 03:00, crosses 2 Kč above that at 06:30, and stays high until the evening. The late evening, down to about 3.6 Kč/kWh, is the cheap period, not a second peak.

Two buys happen on Thursday:

1. Before 06:30. This is the buy for Thursday's own high prices. The 19:45–24:00 block is after the rise, so it is not this window.
2. After those high prices have ended, still on Thursday. The cheap evening is before Friday morning's rise, so the next poll puts the buy there. That window ends when Friday's rise starts. It is the buy for Friday morning.

The plan text holds one of these at a time. Until Thursday's rise ends, the text is the early window. After the rise ends, the text is the evening window. Both run.

A day whose middle falls back to the cheap level has a real evening peak. The early buy covers only the morning rise. The later poll, from the valley, covers the evening rise. A day with no rise of 2 Kč keeps the cheapest block, wherever it sits.

## How the rise is found

Walk forward from now. The trough is the lowest price seen before a jump. A rise starts at the first quarter more than 2 Kč/kWh above that trough. It ends at the first later quarter that is back within 2 Kč of the same trough. The next rise is the first one that has not started. Tomorrow is included through late morning, so a rise just after midnight is visible from the evening before.

Quarters already inside a rise are not a place to buy. The search for the slot stops at the start of the rise. The cheapest run that finishes by then wins. A run may cross midnight when the rise is tomorrow morning. The tank and the car still share the breaker: the battery stays at 2.5 kW while its window overlaps both of them, and otherwise uses its 3 kW.

## How much

The amount is the larger of two figures, both limited to the empty room in the pack.

- House energy from the start of the rise until it ends, minus energy already stored above 20%, minus the sun expected during the rise.
- Empty room the sun will not fill before the rise ends, when the rise is at least 3 Kč/kWh above the trough.

A rise the battery and the sun already cover is a hold. The sale stays on the dearest quarter of the day when that quarter clears 3 Kč/kWh, and it stays a separate window.
