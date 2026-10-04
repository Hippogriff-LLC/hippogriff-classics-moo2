// Tactical space combat on a square grid. The same engine drives interactive battles (UI issues
// move/fire/end/retreat commands for the human side) and fully automatic resolution.
// Hit and damage formulas are project-authored approximations (docs/research/RULES.md).

import type { Colony, GameState, PendingBattle, ShipDesign } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import type { RngState } from "./rng.ts";
import { Rng } from "./rng.ts";
import { designStats, bestBeam, bestMissile, bestComputer } from "./designs.ts";
import { WEAPON_BY_ID, COMPUTER_BY_ID } from "./data/ships.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { stationTier } from "./production.ts";
import { colonyName, msg, star } from "./state.ts";
import { supplyStars } from "./fleets.ts";
import { pruneFleets } from "./world.ts";

export const GRID_W = 18;
export const GRID_H = 12;
export const MAX_ROUNDS = 20;

export interface CombatWeapon {
  weaponId: string;
  count: number;
  ammo: number; // remaining volleys (Infinity encoded as -1)
  fired: boolean;
}

export interface CombatUnit {
  uid: number;
  side: 0 | 1;
  owner: number;
  kind: "ship" | "defense";
  fleetId: number | null;
  shipId: number | null;
  designId: number | null;
  colonyId: number | null;
  name: string;
  hull: number;
  imageIndex: number;
  role: ShipDesign["role"] | "defense";
  x: number;
  y: number;
  structure: number;
  armor: number;
  maxStructure: number;
  maxArmor: number;
  shield: number;
  attack: number;
  defense: number;
  speed: number;
  moves: number;
  missileEvade: number;
  antiMissile: number;
  beamMult: number;
  ignoreShields: boolean;
  noRangePenalty: boolean;
  repair: number;
  weapons: CombatWeapon[];
  alive: boolean;
  retreated: boolean;
  done: boolean;
  xp: number;
}

export interface Battle {
  id: number;
  starId: number;
  owners: [number, number];
  humanSide: 0 | 1 | null;
  round: number;
  units: CombatUnit[];
  order: number[];
  orderPos: number;
  log: string[];
  over: boolean;
  winnerSide: 0 | 1 | null;
  rng: RngState;
  pendingId: number;
}

function hitChanceBeam(a: CombatUnit, t: CombatUnit, d: number): number {
  const pen = a.noRangePenalty ? 0 : Math.max(0, d - 2) * 4;
  const xp = a.xp * 5;
  return Math.max(5, Math.min(95, 50 + a.attack + xp - t.defense - pen));
}

export function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function shipUnit(s: GameState, uid: number, side: 0 | 1, fleetId: number, ship: { id: number; designId: number; name: string; hp: { structure: number; armor: number }; xp: number }): CombatUnit {
  const d = s.designs[ship.designId];
  const owner = d.owner >= 0 ? s.empires[d.owner] : null;
  const st = designStats(d, owner);
  return {
    uid,
    side,
    owner: d.owner,
    kind: "ship",
    fleetId,
    shipId: ship.id,
    designId: d.id,
    colonyId: null,
    name: d.monster ? d.monster.name : ship.name,
    hull: d.hull,
    imageIndex: d.imageIndex,
    role: d.role,
    x: 0,
    y: 0,
    structure: ship.hp.structure,
    armor: ship.hp.armor,
    maxStructure: st.structure,
    maxArmor: st.armor,
    shield: st.shield,
    attack: st.attack,
    defense: st.defense,
    speed: d.monster ? 2 : st.combatSpeed,
    moves: 0,
    missileEvade: st.missileEvade,
    antiMissile: st.antiMissile,
    beamMult: st.beamDamageMult,
    ignoreShields: st.ignoreShields,
    noRangePenalty: st.noRangePenalty,
    repair: st.repair,
    weapons: d.weapons.filter((w) => w.count > 0 && WEAPON_BY_ID[w.weaponId]?.kind !== "bomb").map((w) => ({ weaponId: w.weaponId, count: w.count, ammo: WEAPON_BY_ID[w.weaponId].ammo || -1, fired: false })),
    alive: ship.hp.structure > 0,
    retreated: false,
    done: false,
    xp: Math.min(4, ship.xp),
  };
}

