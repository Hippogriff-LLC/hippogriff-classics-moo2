// Random galactic events and the periodic galactic council (election victory).

import type { GameState } from "./types.ts";
import { MINERALS } from "./types.ts";
import type { Rng } from "./rng.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { aliveEmpires, coloniesOf, colonyName, msg, planet, relation } from "./state.ts";
import { designsOf } from "./designs.ts";
import { addShipsAt, newShip, spawnFleet } from "./world.ts";
import { MONSTER_OWNER } from "./types.ts";

type EventFn = (s: GameState, rng: Rng) => boolean;

const EVENTS: [string, number, EventFn][] = [
  [
    "minerals",
    3,
    (s, rng) => {
      const cs = Object.values(s.colonies).filter((c) => planet(s, c.planetId).minerals < 4);
      if (!cs.length) return false;
      const c = rng.pick(cs);
      const p = planet(s, c.planetId);
      p.minerals += 1;
      msg(s, c.owner, "event", `Geologists found new deposits on ${colonyName(s, c)}: now ${MINERALS[p.minerals]}.`, { colonyId: c.id, starId: c.starId });
      return true;
    },
  ],
  [
    "plague",
    2,
    (s, rng) => {
      const cs = Object.values(s.colonies).filter((c) => !c.outpost && c.pop >= 4 && !s.empires[c.owner].techs.includes("universal_antidote"));
      if (!cs.length) return false;
      const c = rng.pick(cs);
      const lost = Math.max(1, Math.floor(c.pop / 4));
      c.pop -= lost;
      c.farmers = Math.min(c.farmers, c.pop);
      c.scientists = Math.min(c.scientists, c.pop - c.farmers);
      c.workers = c.pop - c.farmers - c.scientists;
      msg(s, c.owner, "event", `A plague struck ${colonyName(s, c)}; ${lost} million died.`, { colonyId: c.id, starId: c.starId });
      return true;
    },
  ],
  [
    "accident",
    2,
    (s, rng) => {
      const cs = Object.values(s.colonies).filter((c) => c.buildings.some((b) => b !== "capitol" && !BUILDING_BY_ID[b]?.station));
      if (!cs.length) return false;
      const c = rng.pick(cs);
      const bs = c.buildings.filter((b) => b !== "capitol" && !BUILDING_BY_ID[b]?.station);
      const b = rng.pick(bs);
      c.buildings.splice(c.buildings.indexOf(b), 1);
      msg(s, c.owner, "event", `An industrial accident destroyed the ${BUILDING_BY_ID[b].name} at ${colonyName(s, c)}.`, { colonyId: c.id, starId: c.starId });
      return true;
    },
  ],
  [
    "derelict",
    2,
    (s, rng) => {
      const e = rng.pick(aliveEmpires(s));
      const cs = coloniesOf(s, e.id);
      if (!cs.length) return false;
      const c = rng.pick(cs);
      const war = designsOf(s, e).filter((d) => d.role === "combat");
      if (!war.length) return false;
      const d = war.reduce((a, b) => (b.hull > a.hull ? b : a));
      addShipsAt(s, e.id, c.starId, [newShip(s, d.id, `Derelict ${d.name}`)]);
      msg(s, e.id, "event", `A derelict ${d.name} was recovered and brought to ${colonyName(s, c)}.`, { starId: c.starId });
      return true;
    },
  ],
  [
    "windfall",
    3,
    (s, rng) => {
      const e = rng.pick(aliveEmpires(s));
      const amt = 50 + rng.int(100);
      e.bc += amt;
      msg(s, e.id, "event", `An interstellar trade windfall brought ${amt} BC to our treasury.`);
      return true;
    },
  ],
  [
    "monster",
    1,
    (s, rng) => {
      const monster = s.designs.find((d) => d.owner === MONSTER_OWNER && d.name === "Crystal Swarm");
      if (!monster) return false;
      const empty = s.stars.filter((st) => st.color !== "blackhole" && st.special === "none" && !Object.values(s.colonies).some((c) => c.starId === st.id));
      if (!empty.length) return false;
      const st = rng.pick(empty);
      spawnFleet(s, MONSTER_OWNER, st.id, [monster.id], "Crystal Swarm");
      for (const e of aliveEmpires(s)) if (st.exploredBy.includes(e.id)) msg(s, e.id, "event", `A Crystal Swarm has appeared in the ${st.name} system.`, { starId: st.id });
      return true;
    },
  ],
];

