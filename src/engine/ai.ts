// Computer players. Project-authored heuristics: research choice, job allocation, build queues,
// colonisation, scouting, fleet concentration, attacks and invasions. Also used for the human's
// optional colony governors (buildings only).

import type { Colony, Empire, Fleet, GameState, Planet, ShipDesign } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import type { Rng } from "./rng.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { HULLS } from "./data/ships.ts";
import { addDesign, autoDesign, availableHulls, designStats, designsOf, shipStrength } from "./designs.ts";
import { allocateEmpireJobs, colonyOutput, empireSummary, maxPopulation } from "./economy.ts";
import { colonize, fleetRange, inRange, orderMove, splitFleet, supplyDistance } from "./fleets.ts";
import { bombard, fleetBombs, fleetTroops, invade, orbitBlocked } from "./ground.ts";
import { availableBuildings, buy, buyCost, enqueue, stationTier } from "./production.ts";
import { aiChooseResearch } from "./research.ts";
import { atWar, coloniesOf, dist } from "./state.ts";

const BUILD_PRIORITY = [
  "automated_factory",
  "hydroponic_farm",
  "research_laboratory",
  "biospheres",
  "soil_enrichment",
  "space_port",
  "robo_miner_plant",
  "pollution_processor",
  "cloning_center",
  "planetary_supercomputer",
  "holo_simulator",
  "astro_university",
  "planetary_stock_exchange",
  "deep_core_mine",
  "robotic_factory",
  "autolab",
  "subterranean_farms",
  "weather_control_system",
  "atmospheric_renewer",
  "recyclotron",
  "galactic_cybernet",
  "advanced_city_planning",
  "pleasure_dome",
  "virtual_reality_network",
  "core_waste_dump",
  "alien_management_center",
  "planetary_gravity_generator",
  "galactic_currency_exchange",
];
const DEFENSE_PRIORITY = ["missile_base", "star_base", "planetary_radiation_shield", "ground_batteries", "battlestation", "planetary_flux_shield", "star_fortress", "artemis_system_net", "planetary_barrier_shield"];

function roleOf(s: GameState, f: Fleet): ShipDesign["role"] | "mixed" {
  const roles = new Set(f.ships.map((sh) => s.designs[sh.designId].role));
  return roles.size === 1 ? [...roles][0] : "mixed";
}

function fleetStrength(s: GameState, f: Fleet): number {
  const e = f.owner >= 0 ? s.empires[f.owner] : null;
  let p = 0;
  for (const sh of f.ships) p += shipStrength(s.designs[sh.designId], e);
  return p;
}

export function starDefenseStrength(s: GameState, starId: number, against: number): number {
  let p = 0;
  for (const f of Object.values(s.fleets)) {
    if (f.starId !== starId || f.owner === against) continue;
    if (f.owner !== MONSTER_OWNER && !atWar(s, against, f.owner)) continue;
    p += fleetStrength(s, f);
  }
  for (const c of Object.values(s.colonies)) {
    if (c.starId !== starId || !atWar(s, against, c.owner)) continue;
    p += stationTier(c) * 25;
    for (const b of c.buildings) if (BUILDING_BY_ID[b]?.defense && !BUILDING_BY_ID[b]?.station) p += 20;
  }
  return p;
}

/** Separate mixed fleets so each role can be ordered independently. */
function sortFleets(s: GameState, e: Empire): void {
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== e.id || f.starId === null || f.destStarId !== null) continue;
    if (roleOf(s, f) !== "mixed") continue;
    const byRole = new Map<string, number[]>();
    for (const sh of f.ships) {
      const r = s.designs[sh.designId].role;
      byRole.set(r, [...(byRole.get(r) ?? []), sh.id]);
    }
    const roles = [...byRole.keys()];
    for (const r of roles.slice(1)) splitFleet(s, f.id, byRole.get(r)!);
  }
  // merge idle warfleets sharing a star
  const idle = Object.values(s.fleets).filter((f) => f.owner === e.id && f.starId !== null && f.destStarId === null && roleOf(s, f) === "combat");
  const byStar = new Map<number, Fleet>();
  for (const f of idle) {
    const first = byStar.get(f.starId!);
    if (first) {
      first.ships.push(...f.ships);
      delete s.fleets[f.id];
    } else byStar.set(f.starId!, f);
  }
}