/** Planetary defences (stations and bases) of a colony, as a single stationary unit. */
export function defenseUnit(s: GameState, uid: number, side: 0 | 1, c: Colony): CombatUnit | null {
  const e = s.empires[c.owner];
  const tier = stationTier(c);
  const has = (b: string) => c.buildings.includes(b);
  const beam = bestBeam(e);
  const missile = bestMissile(e);
  const weapons: CombatWeapon[] = [];
  let beams = 0;
  let missiles = 0;
  if (tier) {
    beams += 2 * tier + 2;
    missiles += 2 * tier;
  }
  if (has("missile_base")) missiles += 6;
  if (has("artemis_system_net")) missiles += 8;
  if (has("ground_batteries")) beams += 8;
  if (has("fighter_garrison")) beams += 4;
  if (beam && beams) weapons.push({ weaponId: beam.id, count: beams, ammo: -1, fired: false });
  if (missile && missiles) weapons.push({ weaponId: missile.id, count: missiles, ammo: -1, fired: false });
  if (!weapons.length) return null;
  let shield = tier * 2;
  for (const b of c.buildings) shield = Math.max(shield, BUILDING_BY_ID[b]?.planetShield ?? 0);
  const hp = [0, 60, 150, 400][tier] + (has("missile_base") ? 80 : 0) + (has("ground_batteries") ? 80 : 0) + (has("artemis_system_net") ? 80 : 0) + (has("fighter_garrison") ? 50 : 0);
  const comp = bestComputer(e);
  return {
    uid,
    side,
    owner: c.owner,
    kind: "defense",
    fleetId: null,
    shipId: null,
    designId: null,
    colonyId: c.id,
    name: `${colonyName(s, c)} defences`,
    hull: 3,
    imageIndex: -1,
    role: "defense",
    x: side === 0 ? 0 : GRID_W - 1,
    y: Math.floor(GRID_H / 2),
    structure: Math.max(20, hp),
    armor: Math.max(20, hp),
    maxStructure: Math.max(20, hp),
    maxArmor: Math.max(20, hp),
    shield,
    attack: 25 + (comp ? COMPUTER_BY_ID[comp].attack : 0),
    defense: -20,
    speed: 0,
    moves: 0,
    missileEvade: 0,
    antiMissile: 20,
    beamMult: 1,
    ignoreShields: false,
    noRangePenalty: true,
    repair: 0,
    weapons,
    alive: true,
    retreated: false,
    done: false,
    xp: 0,
  };
}

export function createBattle(s: GameState, pb: PendingBattle, seed: number): Battle {
  const b: Battle = {
    id: pb.id,
    starId: pb.starId,
    owners: [pb.attacker, pb.defender],
    humanSide: s.empires[pb.attacker]?.human ? 0 : s.empires[pb.defender]?.human ? 1 : null,
    round: 0,
    units: [],
    order: [],
    orderPos: 0,
    log: [],
    over: false,
    winnerSide: null,
    rng: Rng.fromSeed(seed).state(),
    pendingId: pb.id,
  };
  let uid = 0;
  const place = (side: 0 | 1, fleetIds: number[]) => {
    let i = 0;
    for (const fid of fleetIds) {
      const f = s.fleets[fid];
      if (!f) continue;
      for (const sh of f.ships) {
        const u = shipUnit(s, uid++, side, fid, sh);
        const col = Math.floor(i / GRID_H);
        const row = i % GRID_H;
        const rowOrder = [6, 5, 7, 4, 8, 3, 9, 2, 10, 1, 11, 0][row];
        u.x = side === 0 ? 1 + col : GRID_W - 2 - col;
        u.y = rowOrder;
        b.units.push(u);
        i++;
      }
    }
  };
  place(0, pb.attackerFleetIds);
  place(1, pb.defenderFleetIds);
  if (pb.defenderColonyId !== null) {
    const c = s.colonies[pb.defenderColonyId];
    if (c) {
      const du = defenseUnit(s, uid++, 1, c);
      if (du) {
        // avoid stacking on a ship
        while (b.units.some((u) => u.x === du.x && u.y === du.y)) du.y = (du.y + 1) % GRID_H;
        b.units.push(du);
      }
    }
  }
  b.log.push(`Battle at ${star(s, pb.starId).name}.`);
  startRound(b);
  return b;
}

function sideAlive(b: Battle, side: 0 | 1): CombatUnit[] {
  return b.units.filter((u) => u.side === side && u.alive && !u.retreated);
}
function armed(u: CombatUnit): boolean {
  return u.weapons.some((w) => w.count > 0 && w.ammo !== 0);
}

