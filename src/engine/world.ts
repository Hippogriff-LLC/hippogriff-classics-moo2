// Creation/removal of ships, fleets and colonies, plus exploration and contact bookkeeping.

import type { Colony, Fleet, GameState, Ship } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import { designStats } from "./designs.ts";
import { autoAssignJobs } from "./economy.ts";
import { colonyName, empire, msg, planet, star } from "./state.ts";

export function newShip(s: GameState, designId: number, name?: string): Ship {
  const d = s.designs[designId];
  const owner = d.owner >= 0 ? s.empires[d.owner] : null;
  const st = designStats(d, owner);
  const id = s.nextId.ship++;
  return { id, designId, name: name ?? `${d.name} ${id}`, hp: { structure: st.structure, armor: st.armor }, xp: 0 };
}

export function spawnFleet(s: GameState, owner: number, starId: number, designIds: number[], name?: string): Fleet {
  const st = star(s, starId);
  const id = s.nextId.fleet++;
  const f: Fleet = {
    id,
    owner,
    x: st.x,
    y: st.y,
    starId,
    destStarId: null,
    originStarId: starId,
    ships: designIds.map((d) => newShip(s, d)),
    order: "none",
    targetPlanetId: null,
    name: name ?? `Fleet ${id}`,
  };
  s.fleets[id] = f;
  return f;
}

export function removeFleet(s: GameState, fleetId: number): void {
  delete s.fleets[fleetId];
}

/** Drop empty fleets. */
export function pruneFleets(s: GameState): void {
  for (const f of Object.values(s.fleets)) if (!f.ships.length) delete s.fleets[f.id];
}

/** Add ships to an idle fleet of the owner at the star whose ships all share the new ships' role, or create one. */
export function addShipsAt(s: GameState, owner: number, starId: number, ships: Ship[]): Fleet {
  const role = ships.length ? s.designs[ships[0].designId].role : "combat";
  let f = Object.values(s.fleets).find((x) => x.owner === owner && x.starId === starId && x.destStarId === null && x.ships.length > 0 && x.ships.every((sh) => s.designs[sh.designId].role === role));
  if (!f) {
    const label: Record<string, string> = { colony: "Colony Fleet", outpost: "Outpost Fleet", transport: "Transports", scout: "Scout", combat: "Task Force" };
    f = spawnFleet(s, owner, starId, []);
    f.name = `${label[role] ?? "Fleet"} ${f.id}`;
  }
  f.ships.push(...ships);
  return f;
}

export function createColony(s: GameState, owner: number, planetId: number, raceId: string, pop: number, outpost: boolean): Colony {
  const p = planet(s, planetId);
  if (p.colonyId !== null) throw new Error("planet already colonized");
  const id = s.nextId.colony++;
  const c: Colony = {
    id,
    planetId,
    starId: p.starId,
    owner,
    raceId,
    outpost,
    pop: outpost ? 0 : pop,
    growth: 0,
    farmers: 0,
    workers: 0,
    scientists: 0,
    buildings: [],
    queue: [],
    progress: 0,
    founded: s.turn,
    governor: !empire(s, owner).human,
    starving: 0,
    rebel: 0,
  };
  s.colonies[id] = c;
  p.colonyId = id;
  explore(s, owner, p.starId);
  if (!outpost) autoAssignJobs(s, c);
  return c;
}

export function removeColony(s: GameState, colonyId: number): void {
  const c = s.colonies[colonyId];
  if (!c) return;
  planet(s, c.planetId).colonyId = null;
  delete s.colonies[colonyId];
  const e = s.empires[c.owner];
  if (e && e.homeColonyId === colonyId) e.homeColonyId = null;
}

export function transferColony(s: GameState, c: Colony, newOwner: number): void {
  const old = s.empires[c.owner];
  if (old && old.homeColonyId === c.id) old.homeColonyId = null;
  c.owner = newOwner;
  c.queue = [];
  c.progress = 0;
  c.buildings = c.buildings.filter((b) => b !== "capitol");
  c.governor = !empire(s, newOwner).human;
  autoAssignJobs(s, c);
  explore(s, newOwner, c.starId);
  msg(s, newOwner, "colony", `${colonyName(s, c)} is now under our control.`, { starId: c.starId, colonyId: c.id });
}

export function explore(s: GameState, empireId: number, starId: number): boolean {
  if (empireId === MONSTER_OWNER) return false;
  const st = star(s, starId);
  if (st.exploredBy.includes(empireId)) return false;
  st.exploredBy.push(empireId);
  return true;
}

export function makeContact(s: GameState, a: number, b: number): void {
  if (a === b || a < 0 || b < 0) return;
  const ra = s.empires[a]?.relations[b];
  const rb = s.empires[b]?.relations[a];
  if (!ra || !rb || ra.contact) return;
  ra.contact = true;
  rb.contact = true;
  msg(s, a, "diplomacy", `First contact with the ${empire(s, b).name}.`);
  msg(s, b, "diplomacy", `First contact with the ${empire(s, a).name}.`);
}