function planetValue(s: GameState, e: Empire, p: Planet, forColonyShip: boolean): number {
  if (p.colonyId !== null) return -1;
  if (forColonyShip) {
    if (p.kind !== "habitable") return -1;
    const mp = maxPopulation(s, null, e.raceId, p, e);
    if (mp < 3) return -1;
    return mp * 2 + p.minerals * 2 + (p.special !== "none" ? 4 : 0);
  }
  // outposts: anything not good enough for a colony ship
  const mp = p.kind === "habitable" ? maxPopulation(s, null, e.raceId, p, e) : 0;
  if (mp >= 6) return -1;
  return 4 + p.minerals + (p.kind === "asteroids" || p.kind === "gasgiant" ? 2 : 0) + (p.special !== "none" ? 3 : 0);
}

function systemSafe(s: GameState, e: Empire, starId: number): boolean {
  return !Object.values(s.fleets).some((f) => f.starId === starId && f.owner !== e.id && (f.owner === MONSTER_OWNER || atWar(s, e.id, f.owner)));
}

function claimedTargets(s: GameState, e: Empire): Set<number> {
  const out = new Set<number>();
  for (const f of Object.values(s.fleets)) if (f.owner === e.id && f.targetPlanetId !== null) out.add(f.targetPlanetId);
  return out;
}