function checkOver(b: Battle): boolean {
  if (b.over) return true;
  const a = sideAlive(b, 0);
  const d = sideAlive(b, 1);
  if (!a.length || !d.length) {
    b.over = true;
    b.winnerSide = !a.length && !d.length ? null : a.length ? 0 : 1;
  } else if (!a.some(armed) && !d.some(armed)) {
    b.over = true;
    b.winnerSide = null;
  } else if (b.round > MAX_ROUNDS) {
    b.over = true;
    b.winnerSide = null;
  }
  if (b.over) b.log.push(b.winnerSide === null ? "The battle ends without a decision." : `Side ${b.winnerSide === 0 ? "attacker" : "defender"} wins.`);
  return b.over;
}

function startRound(b: Battle): void {
  b.round += 1;
  if (checkOver(b)) return;
  const rng = new Rng(b.rng);
  const alive = b.units.filter((u) => u.alive && !u.retreated);
  for (const u of alive) {
    u.done = false;
    u.moves = u.speed;
    for (const w of u.weapons) w.fired = false;
    if (b.round > 1 && u.repair > 0) {
      u.structure = Math.min(u.maxStructure, u.structure + Math.ceil(u.maxStructure * u.repair));
      u.armor = Math.min(u.maxArmor, u.armor + Math.ceil(u.maxArmor * u.repair));
    }
  }
  const s0 = rng.shuffle(alive.filter((u) => u.side === 0)).sort((x, y) => y.speed - x.speed);
  const s1 = rng.shuffle(alive.filter((u) => u.side === 1)).sort((x, y) => y.speed - x.speed);
  const order: number[] = [];
  const first = rng.chance(0.5) ? 0 : 1;
  const lists = first === 0 ? [s0, s1] : [s1, s0];
  for (let i = 0; i < Math.max(s0.length, s1.length); i++) {
    if (lists[0][i]) order.push(lists[0][i].uid);
    if (lists[1][i]) order.push(lists[1][i].uid);
  }
  b.order = order;
  b.orderPos = 0;
  b.rng = rng.state();
  skipInactive(b);
}

function skipInactive(b: Battle): void {
  while (b.orderPos < b.order.length) {
    const u = b.units[b.order[b.orderPos]];
    if (u.alive && !u.retreated && !u.done) return;
    b.orderPos++;
  }
}

export function activeUnit(b: Battle): CombatUnit | null {
  if (b.over) return null;
  const uid = b.order[b.orderPos];
  return uid === undefined ? null : b.units[uid];
}

export function isHumanTurn(b: Battle): boolean {
  const u = activeUnit(b);
  return !!u && b.humanSide !== null && u.side === b.humanSide;
}

export function cellFree(b: Battle, x: number, y: number, except?: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
  return !b.units.some((u) => u.alive && !u.retreated && u.uid !== except && u.x === x && u.y === y);
}

export function reachable(b: Battle, u: CombatUnit): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dx = -u.moves; dx <= u.moves; dx++) {
    for (let dy = -u.moves; dy <= u.moves; dy++) {
      if (!dx && !dy) continue;
      const x = u.x + dx;
      const y = u.y + dy;
      if (cellFree(b, x, y, u.uid)) out.push({ x, y });
    }
  }
  return out;
}

export function moveUnit(b: Battle, uid: number, x: number, y: number): string | null {
  const u = activeUnit(b);
  if (!u || u.uid !== uid) return "not this unit's turn";
  const d = chebyshev(u, { x, y });
  if (d > u.moves) return "too far";
  if (!cellFree(b, x, y, u.uid)) return "cell occupied";
  u.x = x;
  u.y = y;
  u.moves -= d;
  return null;
}

export function weaponInRange(u: CombatUnit, w: CombatWeapon, t: CombatUnit): boolean {
  const wd = WEAPON_BY_ID[w.weaponId];
  return !!wd && chebyshev(u, t) <= wd.range;
}

export function canFireAt(b: Battle, u: CombatUnit, t: CombatUnit): boolean {
  if (!t.alive || t.retreated || t.side === u.side) return false;
  return u.weapons.some((w) => !w.fired && w.ammo !== 0 && w.count > 0 && weaponInRange(u, w, t));
}

function damage(b: Battle, t: CombatUnit, amount: number): void {
  if (amount <= 0) return;
  const toArmor = Math.min(t.armor, amount);
  t.armor -= toArmor;
  t.structure -= amount - toArmor;
  if (t.structure <= 0) {
    t.structure = 0;
    t.alive = false;
    b.log.push(`${t.name} destroyed!`);
  }
}

