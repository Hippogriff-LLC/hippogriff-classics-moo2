// Colony and empire economy model. Formulas are reconstructed approximations (docs/research/RULES.md).

import type { Colony, Empire, GameState, Planet } from "./types.ts";
import { race } from "./data/races.ts";
import type { RaceTraits } from "./data/races.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { coloniesOf, empire, hasTech, planet } from "./state.ts";
import { HULLS } from "./data/ships.ts";

export const SIZE_UNITS = [1, 2, 3, 4, 5];
/** population per size unit by climate (Toxic..Gaia) */
export const CLIMATE_POP = [1, 1, 1, 2, 2, 3, 3, 3, 4, 5];
/** food per farmer by climate */
export const CLIMATE_FOOD = [0, 0, 0, 1, 1, 2, 1, 1, 2, 3];
/** industry per worker by mineral richness */
export const MINERAL_INDUSTRY = [1, 2, 3, 5, 8];
export const POLLUTION_TOLERANCE = [2, 4, 6, 8, 10];
export const RESEARCH_PER_SCIENTIST = 3;
export const HOSTILE_CLIMATES = new Set([0, 1, 2]);
/** Output multiplier for computer players by difficulty. */
export const AI_BONUS: Record<string, number> = { tutor: 0.75, easy: 0.9, average: 1, hard: 1.2, impossible: 1.4 };

export interface GovMods {
  food: number;
  industry: number;
  research: number;
  bc: number;
  morale: number;
  shipCost: number;
  command: number;
}

export function governmentMods(gov: Empire["government"]): GovMods {
  const m: GovMods = { food: 1, industry: 1, research: 1, bc: 1, morale: 0, shipCost: 1, command: 1 };
  switch (gov) {
    case "feudal":
      m.research = 0.5;
      m.shipCost = 0.67;
      break;
    case "confederation":
      m.research = 0.5;
      m.shipCost = 0.5;
      m.morale = 20;
      break;
    case "dictatorship":
      m.morale = -20;
      break;
    case "imperium":
      m.command = 1.5;
      m.morale = 0;
      break;
    case "democracy":
      m.research = 1.5;
      m.bc = 1.5;
      break;
    case "federation":
      m.research = 1.5;
      m.bc = 1.5;
      m.industry = 1.25;
      m.food = 1.25;
      break;
    case "unification":
      m.food = 1.5;
      m.industry = 1.5;
      break;
    case "galactic_unification":
      m.food = 2;
      m.industry = 2;
      m.research = 1.25;
      break;
  }
  return m;
}

export function gravityMult(t: RaceTraits, p: Planet, hasGravGen: boolean): number {
  if (hasGravGen) return 1;
  if (t.gravity === "low") return p.gravity === 0 ? 1 : p.gravity === 1 ? 0.75 : 0.5;
  if (t.gravity === "high") return 1;
  return p.gravity === 1 ? 1 : p.gravity === 0 ? 0.75 : 0.5;
}

export function effectiveClimatePop(t: RaceTraits, p: Planet): number {
  if (p.kind !== "habitable") return 0;
  let f = CLIMATE_POP[p.climate];
  if (t.aquatic && (p.climate === 5 || p.climate === 6)) f = 4;
  else if (t.aquatic && p.climate === 8) f = 5;
  if (t.tolerant && HOSTILE_CLIMATES.has(p.climate)) f += 1;
  return f;
}

export function maxPopulation(s: GameState, c: Colony | null, raceId: string, p: Planet, e: Empire): number {
  if (p.kind !== "habitable") return 0;
  const t = race(raceId).traits;
  const units = SIZE_UNITS[p.size];
  let max = units * effectiveClimatePop(t, p);
  if (t.subterranean) max += units;
  if (hasTech(e, "microbiotics")) max += 1;
  if (c) for (const b of c.buildings) max += BUILDING_BY_ID[b]?.maxPop ?? 0;
  void s;
  return Math.max(1, max);
}

export function isCapital(e: Empire, c: Colony): boolean {
  return e.homeColonyId === c.id;
}

