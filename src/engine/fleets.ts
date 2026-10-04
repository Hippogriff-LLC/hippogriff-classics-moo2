// Fleet movement, fuel range, detection, exploration, contacts and colonisation.

import type { Colony, Empire, Fleet, GameState, Planet } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import { designStats } from "./designs.ts";
import { maxPopulation } from "./economy.ts";
import { race } from "./data/races.ts";
import { aliveEmpires, coloniesOf, colonyName, dist, empire, fleets, hasTech, msg, planet, planetName, relation, star } from "./state.ts";
import { createColony, explore, makeContact, pruneFleets } from "./world.ts";

export function fuelRange(e: Empire): number {
  if (hasTech(e, "thorium_fuel_cells")) return Infinity;
  if (hasTech(e, "uridium_fuel_cells")) return 11;
  if (hasTech(e, "iridium_fuel_cells")) return 8;
  if (hasTech(e, "deuterium_fuel_cells")) return 6;
  return 4;
}

/** Stars that provide supply to an empire: its own colonies and allies' colonies. */
export function supplyStars(s: GameState, e: Empire): number[] {
  const out = new Set<number>();
  for (const c of Object.values(s.colonies)) {
    if (c.owner === e.id) out.add(c.starId);
    else if (relation(s, e.id, c.owner)?.treaty === "alliance") out.add(c.starId);
  }
  return [...out];
}

export function supplyDistance(s: GameState, e: Empire, x: number, y: number): number {
  let best = Infinity;
  for (const sid of supplyStars(s, e)) {
    const st = s.stars[sid];
    best = Math.min(best, dist(st.x, st.y, x, y));
  }
  return best;
}

export function fleetSpeed(s: GameState, f: Fleet): number {
  if (f.owner === MONSTER_OWNER) return 1;
  const e = s.empires[f.owner];
  let sp = Infinity;
  for (const sh of f.ships) sp = Math.min(sp, designStats(s.designs[sh.designId], e).speed);
  return sp === Infinity ? 0 : sp;
}

export function fleetRange(s: GameState, f: Fleet): number {
  const e = s.empires[f.owner];
  if (!e) return Infinity;
  let mult = Infinity;
  for (const sh of f.ships) mult = Math.min(mult, designStats(s.designs[sh.designId], e).rangeMult);
  return fuelRange(e) * (mult === Infinity ? 1 : mult);
}

export function inRange(s: GameState, f: Fleet, destStarId: number): boolean {
  const e = s.empires[f.owner];
  if (!e) return false;
  const st = star(s, destStarId);
  return supplyDistance(s, e, st.x, st.y) <= fleetRange(s, f) + 1e-9;
}

/** Turns needed to reach a star (wormholes take one turn). */
export function etaTurns(s: GameState, f: Fleet, destStarId: number): number {
  if (f.starId !== null && star(s, f.starId).wormholeTo === destStarId) return 1;
  const st = star(s, destStarId);
  const sp = fleetSpeed(s, f);
  if (sp <= 0) return Infinity;
  return Math.max(1, Math.ceil(dist(f.x, f.y, st.x, st.y) / sp - 1e-9));
}

export function orderMove(s: GameState, fleetId: number, destStarId: number): string | null {
  const f = s.fleets[fleetId];
  if (!f) return "no such fleet";
  if (f.owner === MONSTER_OWNER) return "monsters cannot be ordered";
  if (!s.stars[destStarId]) return "no such star";
  if (f.starId === destStarId) {
    f.destStarId = null;
    return null;
  }
  if (!inRange(s, f, destStarId)) return "destination is out of fuel range";
  if (fleetSpeed(s, f) <= 0) return "fleet cannot move";
  if (f.starId !== null) f.originStarId = f.starId;
  f.destStarId = destStarId;
  f.order = "none";
  return null;
}