/** Fire every ready weapon of the active unit that can reach the target. */
export function fireAt(b: Battle, uid: number, targetUid: number): string | null {
  const u = activeUnit(b);
  if (!u || u.uid !== uid) return "not this unit's turn";
  const t = b.units[targetUid];
  if (!t || !canFireAt(b, u, t)) return "no weapons can reach that target";
  const rng = new Rng(b.rng);
  const d = chebyshev(u, t);
  let hits = 0;
  let shots = 0;
  let dealt = 0;
  for (const w of u.weapons) {
    if (w.fired || w.ammo === 0 || w.count <= 0 || !weaponInRange(u, w, t)) continue;
    const wd = WEAPON_BY_ID[w.weaponId];
    w.fired = true;
    if (w.ammo > 0) w.ammo -= 1;
    for (let i = 0; i < w.count && t.alive; i++) {
      shots++;
      let chance: number;
      let dmg = wd.min + rng.int(wd.max - wd.min + 1);
      let shield = t.shield;
      if (wd.kind === "beam") {
        chance = hitChanceBeam(u, t, d);
        dmg = Math.round(dmg * u.beamMult);
        if (u.ignoreShields) shield = 0;
      } else if (wd.kind === "missile") {
        chance = Math.max(5, Math.min(95, 75 + u.attack / 5 - t.missileEvade));
        if (t.antiMissile && rng.chance(t.antiMissile / 100)) chance = 0;
      } else {
        chance = Math.max(10, 85 - t.missileEvade / 2);
        shield = Math.floor(shield / 2);
      }
      if (rng.int(100) < chance) {
        hits++;
        const net = Math.max(0, dmg - shield);
        dealt += net;
        damage(b, t, net);
      }
    }
  }
  b.rng = rng.state();
  b.log.push(`${u.name} fires at ${t.name}: ${hits}/${shots} hits, ${dealt} damage.`);
  return null;
}

export function endActivation(b: Battle): void {
  const u = activeUnit(b);
  if (u) u.done = true;
  b.orderPos++;
  skipInactive(b);
  if (checkOver(b)) return;
  if (b.orderPos >= b.order.length) startRound(b);
}

/** Withdraw every unit of a side (stations stay and fight on). */
export function retreat(b: Battle, side: 0 | 1): void {
  for (const u of b.units) if (u.side === side && u.alive && u.kind === "ship") u.retreated = true;
  b.log.push(`${side === 0 ? "Attacker" : "Defender"} ships retreat.`);
  checkOver(b);
  if (!b.over) {
    skipInactive(b);
    if (b.orderPos >= b.order.length) startRound(b);
  }
}

function preferredRange(u: CombatUnit): number {
  let r = Infinity;
  for (const w of u.weapons) {
    if (w.ammo === 0 || w.count <= 0) continue;
    const wd = WEAPON_BY_ID[w.weaponId];
    r = Math.min(r, wd.kind === "beam" ? (u.noRangePenalty ? wd.range : Math.min(wd.range, 3)) : wd.range);
  }
  return r === Infinity ? 0 : r;
}

function threat(u: CombatUnit): number {
  let f = 0;
  for (const w of u.weapons) {
    if (w.ammo === 0) continue;
    const wd = WEAPON_BY_ID[w.weaponId];
    f += ((wd.min + wd.max) / 2) * w.count;
  }
  return f;
}

/** Computer control for the active unit (used for AI sides and auto-resolve). */
export function aiActivate(b: Battle): void {
  const u = activeUnit(b);
  if (!u) return;
  const enemies = b.units.filter((t) => t.side !== u.side && t.alive && !t.retreated);
  if (!enemies.length) {
    endActivation(b);
    return;
  }
  if (!armed(u)) {
    // unarmed: back away from the nearest enemy
    if (u.moves > 0) {
      const near = enemies.reduce((a, c) => (chebyshev(u, c) < chebyshev(u, a) ? c : a));
      let best = { x: u.x, y: u.y };
      let bd = chebyshev(u, near);
      for (const c of reachable(b, u)) {
        const d = chebyshev(c, near);
        if (d > bd) {
          bd = d;
          best = c;
        }
      }
      if (best.x !== u.x || best.y !== u.y) moveUnit(b, u.uid, best.x, best.y);
    }
    endActivation(b);
    return;
  }
  // choose target: most threatening per remaining hp, slight preference for close targets
  let target = enemies[0];
  let bestScore = -Infinity;
  for (const t of enemies) {
    const hp = t.structure + t.armor + 1;
    const score = (threat(t) + 5) / hp - chebyshev(u, t) * 0.01 + (t.kind === "defense" ? -0.05 : 0);
    if (score > bestScore) {
      bestScore = score;
      target = t;
    }
  }
  if (u.moves > 0) {
    const want = preferredRange(u);
    let best = { x: u.x, y: u.y };
    let bd = Math.abs(chebyshev(u, target) - want) * 10 + chebyshev(u, target);
    for (const c of reachable(b, u)) {
      const d = chebyshev(c, target);
      const sc = Math.abs(d - want) * 10 + d;
      if (sc < bd) {
        bd = sc;
        best = c;
      }
    }
    if (best.x !== u.x || best.y !== u.y) moveUnit(b, u.uid, best.x, best.y);
  }
  if (canFireAt(b, u, target)) fireAt(b, u.uid, target.uid);
  // remaining weapons at anything else in reach
  for (const t of enemies) if (t.alive && canFireAt(b, u, t)) fireAt(b, u.uid, t.uid);
  endActivation(b);
}

