/*
The colored line that says when the Miniserver last pulled the plan.
*/

export type PlanPull = {
  state: "fresh" | "stale" | "obsolete";
  sentence: string;
};

/* Paint the banner from the pull the API described. */
export function renderPlanPull(banner: HTMLElement, pull: PlanPull): void {
  banner.hidden = false;
  banner.className = `pull-banner ${pull.state}`;
  banner.textContent = pull.sentence;
}