export function splitFleet(s: GameState, fleetId: number, shipIds: number[]): Fleet | null {
  const f = s.fleets[fleetId];
  if (!f || f.starId === null) return null;
  const take = f.ships.filter((sh) => shipIds.includes(sh.id));
  if (!take.length || take.length === f.ships.length) return null;
  f.ships = f.ships.filter((sh) => !shipIds.includes(sh.id));
  const id = s.nextId.fleet++;
  const nf: Fleet = { ...f, id, ships: take, destStarId: null, order: "none", targetPlanetId: null, name: `Fleet ${id}` };
  s.fleets[id] = nf;
  return nf;
}

export function mergeFleets(s: GameState, intoId: number, fromId: number): boolean {
  const a = s.fleets[intoId];
  const b = s.fleets[fromId];
  if (!a || !b || a === b || a.owner !== b.owner || a.starId === null || a.starId !== b.starId) return false;
  a.ships.push(...b.ships);
  delete s.fleets[fromId];
  return true;
}

/** Move all fleets one turn. Returns ids of fleets that arrived this turn. */
export function moveFleets(s: GameState): number[] {
  const arrived: number[] = [];
  for (const f of fleets(s)) {
    if (f.destStarId === null) continue;
    const dest = star(s, f.destStarId);
    if (f.starId !== null && star(s, f.starId).wormholeTo === f.destStarId) {
      f.x = dest.x;
      f.y = dest.y;
    } else {
      const sp = fleetSpeed(s, f);
      const d = dist(f.x, f.y, dest.x, dest.y);
      if (d <= sp + 1e-9) {
        f.x = dest.x;
        f.y = dest.y;
      } else {
        f.x += ((dest.x - f.x) / d) * sp;
        f.y += ((dest.y - f.y) / d) * sp;
        f.starId = null;
        continue;
      }
    }
    f.starId = dest.id;
    f.destStarId = null;
    arrived.push(f.id);
    if (explore(s, f.owner, dest.id)) {
      msg(s, f.owner, "info", `${f.name} explored the ${dest.name} system.`, { starId: dest.id });
    }
  }
  return arrived;
}

export function scanRange(e: Empire): { colony: number; fleet: number } {
  let colony = 2;
  let fleet = 1;
  if (hasTech(e, "space_scanner")) {
    colony += 1;
    fleet += 1;
  }
  if (hasTech(e, "tachyon_scanner")) {
    colony += 2;
    fleet += 1;
  }
  if (hasTech(e, "neutron_scanner")) {
    colony += 3;
    fleet += 1;
  }
  if (race(e.raceId).traits.omniscient) colony += 50;
  return { colony, fleet };
}

/** Whether `empireId` currently sees fleet `f`. */
export function fleetVisible(s: GameState, empireId: number, f: Fleet): boolean {
  if (f.owner === empireId) return true;
  const e = s.empires[empireId];
  if (!e) return true;
  const r = scanRange(e);
  for (const c of coloniesOf(s, empireId)) {
    const st = s.stars[c.starId];
    if (dist(st.x, st.y, f.x, f.y) <= r.colony) return true;
  }
  for (const own of Object.values(s.fleets)) {
    if (own.owner !== empireId) continue;
    if (dist(own.x, own.y, f.x, f.y) <= r.fleet) return true;
  }
  return false;
}

/** Establish contacts between empires whose assets can see each other. */
export function updateContacts(s: GameState): void {
  const alive = aliveEmpires(s);
  for (const a of alive) {
    for (const b of alive) {
      if (a.id >= b.id) continue;
      if (relation(s, a.id, b.id)?.contact) continue;
      let seen = false;
      for (const f of Object.values(s.fleets)) {
        if (f.owner === b.id && fleetVisible(s, a.id, f)) seen = true;
        else if (f.owner === a.id && fleetVisible(s, b.id, f)) seen = true;
        if (seen) break;
      }
      if (!seen) {
        const ra = scanRange(a).colony;
        outer: for (const ca of coloniesOf(s, a.id)) {
          for (const cb of coloniesOf(s, b.id)) {
            const A = s.stars[ca.starId];
            const B = s.stars[cb.starId];
            if (dist(A.x, A.y, B.x, B.y) <= ra) {
              seen = true;
              break outer;
            }
          }
        }
      }
      if (seen) makeContact(s, a.id, b.id);
    }
  }
}