export interface ColonyOutput {
  maxPop: number;
  foodPerFarmer: number;
  industryPerWorker: number;
  researchPerScientist: number;
  food: number;
  foodNeed: number;
  industryGross: number;
  pollution: number;
  industry: number; // after pollution, before tax
  taxed: number; // industry diverted into BC by tax
  production: number; // industry available to the build queue
  research: number;
  bc: number;
  upkeep: number;
  morale: number;
  growthK: number;
}

export function colonyMorale(s: GameState, c: Colony, e: Empire): number {
  const gm = governmentMods(e.government);
  let m = gm.morale;
  if ((e.government === "dictatorship" || e.government === "imperium") && c.buildings.includes("marine_barracks")) m = Math.max(m, 0);
  for (const b of c.buildings) m += BUILDING_BY_ID[b]?.morale ?? 0;
  if (c.raceId !== e.raceId && !c.buildings.includes("alien_management_center")) {
    const t = race(c.raceId).traits;
    if (e.government !== "unification" && !t.telepathic) m -= 20;
  }
  if (hasTech(e, "telepathic_training")) m += 10;
  if (race(e.raceId).traits.charismatic) m += 10;
  if (c.starving > 0) m -= 20;
  if (e.government === "unification" || e.government === "galactic_unification") m = Math.max(0, m);
  if (isCapital(e, c)) m += 20;
  return Math.max(-50, Math.min(100, m));
}

export function colonyOutput(s: GameState, c: Colony): ColonyOutput {
  const e = empire(s, c.owner);
  const p = planet(s, c.planetId);
  const t = race(c.raceId).traits;
  const et = race(e.raceId).traits;
  const gm = governmentMods(e.government);
  const has = (b: string) => c.buildings.includes(b);
  const gmul = gravityMult(t, p, has("planetary_gravity_generator"));
  const maxPop = c.outpost ? 0 : maxPopulation(s, c, c.raceId, p, e);
  const morale = c.outpost ? 0 : colonyMorale(s, c, e);
  const moraleMul = 1 + morale / 100;

  // food
  let baseFood = p.kind === "habitable" ? CLIMATE_FOOD[p.climate] : 0;
  if (t.aquatic && (p.climate === 5 || p.climate === 6)) baseFood += 1;
  let foodPerFarmer = 0;
  if (baseFood > 0) {
    foodPerFarmer = baseFood + t.food;
    for (const b of c.buildings) foodPerFarmer += BUILDING_BY_ID[b]?.foodPerFarmer ?? 0;
  }
  foodPerFarmer = Math.max(0, foodPerFarmer) * gmul;
  let flatFood = 0;
  for (const b of c.buildings) flatFood += BUILDING_BY_ID[b]?.food ?? 0;
  let food = (c.farmers * foodPerFarmer + flatFood) * gm.food;
  if (c.outpost) food = 0;
  const foodNeed = c.outpost || t.lithovore ? 0 : c.pop;

  // industry
  let ipw = MINERAL_INDUSTRY[p.minerals] + t.industry;
  let flatInd = 0;
  for (const b of c.buildings) {
    const d = BUILDING_BY_ID[b];
    if (!d) continue;
    ipw += d.industryPerWorker ?? 0;
    flatInd += d.industry ?? 0;
  }
  if (has("robotic_factory")) flatInd += [5, 10, 15, 20, 25][p.minerals];
  if (has("recyclotron")) flatInd += c.pop;
  ipw = Math.max(0.5, ipw) * gmul;
  let industryGross = c.outpost ? 0 : (c.workers * ipw + flatInd) * gm.industry * Math.max(0.5, moraleMul);
  let tolerance = POLLUTION_TOLERANCE[p.size];
  if (t.tolerant || t.cybernetic) tolerance *= 2;
  let pollMult = 0.5;
  for (const b of c.buildings) {
    const pm = BUILDING_BY_ID[b]?.pollutionMult;
    if (pm !== undefined) pollMult = Math.min(pollMult, pm * 0.5);
  }
  const pollution = Math.max(0, (industryGross - tolerance) * pollMult);
  industryGross = Math.round(industryGross * 10) / 10;
  const industry = Math.max(0, industryGross - pollution);

  // research
  let rps = RESEARCH_PER_SCIENTIST + t.research;
  let flatRes = 0;
  for (const b of c.buildings) {
    const d = BUILDING_BY_ID[b];
    if (!d) continue;
    rps += d.researchPerScientist ?? 0;
    flatRes += d.research ?? 0;
  }
  if (p.special === "artifacts") flatRes += 10;
  rps = Math.max(1, rps) * gmul;
  const aiMul = e.human ? 1 : (AI_BONUS[s.settings.difficulty] ?? 1);
  const research = c.outpost ? 0 : (c.scientists * rps + flatRes) * gm.research * Math.max(0.5, moraleMul) * aiMul;

  // money
  const taxed = (industry * e.taxRate) / 100;
  let taxMult = 1;
  for (const b of c.buildings) taxMult += BUILDING_BY_ID[b]?.taxMult ?? 0;
  let bc = c.outpost ? 0 : (c.pop * 0.5 * (1 + et.money) + taxed * taxMult) * gm.bc;
  for (const b of c.buildings) bc += (BUILDING_BY_ID[b]?.bcPerWorker ?? 0) * c.workers;
  if (!c.outpost && p.special === "gold") bc += 5;
  if (!c.outpost && p.special === "gems") bc += 10;
  let upkeep = 0;
  for (const b of c.buildings) upkeep += BUILDING_BY_ID[b]?.upkeep ?? 0;

  // growth (thousands per turn)
  let growthK = 0;
  if (!c.outpost && c.pop < maxPop) {
    growthK = Math.floor(Math.sqrt((3000 * c.pop * (maxPop - c.pop)) / maxPop));
    let gmult = 1 + t.growth;
    if (hasTech(e, "microbiotics")) gmult += 0.25;
    if (c.pop === 0) growthK = 0;
    growthK = Math.floor(growthK * Math.max(0.25, gmult));
    for (const b of c.buildings) growthK += BUILDING_BY_ID[b]?.growthK ?? 0;
  }
  const head = c.queue[0];
  const production = (industry - taxed) * aiMul;
  if (head && head.kind === "housing" && !c.outpost) growthK += Math.floor(production * 4);

  return {
    maxPop,
    foodPerFarmer,
    industryPerWorker: ipw,
    researchPerScientist: rps,
    food: Math.round(food * 10) / 10,
    foodNeed,
    industryGross,
    pollution: Math.round(pollution * 10) / 10,
    industry: Math.round(industry * 10) / 10,
    taxed: Math.round(taxed * 10) / 10,
    production: Math.round(production * 10) / 10,
    research: Math.round(research * 10) / 10,
    bc: Math.round(bc * 10) / 10,
    upkeep,
    morale,
    growthK,
  };
}

