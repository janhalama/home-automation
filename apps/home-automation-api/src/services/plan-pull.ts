/*
How old the last Miniserver plan pull is.
The Miniserver pulls every 10 minutes. A pull from the last 15 minutes is fresh.
The follower keeps a plan for one hour,
so an older pull inside that hour is stale and still followed. Past that hour the plan is obsolete.
*/

const FRESH_MS = 15 * 60 * 1000;
const FOLLOW_MS = 60 * 60 * 1000;

export type PlanPullState = "fresh" | "stale" | "obsolete";

export type PlanPullDescription = {
  state: PlanPullState;
  pulledAt: string | null;
  sentence: string;
};

export type PlanPullMemory = {
  lastSuccessAt: Date | null;
  noteSuccess(at: Date): void;
};

/* One clock for the process. A restart forgets it until the Miniserver pulls again. */
export function createPlanPullMemory(): PlanPullMemory {
  let lastSuccessAt: Date | null = null;
  return {
    get lastSuccessAt() {
      return lastSuccessAt;
    },
    noteSuccess(at: Date) {
      lastSuccessAt = at;
    }
  };
}

/* HH:MM in Prague. */
function pragueClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(at);
}

/* YYYY-MM-DD in Prague. */
function pragueDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(at);
}

/* Clock for today, date and clock for an earlier day. */
function when(at: Date, now: Date): string {
  const clock = pragueClock(at);
  if (pragueDay(at) === pragueDay(now))
    return clock;
  return `${pragueDay(at)} ${clock}`;
}

/* The banner text for this age. */
export function describePlanPull(lastSuccessAt: Date | null, now: Date): PlanPullDescription {
  if (lastSuccessAt === null)
    return {
      state: "obsolete",
      pulledAt: null,
      sentence: "Loxone has not pulled the plan. It is not following one."
    };
  const age = now.getTime() - lastSuccessAt.getTime();
  const pulledAt = lastSuccessAt.toISOString();
  const clock = when(lastSuccessAt, now);
  if (age <= FRESH_MS)
    return {
      state: "fresh",
      pulledAt,
      sentence: `Loxone pulled the plan at ${clock} and is following it.`
    };
  if (age <= FOLLOW_MS)
    return {
      state: "stale",
      pulledAt,
      sentence: `Loxone pulled the plan at ${clock}. The pull is stale. Loxone is still following that plan.`
    };
  return {
    state: "obsolete",
    pulledAt,
    sentence: `Loxone pulled the plan at ${clock}. That plan is obsolete. Loxone is not following it.`
  };
}