function bestSettleTarget(s: GameState, e: Empire, f: Fleet, colonyShip: boolean): Planet | null {
  const claimed = claimedTargets(s, e);
  let best: Planet | null = null;
  let bestScore = 0;
  const range = fleetRange(s, f);
  for (const p of s.planets) {
    if (claimed.has(p.id) && f.targetPlanetId !== p.id) continue;
    const st = s.stars[p.starId];
    if (!st.exploredBy.includes(e.id) && st.id !== f.starId) continue;
    const v = planetValue(s, e, p, colonyShip);
    if (v <= 0) continue;
    if (!systemSafe(s, e, st.id)) continue;
    if (supplyDistance(s, e, st.x, st.y) > range) continue;
    const d = dist(f.x, f.y, st.x, st.y);
    const score = v / (1 + d / 4);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function handleSettler(s: GameState, e: Empire, f: Fleet, colonyShip: boolean): void {
  if (f.destStarId !== null) return;
  if (f.targetPlanetId !== null) {
    const p = s.planets[f.targetPlanetId];
    if (p.colonyId === null && f.starId === p.starId) {
      const r = colonize(s, f.id, p.id, !colonyShip);
      if (typeof r !== "string") return;
    }
    if (p.colonyId !== null || !systemSafe(s, e, p.starId)) f.targetPlanetId = null;
  }
  const target = bestSettleTarget(s, e, f, colonyShip);
  if (!target) return;
  f.targetPlanetId = target.id;
  if (f.starId === target.starId) {
    colonize(s, f.id, target.id, !colonyShip);
  } else if (orderMove(s, f.id, target.starId)) {
    f.targetPlanetId = null;
  }
}

function handleScout(s: GameState, e: Empire, f: Fleet, claimedStars: Set<number>): void {
  if (f.destStarId !== null) return;
  let best: number | null = null;
  let bd = Infinity;
  for (const st of s.stars) {
    if (st.exploredBy.includes(e.id) || claimedStars.has(st.id)) continue;
    if (!inRange(s, f, st.id)) continue;
    const d = dist(f.x, f.y, st.x, st.y);
    if (d < bd) {
      bd = d;
      best = st.id;
    }
  }
  if (best !== null) {
    claimedStars.add(best);
    orderMove(s, f.id, best);
  }
}

function enemyColonyTargets(s: GameState, e: Empire): Colony[] {
  return Object.values(s.colonies).filter((c) => c.owner !== e.id && atWar(s, e.id, c.owner));
}

function handleWarfleets(s: GameState, e: Empire, rng: Rng): void {
  const home = e.capitalStarId;
  const fleets = Object.values(s.fleets).filter((f) => f.owner === e.id && roleOf(s, f) === "combat" && f.destStarId === null && f.starId !== null);
  const targets = enemyColonyTargets(s, e);
  for (const f of fleets) {
    const str = fleetStrength(s, f);
    if (str <= 0) continue;
    // bombard when in orbit of an undefended enemy colony and no troops are coming
    if (f.starId !== null && fleetBombs(s, f) > 0) {
      const c = Object.values(s.colonies).find((x) => x.starId === f.starId && atWar(s, e.id, x.owner));
      if (c && !orbitBlocked(s, f, c) && rng.chance(0.5)) bombard(s, f.id, c.id, rng);
    }
    if (targets.length) {
      let best: Colony | null = null;
      let bestScore = -Infinity;
      for (const c of targets) {
        const st = s.stars[c.starId];
        if (!inRange(s, f, st.id)) continue;
        const def = starDefenseStrength(s, st.id, e.id);
        if (def * 1.3 > str) continue;
        const score = c.pop * 2 + (c.outpost ? 1 : 4) - dist(f.x, f.y, st.x, st.y) - def / 20;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best && f.starId !== best.starId) {
        orderMove(s, f.id, best.starId);
        e.ai.targetEmpire = best.owner;
        continue;
      }
      if (best) continue; // hold orbit over the target
    }
    // clear nearby monster lairs once strong enough
    if (s.turn > 25) {
      const lair = Object.values(s.fleets).find((m) => m.owner === MONSTER_OWNER && m.starId !== null && s.stars[m.starId].special !== "orion" && inRange(s, f, m.starId) && fleetStrength(s, m) * 1.6 < str);
      if (lair && lair.starId !== null && lair.starId !== f.starId) {
        orderMove(s, f.id, lair.starId);
        continue;
      }
    }
    if (f.starId !== home && !targets.length) orderMove(s, f.id, home);
  }
}

function handleTransports(s: GameState, e: Empire, rng: Rng): void {
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== e.id || f.destStarId !== null || f.starId === null || roleOf(s, f) !== "transport") continue;
    const here = Object.values(s.colonies).find((c) => c.starId === f.starId && atWar(s, e.id, c.owner));
    if (here && !orbitBlocked(s, f, here)) {
      if (fleetTroops(s, f) >= Math.max(2, Math.ceil(here.pop / 2) + 2)) {
        invade(s, f.id, here.id, rng);
        continue;
      }
    }
    // follow a warfleet sitting over an enemy colony
    const escort = Object.values(s.fleets).find((w) => w.owner === e.id && w.starId !== null && roleOf(s, w) === "combat" && Object.values(s.colonies).some((c) => c.starId === w.starId && atWar(s, e.id, c.owner)));
    if (escort && escort.starId !== f.starId && inRange(s, f, escort.starId!)) orderMove(s, f.id, escort.starId!);
  }
}

function ensureDesigns(s: GameState, e: Empire, rng: Rng): void {
  if (s.turn % 8 !== 1 && designsOf(s, e).some((d) => d.role === "combat")) return;
  const hulls = availableHulls(e).filter((h) => h <= 4);
  const caps = coloniesOf(s, e.id).map((c) => colonyOutput(s, c).production);
  const bestProd = Math.max(1, ...caps);
  // largest hull the best yard can build in ~8 turns
  let hull = 0;
  for (const h of hulls) if (HULLS[h].cost * 2.2 <= bestProd * 8) hull = h;
  const style = rng.chance(0.3) ? "missile" : "mixed";
  const bomber = s.turn > 40 && rng.chance(0.25);
  const name = `${["Lancer", "Warden", "Striker", "Paladin", "Reaver", "Sentinel", "Vanguard", "Talon"][rng.int(8)]} ${HULLS[hull].name[0]}${s.turn}`;
  const d = autoDesign(e, hull, name, style, bomber);
  const prior = designsOf(s, e).filter((x) => x.role === "combat");
  const st = designStats(d, e);
  if (!st.armed) return;
  const same = prior.find((p) => p.hull === d.hull && JSON.stringify(p.weapons) === JSON.stringify(d.weapons) && p.armor === d.armor && p.shield === d.shield && p.computer === d.computer && p.drive === d.drive);
  if (same) return;
  addDesign(s, d);
  // keep the three newest warship designs
  const combat = designsOf(s, e).filter((x) => x.role === "combat");
  for (const old of combat.slice(0, Math.max(0, combat.length - 3))) old.obsolete = true;
  // refresh support designs with the best drive/armor
  for (const role of ["colony", "outpost", "transport", "scout"] as const) {
    const cur = designsOf(s, e).find((x) => x.role === role);
    if (cur && cur.drive !== d.drive) {
      const nd = { ...cur, drive: d.drive, armor: d.armor };
      cur.obsolete = true;
      addDesign(s, nd);
    }
  }
}

