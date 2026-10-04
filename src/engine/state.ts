// Small state accessors shared by engine modules.

import type { Colony, Empire, Fleet, GameMessage, GameState, Planet, Relation, ShipDesign, Star } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import { Rng } from "./rng.ts";

export function star(s: GameState, id: number): Star {
  const st = s.stars[id];
  if (!st) throw new Error(`no star ${id}`);
  return st;
}
export function planet(s: GameState, id: number): Planet {
  const p = s.planets[id];
  if (!p) throw new Error(`no planet ${id}`);
  return p;
}
export function empire(s: GameState, id: number): Empire {
  const e = s.empires[id];
  if (!e) throw new Error(`no empire ${id}`);
  return e;
}
export function design(s: GameState, id: number): ShipDesign {
  const d = s.designs[id];
  if (!d) throw new Error(`no design ${id}`);
  return d;
}
export function colonies(s: GameState): Colony[] {
  return Object.values(s.colonies).sort((a, b) => a.id - b.id);
}
export function coloniesOf(s: GameState, empireId: number): Colony[] {
  return colonies(s).filter((c) => c.owner === empireId);
}
export function fleets(s: GameState): Fleet[] {
  return Object.values(s.fleets).sort((a, b) => a.id - b.id);
}
export function fleetsOf(s: GameState, empireId: number): Fleet[] {
  return fleets(s).filter((f) => f.owner === empireId);
}
export function fleetsAt(s: GameState, starId: number): Fleet[] {
  return fleets(s).filter((f) => f.starId === starId);
}
export function coloniesAt(s: GameState, starId: number): Colony[] {
  return colonies(s).filter((c) => c.starId === starId);
}
export function hasTech(e: Empire, tech: string): boolean {
  return e.techs.includes(tech);
}
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
export function starDist(s: GameState, a: number, b: number): number {
  const A = star(s, a);
  const B = star(s, b);
  return dist(A.x, A.y, B.x, B.y);
}
export function humanEmpire(s: GameState): Empire | undefined {
  return s.empires.find((e) => e.human);
}
export function relation(s: GameState, a: number, b: number): Relation | null {
  if (a === b || a < 0 || b < 0) return null;
  return s.empires[a]?.relations[b] ?? null;
}
export function atWar(s: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === MONSTER_OWNER || b === MONSTER_OWNER) return true;
  const r = relation(s, a, b);
  return !!r && r.treaty === "war";
}
/** Hostile = fleets will fight on contact. Only open war (or monsters) triggers combat. */
export function hostile(s: GameState, a: number, b: number): boolean {
  return atWar(s, a, b);
}
export function withRng<T>(s: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(s.rng);
  try {
    return fn(rng);
  } finally {
    s.rng = rng.state();
  }
}
export function msg(s: GameState, empireId: number, kind: GameMessage["kind"], text: string, extra: Partial<GameMessage> = {}): void {
  if (empireId < 0) return;
  s.messages.push({ turn: s.turn, empire: empireId, kind, text, ...extra });
}
export function stardate(turn: number): string {
  const d = 35000 + turn;
  return `${Math.floor(d / 10)}.${d % 10}`;
}
export function aliveEmpires(s: GameState): Empire[] {
  return s.empires.filter((e) => e.alive);
}
export function planetName(s: GameState, p: Planet): string {
  const st = star(s, p.starId);
  return `${st.name} ${["I", "II", "III", "IV", "V"][p.orbit]}`;
}
export function colonyName(s: GameState, c: Colony): string {
  return planetName(s, planet(s, c.planetId));
}
export function ownerOfStar(s: GameState, starId: number): number | null {
  const cs = coloniesAt(s, starId);
  if (!cs.length) return null;
  // largest colony wins the label
  cs.sort((a, b) => b.pop - a.pop || a.id - b.id);
  return cs[0].owner;
}