export function processEvents(s: GameState, rng: Rng): void {
  if (!s.settings.events || s.turn < 10) return;
  if (!rng.chance(0.06)) return;
  for (let tries = 0; tries < 3; tries++) {
    const [, , fn] = EVENTS[rng.weighted(EVENTS.map((e, i) => [i, e[1]] as const))];
    if (fn(s, rng)) return;
  }
}

/** Galactic council: candidates are the two most populous empires; 2/3 of votes wins the game. */
export function processCouncil(s: GameState): void {
  if (s.turn < s.council.nextTurn) return;
  s.council.nextTurn = s.turn + 25;
  const alive = aliveEmpires(s);
  if (alive.length < 3) return;
  const pop = (id: number) => coloniesOf(s, id).reduce((a, c) => a + c.pop, 0);
  const ranked = [...alive].sort((a, b) => pop(b.id) - pop(a.id));
  const [c1, c2] = ranked;
  const votes = new Map<number, number>([
    [c1.id, 0],
    [c2.id, 0],
  ]);
  let total = 0;
  const lines: string[] = [];
  for (const e of alive) {
    const v = Math.max(1, Math.round(pop(e.id) / 5));
    total += v;
    let choice: number | null;
    if (e.id === c1.id || e.id === c2.id) choice = e.id;
    else if (e.human) choice = null; // abstain unless a candidate
    else {
      const a1 = relation(s, e.id, c1.id)?.attitude ?? 0;
      const a2 = relation(s, e.id, c2.id)?.attitude ?? 0;
      const w1 = relation(s, e.id, c1.id)?.treaty === "war";
      const w2 = relation(s, e.id, c2.id)?.treaty === "war";
      if (w1 && w2) choice = null;
      else if (w1) choice = c2.id;
      else if (w2) choice = c1.id;
      else if (Math.max(a1, a2) < 15 || Math.abs(a1 - a2) < 5) choice = null;
      else choice = a1 > a2 ? c1.id : c2.id;
    }
    if (choice !== null) votes.set(choice, (votes.get(choice) ?? 0) + v);
    lines.push(`${e.name}: ${v} vote${v === 1 ? "" : "s"} for ${choice === null ? "abstain" : s.empires[choice].name}`);
  }
  const need = Math.ceil((total * 2) / 3);
  const v1 = votes.get(c1.id) ?? 0;
  const v2 = votes.get(c2.id) ?? 0;
  const winner = v1 >= need ? c1 : v2 >= need ? c2 : null;
  const summary = `Galactic Council (${need} of ${total} needed): ${c1.name} ${v1}, ${c2.name} ${v2}. ${winner ? `${winner.name} elected High Master!` : "No one was elected."}`;
  s.council.lastResult = [summary, ...lines].join("\n");
  for (const e of alive) msg(s, e.id, "diplomacy", summary);
  if (!winner) return;
  const human = alive.find((e) => e.human);
  if (winner.human) s.winner = { empire: winner.id, kind: "council" };
  else if (human) s.council.pendingDecision = { winner: winner.id };
  else s.winner = { empire: winner.id, kind: "council" };
}

/** The human accepts the council result (loses) or defies it (war with every empire that voted). */
export function councilDecision(s: GameState, accept: boolean): void {
  const pd = s.council.pendingDecision;
  if (!pd) return;
  s.council.pendingDecision = null;
  const human = s.empires.find((e) => e.human);
  if (!human) return;
  if (accept) {
    s.winner = { empire: pd.winner, kind: "council" };
    return;
  }
  for (const e of aliveEmpires(s)) {
    if (e.id === human.id) continue;
    for (const side of [human.id, e.id]) {
      const r = relation(s, side, side === human.id ? e.id : human.id);
      if (r) {
        r.contact = true;
        r.treaty = "war";
        r.trade = false;
        r.research = false;
        r.lastWarTurn = s.turn;
        r.attitude = Math.min(r.attitude, -50);
      }
    }
  }
  msg(s, human.id, "diplomacy", "We defied the Council. Every empire in the galaxy has declared war on us.");
}