function countShips(s: GameState, e: Empire, role: ShipDesign["role"]): number {
  let n = 0;
  for (const f of Object.values(s.fleets)) if (f.owner === e.id) for (const sh of f.ships) if (s.designs[sh.designId].role === role) n++;
  for (const c of coloniesOf(s, e.id)) for (const q of c.queue) if (q.kind === "ship" && s.designs[q.designId].role === role) n++;
  return n;
}

function designFor(s: GameState, e: Empire, role: ShipDesign["role"]): ShipDesign | null {
  const ds = designsOf(s, e).filter((d) => d.role === role);
  return ds.length ? ds[ds.length - 1] : null;
}

function pickBuilding(s: GameState, c: Colony, e: Empire, prod: number, defensive: boolean): string | null {
  const avail = new Set(availableBuildings(s, c).map((b) => b.id));
  const out = colonyOutput(s, c);
  const list = defensive ? [...DEFENSE_PRIORITY.slice(0, 3), ...BUILD_PRIORITY, ...DEFENSE_PRIORITY.slice(3)] : BUILD_PRIORITY;
  for (const id of list) {
    if (!avail.has(id)) continue;
    const b = BUILDING_BY_ID[id];
    if (b.cost > Math.max(prod, 1) * 18) continue;
    if (id === "hydroponic_farm" && out.food >= out.foodNeed + 2 && !c.outpost) continue;
    if ((id === "pollution_processor" || id === "atmospheric_renewer" || id === "core_waste_dump") && out.pollution < 2) continue;
    if (id === "holo_simulator" && out.morale >= 0) continue;
    if (id === "planetary_gravity_generator" && s.planets[c.planetId].gravity === 1) continue;
    if ((id === "research_laboratory" || id === "planetary_supercomputer" || id === "autolab" || id === "galactic_cybernet") && c.scientists < 2) continue;
    if (id === "alien_management_center" && c.raceId === e.raceId) continue;
    if (id === "space_port" && c.pop < 6) continue;
    if (e.bc < 0 && b.upkeep > 1) continue;
    return id;
  }
  return null;
}