export interface EmpireSummary {
  food: number;
  foodNeed: number;
  freightCapacity: number;
  freightNeeded: number;
  industry: number;
  research: number;
  income: number;
  upkeep: number;
  freighterUpkeep: number;
  commandUsed: number;
  commandMax: number;
  commandUpkeep: number;
  net: number;
  population: number;
  colonies: number;
}

export function commandCapacity(s: GameState, e: Empire): number {
  let cp = 4;
  for (const c of coloniesOf(s, e.id)) for (const b of c.buildings) cp += BUILDING_BY_ID[b]?.command ?? 0;
  for (const t of ["tachyon_communications", "subspace_communications", "hyperspace_communications"]) if (hasTech(e, t)) cp += 2;
  return Math.floor(cp * governmentMods(e.government).command);
}

export function commandUsed(s: GameState, e: Empire): number {
  let used = 0;
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== e.id) continue;
    for (const sh of f.ships) {
      const d = s.designs[sh.designId];
      used += d.role === "combat" ? HULLS[d.hull].command : 1;
    }
  }
  return used;
}

export function empireSummary(s: GameState, e: Empire): EmpireSummary {
  let food = 0,
    foodNeed = 0,
    industry = 0,
    research = 0,
    income = 0,
    upkeep = 0,
    pop = 0,
    freightNeeded = 0;
  const cs = coloniesOf(s, e.id);
  for (const c of cs) {
    const o = colonyOutput(s, c);
    food += o.food;
    foodNeed += o.foodNeed;
    freightNeeded += Math.max(0, o.foodNeed - o.food);
    industry += o.production;
    research += o.research;
    income += o.bc;
    upkeep += o.upkeep;
    pop += c.pop;
  }
  // treaties
  for (const [otherId, r] of Object.entries(e.relations)) {
    const other = s.empires[Number(otherId)];
    if (!other?.alive) continue;
    if (r.trade) income += Math.min(pop, 30) * 0.25;
    if (r.research) research += Math.min(pop, 30) * 0.3;
  }
  if (hasTech(e, "galactic_currency_exchange")) income *= 1.1;
  const commandMax = commandCapacity(s, e);
  const commandUsedV = commandUsed(s, e);
  const commandUpkeep = Math.max(0, commandUsedV - commandMax);
  const freighterUpkeep = e.freighters * 0.5;
  const net = income - upkeep - freighterUpkeep - commandUpkeep;
  return {
    food: Math.round(food * 10) / 10,
    foodNeed,
    freightCapacity: e.freighters * 5,
    freightNeeded: Math.round(freightNeeded * 10) / 10,
    industry: Math.round(industry * 10) / 10,
    research: Math.round(research * 10) / 10,
    income: Math.round(income * 10) / 10,
    upkeep,
    freighterUpkeep,
    commandUsed: commandUsedV,
    commandMax,
    commandUpkeep,
    net: Math.round(net * 10) / 10,
    population: pop,
    colonies: cs.length,
  };
}

