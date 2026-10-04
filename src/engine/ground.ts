// Planetary invasion (troop duels) and orbital bombardment.

import type { Colony, Empire, Fleet, GameState } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { WEAPON_BY_ID } from "./data/ships.ts";
import { race } from "./data/races.ts";
import { designStats } from "./designs.ts";
import type { Rng } from "./rng.ts";
import { stationTier } from "./production.ts";
import { atWar, colonyName, hasTech, msg } from "./state.ts";
import { pruneFleets, removeColony, transferColony } from "./world.ts";

const RIFLES: [string, number][] = [
  ["laser_rifle", 5],
  ["fusion_rifle", 10],
  ["phasor_rifle", 15],
  ["plasma_rifle", 20],
];
const ARMOR: [string, number][] = [
  ["powered_armor", 10],
  ["personal_shield", 10],
  ["universal_antidote", 5],
  ["telepathic_training", 5],
];

export function troopStrength(e: Empire): number {
  let v = 10 + race(e.raceId).traits.ground;
  let rifle = 0;
  for (const [t, b] of RIFLES) if (hasTech(e, t)) rifle = Math.max(rifle, b);
  v += rifle;
  for (const [t, b] of ARMOR) if (hasTech(e, t)) v += b;
  return v;
}

export function garrison(c: Colony): number {
  if (c.outpost) return 1;
  let t = Math.ceil(c.pop / 2);
  for (const b of c.buildings) t += BUILDING_BY_ID[b]?.troops ?? 0;
  return t;
}

export function fleetTroops(s: GameState, f: Fleet): number {
  let t = 0;
  const e = s.empires[f.owner];
  for (const sh of f.ships) t += designStats(s.designs[sh.designId], e).troops;
  return t;
}

/** Whether a colony's orbit is contested: enemy armed ships or an intact station block invasion. */
export function orbitBlocked(s: GameState, f: Fleet, c: Colony): string | null {
  if (stationTier(c) > 0) return "the orbital station must be destroyed first";
  const defenders = Object.values(s.fleets).some((o) => o.starId === c.starId && o.owner === c.owner && o.ships.some((sh) => designStats(s.designs[sh.designId], null).armed));
  if (defenders) return "enemy warships still hold the orbit";
  const monsters = Object.values(s.fleets).some((o) => o.starId === c.starId && o.owner === MONSTER_OWNER);
  if (monsters) return "a monster guards this system";
  void f;
  return null;
}

export interface InvasionResult {
  success: boolean;
  attackersLost: number;
  defendersLost: number;
}

export function invade(s: GameState, fleetId: number, colonyId: number, rng: Rng): InvasionResult | string {
  const f = s.fleets[fleetId];
  const c = s.colonies[colonyId];
  if (!f || !c) return "invalid fleet or colony";
  if (f.starId !== c.starId) return "fleet is not in orbit";
  if (!atWar(s, f.owner, c.owner)) return "we are not at war with that empire";
  const blocked = orbitBlocked(s, f, c);
  if (blocked) return blocked;
  let atk = fleetTroops(s, f);
  if (atk <= 0) return "no troops aboard";
  const ae = s.empires[f.owner];
  const de = s.empires[c.owner];
  const aStr = troopStrength(ae);
  const dStr = troopStrength(de) + (c.buildings.includes("capitol") ? 5 : 0);
  let def = garrison(c);
  const atk0 = atk;
  const def0 = def;
  while (atk > 0 && def > 0) {
    const ra = rng.int(100) + aStr;
    const rd = rng.int(100) + dStr;
    if (ra > rd) def--;
    else atk--;
  }
  // transports and troop pods are consumed by the landing
  f.ships = f.ships.filter((sh) => designStats(s.designs[sh.designId], ae).troops === 0);
  pruneFleets(s);
  const name = colonyName(s, c);
  const res: InvasionResult = { success: def <= 0, attackersLost: atk0 - atk, defendersLost: def0 - def };
  if (res.success) {
    if (c.outpost) {
      transferColony(s, c, ae.id);
    } else {
      c.pop = Math.max(1, c.pop - Math.ceil(res.defendersLost / 3));
      transferColony(s, c, ae.id);
    }
    msg(s, de.id, "combat", `${name} has fallen to a ${ae.name} invasion!`, { starId: c.starId });
    msg(s, ae.id, "combat", `Our troops captured ${name} (${res.attackersLost} lost, ${res.defendersLost} defenders killed).`, { starId: c.starId, colonyId: c.id });
  } else {
    msg(s, ae.id, "combat", `Invasion of ${name} failed; ${res.attackersLost} troops lost.`, { starId: c.starId });
    msg(s, de.id, "combat", `${name} repelled a ${ae.name} invasion.`, { starId: c.starId, colonyId: c.id });
  }
  return res;
}

export function fleetBombs(s: GameState, f: Fleet): number {
  let dmg = 0;
  for (const sh of f.ships) {
    const d = s.designs[sh.designId];
    for (const w of d.weapons) {
      const wd = WEAPON_BY_ID[w.weaponId];
      if (wd?.kind === "bomb") dmg += ((wd.min + wd.max) / 2) * w.count;
    }
  }
  return dmg;
}

/** Orbital bombardment: kills population and wrecks buildings. Returns a description or error. */
export function bombard(s: GameState, fleetId: number, colonyId: number, rng: Rng): string {
  const f = s.fleets[fleetId];
  const c = s.colonies[colonyId];
  if (!f || !c || f.starId !== c.starId) return "fleet is not in orbit";
  if (!atWar(s, f.owner, c.owner)) return "we are not at war with that empire";
  const blocked = orbitBlocked(s, f, c);
  if (blocked) return blocked;
  let dmg = fleetBombs(s, f);
  if (dmg <= 0) return "fleet carries no bombs";
  let shield = 0;
  for (const b of c.buildings) shield = Math.max(shield, BUILDING_BY_ID[b]?.planetShield ?? 0);
  dmg = Math.max(0, dmg - shield * 4);
  const killed = Math.min(c.pop, Math.floor(dmg / 25));
  c.pop -= killed;
  let wrecked = "";
  if (dmg > 40 && c.buildings.length && rng.chance(0.5)) {
    const i = rng.int(c.buildings.length);
    if (c.buildings[i] !== "capitol") {
      wrecked = BUILDING_BY_ID[c.buildings[i]]?.name ?? c.buildings[i];
      c.buildings.splice(i, 1);
    }
  }
  const name = colonyName(s, c);
  const text = `${name} bombarded: ${killed} population killed${wrecked ? `, ${wrecked} destroyed` : ""}.`;
  msg(s, f.owner, "combat", text, { starId: c.starId });
  msg(s, c.owner, "combat", text, { starId: c.starId });
  if (c.pop <= 0 && !c.outpost) {
    msg(s, c.owner, "colony", `${name} has been wiped out.`, { starId: c.starId });
    removeColony(s, c.id);
  }
  return text;
}