/** Fill one colony's queue. `shipsAllowed` is false for the human's governors. */
export function fillQueue(s: GameState, c: Colony, e: Empire, rng: Rng, shipsAllowed: boolean): void {
  if (c.queue.length) return;
  const out = colonyOutput(s, c);
  const prod = out.production;
  if (c.outpost) {
    return;
  }
  const atWarAny = Object.values(e.relations).some((r) => r.treaty === "war");
  const isCap = e.homeColonyId === c.id;
  const yard = isCap || prod >= 8;
  if (shipsAllowed && yard) {
    const summary = empireSummary(s, e);
    const colonyShips = countShips(s, e, "colony");
    const outposts = countShips(s, e, "outpost");
    const scouts = countShips(s, e, "scout");
    const unexplored = s.stars.some((st) => !st.exploredBy.includes(e.id) && supplyDistance(s, e, st.x, st.y) <= 6);
    const warPower = Object.values(s.fleets).filter((f) => f.owner === e.id).reduce((a, f) => a + fleetStrength(s, f), 0);
    const wantPower = 8 + s.turn * (0.6 + e.ai.aggression * 1.2) * (atWarAny ? 1.6 : 1);
    const want: [string, number][] = [];
    if (summary.freightNeeded > summary.freightCapacity) want.push(["freighters", 6]);
    if (scouts < 2 && unexplored && s.turn < 80) want.push(["scout", 3]);
    if (colonyShips < 1 + Math.floor(e.ai.expansion * 1.5) && summary.colonies < 4 + s.turn / 6) want.push(["colony", 4 + e.ai.expansion * 3]);
    if (outposts < 1 + Math.floor(e.ai.expansion) && s.turn > 5) want.push(["outpost", 2 + e.ai.expansion * 2]);
    if (warPower < wantPower && summary.commandUsed < summary.commandMax + 2) want.push(["combat", 3 + e.ai.aggression * 4 + (atWarAny ? 4 : 0)]);
    if (atWarAny && countShips(s, e, "transport") < 3 && s.turn > 20) want.push(["transport", 2 + e.ai.aggression * 2]);
    if (e.spies < 2 && s.turn > 30) want.push(["spy", 1]);
    const bld = pickBuilding(s, c, e, prod, atWarAny);
    if (bld) want.push(["building", isCap ? 3 : 5]);
    if (want.length) {
      const choice = rng.weighted(want.map(([k, w]) => [k, w] as const));
      if (choice === "building" && bld) {
        enqueue(s, c, { kind: "building", id: bld });
        return;
      }
      if (choice === "freighters" || choice === "spy") {
        enqueue(s, c, { kind: choice });
        return;
      }
      const d = designFor(s, e, choice as ShipDesign["role"]);
      if (d) {
        enqueue(s, c, { kind: "ship", designId: d.id });
        if (choice === "combat" && prod > 25) enqueue(s, c, { kind: "ship", designId: d.id });
        return;
      }
    }
  }
  const bld = pickBuilding(s, c, e, prod, false);
  if (bld) {
    enqueue(s, c, { kind: "building", id: bld });
    return;
  }
  enqueue(s, c, c.pop < out.maxPop - 1 && prod < 10 ? { kind: "housing" } : { kind: "tradegoods" });
}

export function aiTurn(s: GameState, e: Empire, rng: Rng): void {
  if (!e.alive) return;
  if (!e.research.targetTech) e.research.targetTech = aiChooseResearch(e, rng);
  e.taxRate = e.bc < 30 ? 30 : e.bc > 200 ? 0 : 10;
  allocateEmpireJobs(s, e, coloniesOf(s, e.id), 0.25 + e.ai.science * 0.3);
  ensureDesigns(s, e, rng);
  for (const c of coloniesOf(s, e.id)) fillQueue(s, c, e, rng, true);
  // scrap obsolete-design queue entries
  for (const c of coloniesOf(s, e.id)) c.queue = c.queue.filter((q) => q.kind !== "ship" || !s.designs[q.designId].obsolete);
  sortFleets(s, e);
  const claimedStars = new Set<number>();
  for (const f of Object.values(s.fleets)) if (f.owner === e.id && f.destStarId !== null) claimedStars.add(f.destStarId);
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== e.id || !s.fleets[f.id]) continue;
    const role = roleOf(s, f);
    if (role === "colony") handleSettler(s, e, f, true);
    else if (role === "outpost") handleSettler(s, e, f, false);
    else if (role === "scout") handleScout(s, e, f, claimedStars);
  }
  handleWarfleets(s, e, rng);
  handleTransports(s, e, rng);
  // spend surplus treasury: rush the most advanced project at the colony that benefits most
  let budget = e.bc - 60 - s.turn * 0.5;
  const rush = coloniesOf(s, e.id)
    .filter((c) => c.queue.length && buyCost(s, c) > 0)
    .sort((a, b) => buyCost(s, a) - buyCost(s, b));
  for (const c of rush) {
    const price = buyCost(s, c);
    if (price > budget) break;
    if (!buy(s, c)) budget -= price;
  }
}

/** Human colony governors: jobs and building queues only. */
export function governTurn(s: GameState, e: Empire, rng: Rng): void {
  for (const c of coloniesOf(s, e.id)) {
    if (!c.governor) continue;
    fillQueue(s, c, e, rng, false);
  }
  const managed = coloniesOf(s, e.id).filter((c) => c.governor);
  if (managed.length) allocateEmpireJobs(s, e, managed, 0.4);
}