/** Assign jobs automatically: feed the colony first (where possible), then split by preference. */
export function autoAssignJobs(s: GameState, c: Colony, scienceShare = 0.4, extraFood = 0): void {
  if (c.outpost) {
    c.farmers = c.workers = c.scientists = 0;
    return;
  }
  c.farmers = 0;
  c.workers = c.pop;
  c.scientists = 0;
  const probe = colonyOutput(s, { ...c, farmers: 1, workers: 0, scientists: 0 });
  const flat = colonyOutput(s, { ...c, farmers: 0, workers: 0, scientists: 0 }).food;
  const per = probe.food - flat;
  let farmers = 0;
  if (per > 0) {
    const need = c.pop + extraFood - flat;
    farmers = Math.max(0, Math.min(c.pop, Math.ceil(need / per - 1e-9)));
  }
  const rest = c.pop - farmers;
  const sci = Math.round(rest * scienceShare);
  c.farmers = farmers;
  c.scientists = sci;
  c.workers = rest - sci;
}

/**
 * Empire-wide job allocation: the best farmland feeds everyone (freighters carry the surplus), the
 * remaining population is split between industry and research by `scienceShare`.
 * Only colonies in `managed` are changed; others keep their jobs and count as fixed supply/demand.
 */
export function allocateEmpireJobs(s: GameState, e: Empire, managed: Colony[], scienceShare: number): void {
  for (const c of managed) {
    if (c.outpost) continue;
    c.farmers = 0;
    c.scientists = Math.round(c.pop * scienceShare);
    c.workers = c.pop - c.scientists;
  }
  let deficit = 0;
  for (const c of coloniesOf(s, e.id)) {
    const o = colonyOutput(s, c);
    deficit += o.foodNeed - o.food;
  }
  const cands = managed
    .filter((c) => !c.outpost)
    .map((c) => ({ c, per: colonyOutput(s, { ...c, farmers: 1, workers: 0, scientists: 0 }).food - colonyOutput(s, { ...c, farmers: 0, workers: 0, scientists: 0 }).food }))
    .filter((x) => x.per > 0)
    .sort((a, b) => b.per - a.per || a.c.id - b.c.id);
  for (const { c, per } of cands) {
    while (deficit > 0 && c.farmers < c.pop) {
      if (c.workers > 0 && (c.workers >= c.scientists || c.scientists === 0)) c.workers--;
      else if (c.scientists > 0) c.scientists--;
      else break;
      c.farmers++;
      deficit -= per;
    }
    if (deficit <= 0) break;
  }
}

export function clampJobs(c: Colony): void {
  const total = c.farmers + c.workers + c.scientists;
  if (total === c.pop) return;
  if (total < c.pop) {
    c.workers += c.pop - total;
    return;
  }
  let over = total - c.pop;
  for (const k of ["workers", "scientists", "farmers"] as const) {
    const take = Math.min(over, c[k]);
    c[k] -= take;
    over -= take;
  }
}
