// Player command facade: validated actions for the UI that need engine randomness or several steps.

import type { GameState } from "./types.ts";
import { withRng } from "./state.ts";
import { bombard, invade } from "./ground.ts";
import type { InvasionResult } from "./ground.ts";
import { colonize } from "./fleets.ts";
import { aiChooseResearch } from "./research.ts";
import { allocateEmpireJobs, autoAssignJobs, clampJobs } from "./economy.ts";
import { coloniesOf } from "./state.ts";

export function cmdInvade(s: GameState, fleetId: number, colonyId: number): InvasionResult | string {
  return withRng(s, (rng) => invade(s, fleetId, colonyId, rng));
}

export function cmdBombard(s: GameState, fleetId: number, colonyId: number): string {
  return withRng(s, (rng) => bombard(s, fleetId, colonyId, rng));
}

export function cmdColonize(s: GameState, fleetId: number, planetId: number, preferOutpost = false): string | null {
  const r = colonize(s, fleetId, planetId, preferOutpost);
  return typeof r === "string" ? r : null;
}

export function cmdAutoResearch(s: GameState, empireId: number): string | null {
  const e = s.empires[empireId];
  return withRng(s, (rng) => {
    const pick = aiChooseResearch(e, rng);
    e.research.targetTech = pick;
    return pick;
  });
}

export function cmdSetJobs(s: GameState, colonyId: number, farmers: number, workers: number, scientists: number): string | null {
  const c = s.colonies[colonyId];
  if (!c) return "no such colony";
  if ([farmers, workers, scientists].some((v) => !Number.isInteger(v) || v < 0)) return "invalid job counts";
  if (farmers + workers + scientists !== c.pop) return "jobs must add up to the population";
  c.farmers = farmers;
  c.workers = workers;
  c.scientists = scientists;
  return null;
}

/** Move one colonist between job categories. */
export function cmdShiftJob(s: GameState, colonyId: number, from: "farmers" | "workers" | "scientists", to: "farmers" | "workers" | "scientists"): void {
  const c = s.colonies[colonyId];
  if (!c || c[from] <= 0 || from === to) return;
  c[from] -= 1;
  c[to] += 1;
  clampJobs(c);
}

export function cmdAutoJobs(s: GameState, colonyId: number): void {
  const c = s.colonies[colonyId];
  if (c) autoAssignJobs(s, c, 0.4);
}

export function cmdSetTax(s: GameState, empireId: number, rate: number): void {
  const e = s.empires[empireId];
  if (e) e.taxRate = Math.max(0, Math.min(50, Math.round(rate / 10) * 10));
}

/** Re-plan jobs across every colony of the empire (food first, then industry/research). */
export function cmdAutoJobsAll(s: GameState, empireId: number, scienceShare = 0.4): void {
  const e = s.empires[empireId];
  if (e) allocateEmpireJobs(s, e, coloniesOf(s, empireId), scienceShare);
}
