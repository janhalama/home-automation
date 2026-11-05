# Energy plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The API reads Obluda's missing energy from TeslaMate and answers with the cheapest slot Loxone can pull.

**Architecture:** Pure functions turn three MQTT numbers, the bottom temperature, the state of charge, and the OTE prices into one plain-text plan. A route serves that text. The Miniserver program that writes the plan into the running scripts is a later Config visit.

**Tech Stack:** TypeScript, Vitest, Fastify, the existing house archive and seasonal table.

---

### Task 1: Missing car energy

**Files:**
- Create: `apps/home-automation-api/src/services/car-energy.ts`
- Test: `apps/home-automation-api/test/car-energy.test.ts`

A usable level of 50 and a limit of 50 is 0 kWh. A usable level of 20 and a limit of 80 is 45 kWh. A percentage outside 0–100 throws.

### Task 2: Cheapest slot

**Files:**
- Create: `apps/home-automation-api/src/services/cheap-slot.ts`
- Test: `apps/home-automation-api/test/cheap-slot.test.ts`

The slot is the contiguous run of 15-minute prices with the lowest sum that is long enough for `kWh / kW`, rounded up to a quarter hour. It is the shortest such run. `endBy` of `06:00` drops any quarter that ends after 06:00. No run long enough returns null. Zero energy returns null.

### Task 3: The plan

**Files:**
- Create: `apps/home-automation-api/src/services/energy-plan.ts`
- Test: `apps/home-automation-api/test/energy-plan.test.ts`

Below 45°C the tank gets 3.5 kWh at 2.5 kW before 06:00. At 45°C or above the tank is off. A missing temperature is `limited`.

A missing car reading is `limited`. An unplugged car or a car with 0 kWh missing is off. Otherwise the car is on before 06:00 at 11 kW.

`houseGridKwh` of 0 is `hold`. A positive figure is `grid-charge` in the cheapest period at 3 kW, with no 06:00 deadline. Missing low cloud is `hold`.

### Task 4: Plain text and the route

**Files:**
- Modify: `apps/home-automation-api/src/lib/plain-text-response.ts`
- Create: `apps/home-automation-api/src/routes/energy-plan.route.ts`
- Test: `apps/home-automation-api/test/energy-plan.route.test.ts`
- Modify: `apps/home-automation-api/src/create-app.ts`

`GET /api/energy/plan` requires the API key and returns the text. Prices for the Prague date come from the archive. The latest power sample supplies the state of charge. The latest heater sample supplies the bottom temperature. The car reader is injected. A reader that fails sets the car line to `limited`.

### Task 5: TeslaMate MQTT

**Files:**
- Create: `apps/home-automation-api/src/services/teslamate-car.ts`
- Test: `apps/home-automation-api/test/teslamate-car.test.ts`

Decode retained MQTT publishes for the three topics. The live socket connects to `TESLAMATE_MQTT_HOST` when that variable is set. Until the API container joins `ix-teslamate_default`, the car line stays `limited`.