export function autoResolve(b: Battle): void {
  let guard = 0;
  while (!b.over && guard++ < 20000) aiActivate(b);
  if (!b.over) {
    b.over = true;
    b.winnerSide = null;
  }
}

/** Run computer-controlled activations until it is the human's turn or the battle ends. */
export function runAiUntilHuman(b: Battle): void {
  let guard = 0;
  while (!b.over && !isHumanTurn(b) && guard++ < 5000) aiActivate(b);
}

/** Write battle results back into the game state. */
export function applyBattle(s: GameState, b: Battle): void {
  const losses: [number, number] = [0, 0];
  const retreatedFleets = new Set<number>();
  for (const u of b.units) {
    if (u.kind === "defense") {
      if (!u.alive && u.colonyId !== null) {
        const c = s.colonies[u.colonyId];
        if (c) {
          c.buildings = c.buildings.filter((x) => !BUILDING_BY_ID[x]?.station);
          msg(s, c.owner, "combat", `The orbital station at ${colonyName(s, c)} was destroyed.`, { starId: c.starId, colonyId: c.id });
        }
      }
      continue;
    }
    const f = u.fleetId !== null ? s.fleets[u.fleetId] : undefined;
    if (!f) continue;
    const idx = f.ships.findIndex((sh) => sh.id === u.shipId);
    if (idx < 0) continue;
    if (!u.alive) {
      f.ships.splice(idx, 1);
      losses[u.side]++;
      continue;
    }
    const sh = f.ships[idx];
    sh.hp.structure = u.structure;
    sh.hp.armor = u.armor;
    sh.xp = Math.min(4, sh.xp + (b.round > 1 ? 1 : 0) * 0.25);
    if (u.retreated) retreatedFleets.add(f.id);
  }
  // the loser of a decided battle withdraws its remaining ships (except monsters, which hold their lair)
  for (const side of [0, 1] as const) {
    const lost = b.winnerSide !== null && b.winnerSide !== side;
    if (!lost) continue;
    for (const u of b.units) if (u.side === side && u.fleetId !== null && u.alive) retreatedFleets.add(u.fleetId);
  }
  if (b.winnerSide === null) {
    // undecided: the attacker pulls back
    for (const u of b.units) if (u.side === 0 && u.fleetId !== null && u.alive && u.owner !== MONSTER_OWNER) retreatedFleets.add(u.fleetId);
  }
  for (const fid of retreatedFleets) {
    const f = s.fleets[fid];
    if (!f || !f.ships.length || f.owner === MONSTER_OWNER) continue;
    const e = s.empires[f.owner];
    const here = star(s, b.starId);
    let best: number | null = null;
    let bd = Infinity;
    for (const sid of supplyStars(s, e)) {
      if (sid === b.starId) continue;
      const st = s.stars[sid];
      const d = Math.hypot(st.x - here.x, st.y - here.y);
      if (d < bd) {
        bd = d;
        best = sid;
      }
    }
    if (best === null && f.originStarId !== null && f.originStarId !== b.starId) best = f.originStarId;
    if (best !== null) {
      f.destStarId = best;
      f.order = "none";
    }
  }
  pruneFleets(s);
  const [a, d] = b.owners;
  const st = star(s, b.starId);
  const winner = b.winnerSide === null ? null : b.owners[b.winnerSide];
  s.battleReports.push({ turn: s.turn, starId: b.starId, attacker: a, defender: d, winner, attackerLosses: losses[0], defenderLosses: losses[1], rounds: b.round });
  if (s.battleReports.length > 60) s.battleReports.splice(0, s.battleReports.length - 60);
  const name = (o: number) => (o === MONSTER_OWNER ? "monsters" : s.empires[o].name);
  const text = `Battle at ${st.name}: ${name(a)} vs ${name(d)} — ${winner === null ? "no decision" : `${name(winner)} victorious`} (losses ${losses[0]} / ${losses[1]}).`;
  msg(s, a, "combat", text, { starId: b.starId });
  msg(s, d, "combat", text, { starId: b.starId });
}