export function colonyShipIndex(s: GameState, f: Fleet, role: "colony" | "outpost"): number {
  return f.ships.findIndex((sh) => s.designs[sh.designId].role === role);
}

export function canColonize(s: GameState, f: Fleet, p: Planet): string | null {
  if (f.starId !== p.starId) return "fleet is not at that system";
  if (p.colonyId !== null) return "planet already settled";
  const enemies = Object.values(s.fleets).some((o) => o.starId === p.starId && o.owner !== f.owner && (o.owner === MONSTER_OWNER || relation(s, f.owner, o.owner)?.treaty === "war") && o.ships.some((sh) => designStats(s.designs[sh.designId], null).armed));
  if (enemies) return "hostile ships are in orbit";
  const hasColony = colonyShipIndex(s, f, "colony") >= 0;
  const hasOutpost = colonyShipIndex(s, f, "outpost") >= 0;
  if (p.kind === "habitable" && hasColony) return null;
  if (hasOutpost) return null;
  if (hasColony) return "colony ships can only settle habitable planets (use an outpost ship)";
  return "fleet has no colony or outpost ship";
}

/** Settle a planet with a colony ship (habitable) or an outpost ship. Prefers a colony ship when sensible. */
export function colonize(s: GameState, fleetId: number, planetId: number, preferOutpost = false): Colony | string {
  const f = s.fleets[fleetId];
  if (!f) return "no such fleet";
  const p = planet(s, planetId);
  const err = canColonize(s, f, p);
  if (err) return err;
  const e = empire(s, f.owner);
  const ci = colonyShipIndex(s, f, "colony");
  const oi = colonyShipIndex(s, f, "outpost");
  const useColony = p.kind === "habitable" && ci >= 0 && !(preferOutpost && oi >= 0);
  const idx = useColony ? ci : oi;
  f.ships.splice(idx, 1);
  const c = createColony(s, f.owner, planetId, e.raceId, 1, !useColony);
  if (useColony && maxPopulation(s, c, c.raceId, p, e) < 1) c.pop = 1;
  if (p.special === "ruins") {
    p.special = "none";
    e.bc += 150;
    msg(s, e.id, "event", `Ancient ruins on ${planetName(s, p)} yielded 150 BC of artifacts.`, { starId: p.starId });
  }
  msg(s, e.id, "colony", `${useColony ? "Colony" : "Outpost"} established at ${colonyName(s, c)}.`, { starId: p.starId, colonyId: c.id });
  pruneFleets(s);
  return c;
}

/** Fleets that are out of supply slowly lose nothing; ships repair inside supply. */
export function repairShips(s: GameState): void {
  for (const f of Object.values(s.fleets)) {
    const e = f.owner >= 0 ? s.empires[f.owner] : null;
    const atColony = f.starId !== null && Object.values(s.colonies).some((c) => c.starId === f.starId && c.owner === f.owner);
    const dock = atColony && Object.values(s.colonies).some((c) => c.starId === f.starId && c.owner === f.owner && c.buildings.some((b) => b === "star_base" || b === "battlestation" || b === "star_fortress"));
    for (const sh of f.ships) {
      const st = designStats(s.designs[sh.designId], e);
      const frac = dock ? 1 : atColony ? 0.5 : f.owner === MONSTER_OWNER ? 0.2 : 0.1;
      sh.hp.structure = Math.min(st.structure, sh.hp.structure + Math.ceil(st.structure * frac));
      sh.hp.armor = Math.min(st.armor, sh.hp.armor + Math.ceil(st.armor * frac));
    }
  }
}
