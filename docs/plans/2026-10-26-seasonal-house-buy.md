# Seasonal house buy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The API can say how many kWh the battery above its floor still needs so the house lasts until morning, using the seasonal table in ADR 0008. When that energy is bought is a later step. On a weekend or a bank holiday the cheap period is often in the daytime.

**Architecture:** A pure function holds the overnight medians and the expected-PV medians. It takes the season, tomorrow's low-cloud band, and the kWh already above the 20% floor. It returns the grid kWh to buy for the house. Hot water, the car, the 17 kW cap, and the cheapest price slot stay out of this function.

**Tech Stack:** TypeScript, Vitest, the existing `apps/home-automation-api` package.

---

### Task 1: Seasonal table

**Files:**
- Create: `apps/home-automation-api/src/services/seasonal-profile.ts`
- Test: `apps/home-automation-api/test/seasonal-profile.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { expectedPvKwh, overnightKwh } from "../src/services/seasonal-profile.js";

describe("seasonal profile", () => {
  it("returns the reduced medians", () => {
    expect(overnightKwh("winter")).toBe(7.3);
    expect(overnightKwh("summer")).toBe(0.7);
    expect(expectedPvKwh("winter", "covered")).toBe(1.5);
    expect(expectedPvKwh("summer", "clear")).toBe(38.3);
  });
});
```

**Step 2: Run the test and confirm it fails**

Run: `pnpm --filter home-automation-api exec vitest run test/seasonal-profile.test.ts`

Expected: FAIL, cannot find the module.

**Step 3: Implement the two lookups**

```typescript
export type Season = "winter" | "spring" | "summer" | "autumn";
export type CloudBand = "clear" | "mixed" | "covered";

const OVERNIGHT_KWH: Record<Season, number> = {
  winter: 7.3,
  spring: 0.8,
  summer: 0.7,
  autumn: 2.0
};

const EXPECTED_PV_KWH: Record<Season, Record<CloudBand, number>> = {
  winter: { clear: 12.8, mixed: 6.0, covered: 1.5 },
  spring: { clear: 35.7, mixed: 30.3, covered: 15.7 },
  summer: { clear: 38.3, mixed: 31.9, covered: 22.4 },
  autumn: { clear: 21.7, mixed: 14.3, covered: 4.6 }
};

export function overnightKwh(season: Season): number {
  return OVERNIGHT_KWH[season];
}

export function expectedPvKwh(season: Season, band: CloudBand): number {
  return EXPECTED_PV_KWH[season][band];
}
```

**Step 4: Run the test and confirm it passes**

Run: `pnpm --filter home-automation-api exec vitest run test/seasonal-profile.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/seasonal-profile.ts apps/home-automation-api/test/seasonal-profile.test.ts
git commit -m "Add the seasonal overnight and expected-PV medians."
```

### Task 2: House grid purchase

**Files:**
- Modify: `apps/home-automation-api/src/services/seasonal-profile.ts`
- Test: `apps/home-automation-api/test/seasonal-profile.test.ts`

**Step 1: Write the failing test**

```typescript
import { houseGridKwh } from "../src/services/seasonal-profile.js";

it("buys the shortfall to morning and a further buy when tomorrow cannot refill the night", () => {
  expect(houseGridKwh("winter", "covered", 2)).toBeCloseTo((7.3 - 2) + (7.3 - 1.5));
  expect(houseGridKwh("winter", "clear", 2)).toBeCloseTo(7.3 - 2);
  expect(houseGridKwh("summer", "covered", 2)).toBe(0);
});
```

**Step 2: Run the test and confirm it fails**

Run: `pnpm --filter home-automation-api exec vitest run test/seasonal-profile.test.ts`

Expected: FAIL, `houseGridKwh` is not exported.

**Step 3: Implement the purchase**

`aboveFloorKwh` is kilowatt-hours already stored above the 20% floor. Values below 0 are treated as 0.

```typescript
export function houseGridKwh(season: Season, band: CloudBand, aboveFloorKwh: number): number {
  const stored = Math.max(0, aboveFloorKwh);
  const overnight = overnightKwh(season);
  const expected = expectedPvKwh(season, band);
  const toReachMorning = Math.max(0, overnight - stored);
  const sunWillNotRefill = Math.max(0, overnight - expected);
  return toReachMorning + sunWillNotRefill;
}
```

**Step 4: Run the test and confirm it passes**

Run: `pnpm --filter home-automation-api exec vitest run test/seasonal-profile.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/seasonal-profile.ts apps/home-automation-api/test/seasonal-profile.test.ts
git commit -m "Size the house night purchase from the seasonal table."
```

### Task 3: Low-cloud band from a percentage

**Files:**
- Modify: `apps/home-automation-api/src/services/seasonal-profile.ts`
- Test: `apps/home-automation-api/test/seasonal-profile.test.ts`

**Step 1: Write the failing test**

```typescript
import { cloudBand } from "../src/services/seasonal-profile.js";

it("splits the morning low-cloud percentage into the three bands", () => {
  expect(cloudBand(0)).toBe("clear");
  expect(cloudBand(19.9)).toBe("clear");
  expect(cloudBand(20)).toBe("mixed");
  expect(cloudBand(69.9)).toBe("mixed");
  expect(cloudBand(70)).toBe("covered");
});
```

**Step 2: Run the test and confirm it fails**

Run: `pnpm --filter home-automation-api exec vitest run test/seasonal-profile.test.ts`

Expected: FAIL, `cloudBand` is not exported.

**Step 3: Implement the band**

```typescript
export function cloudBand(lowCloudPercent: number): CloudBand {
  if (lowCloudPercent < 20)
    return "clear";
  if (lowCloudPercent < 70)
    return "mixed";
  return "covered";
}
```

Use this same function from `pv-forecast-learning.ts` instead of a second copy of the thresholds, and re-run `pnpm api:test`.

**Step 4: Run the tests and confirm they pass**

Run: `pnpm api:test`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/home-automation-api/src/services/seasonal-profile.ts apps/home-automation-api/src/services/pv-forecast-learning.ts apps/home-automation-api/test/seasonal-profile.test.ts
git commit -m "Use one low-cloud band for the seasonal table and the learned forecast."
```
