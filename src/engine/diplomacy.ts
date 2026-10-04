// Diplomacy (treaties, proposals, attitudes, AI war decisions) and espionage.

import type { DiplomaticProposal, Empire, GameState } from "./types.ts";
import { race } from "./data/races.ts";
import { techName } from "./data/techs.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { shipStrength } from "./designs.ts";
import type { Rng } from "./rng.ts";
import { aliveEmpires, coloniesOf, colonyName, hasTech, msg, relation } from "./state.ts";
import { grantTech, techGap } from "./research.ts";

export const PROPOSAL_KINDS: DiplomaticProposal["kind"][] = ["peace", "nap", "alliance", "trade", "research", "tribute"];
const KIND_LABEL: Record<DiplomaticProposal["kind"], string> = {
  peace: "a peace treaty",
  nap: "a non-aggression pact",
  alliance: "an alliance",
  trade: "a trade agreement",
  research: "a research agreement",
  tribute: "a gift",
};

export function empirePower(s: GameState, e: Empire): number {
  let p = 0;
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== e.id) continue;
    for (const sh of f.ships) p += shipStrength(s.designs[sh.designId], e);
  }
  for (const c of coloniesOf(s, e.id)) p += c.pop * 2 + (c.outpost ? 1 : 0);
  return Math.round(p);
}

function setBoth(s: GameState, a: number, b: number, fn: (r: NonNullable<ReturnType<typeof relation>>) => void): void {
  const ra = relation(s, a, b);
  const rb = relation(s, b, a);
  if (ra) fn(ra);
  if (rb) fn(rb);
}

export function adjustAttitude(s: GameState, holder: number, toward: number, delta: number): void {
  const r = relation(s, holder, toward);
  if (r) r.attitude = Math.max(-100, Math.min(100, r.attitude + delta));
}

export function declareWar(s: GameState, a: number, b: number): string | null {
  const r = relation(s, a, b);
  if (!r) return "invalid empires";
  if (!r.contact) return "no contact with that empire";
  if (r.treaty === "war") return "already at war";
  setBoth(s, a, b, (x) => {
    x.treaty = "war";
    x.trade = false;
    x.research = false;
    x.lastWarTurn = s.turn;
  });
  adjustAttitude(s, b, a, -40);
  for (const other of aliveEmpires(s)) {
    if (other.id === a || other.id === b) continue;
    if (relation(s, other.id, b)?.treaty === "alliance") adjustAttitude(s, other.id, a, -20);
  }
  const an = s.empires[a].name;
  const bn = s.empires[b].name;
  msg(s, a, "diplomacy", `We have declared war on the ${bn}.`);
  msg(s, b, "diplomacy", `The ${an} has declared war on us!`);
  for (const o of aliveEmpires(s)) if (o.id !== a && o.id !== b && relation(s, o.id, a)?.contact) msg(s, o.id, "diplomacy", `The ${an} declared war on the ${bn}.`);
  return null;
}

export function breakTreaty(s: GameState, a: number, b: number): void {
  const r = relation(s, a, b);
  if (!r || r.treaty === "war") return;
  setBoth(s, a, b, (x) => {
    x.treaty = "none";
    x.trade = false;
    x.research = false;
  });
  adjustAttitude(s, b, a, -25);
  msg(s, b, "diplomacy", `The ${s.empires[a].name} cancelled all treaties with us.`);
}

function applyProposal(s: GameState, p: DiplomaticProposal): void {
  switch (p.kind) {
    case "peace":
      setBoth(s, p.from, p.to, (x) => {
        x.treaty = "peace";
        x.lastWarTurn = s.turn;
      });
      break;
    case "nap":
      setBoth(s, p.from, p.to, (x) => (x.treaty = "nap"));
      break;
    case "alliance":
      setBoth(s, p.from, p.to, (x) => (x.treaty = "alliance"));
      break;
    case "trade":
      setBoth(s, p.from, p.to, (x) => (x.trade = true));
      break;
    case "research":
      setBoth(s, p.from, p.to, (x) => (x.research = true));
      break;
    case "tribute": {
      const amt = Math.min(p.amount ?? 0, s.empires[p.from].bc);
      s.empires[p.from].bc -= amt;
      s.empires[p.to].bc += amt;
      adjustAttitude(s, p.to, p.from, Math.min(30, Math.round(amt / 5)));
      break;
    }
  }
  adjustAttitude(s, p.to, p.from, 5);
  adjustAttitude(s, p.from, p.to, 5);
}

export function proposalValid(s: GameState, from: number, to: number, kind: DiplomaticProposal["kind"]): string | null {
  const r = relation(s, from, to);
  if (!r || !r.contact) return "no contact";
  if (!s.empires[to].alive) return "that empire is gone";
  switch (kind) {
    case "peace":
      return r.treaty === "war" ? null : "not at war";
    case "nap":
      return r.treaty === "none" || r.treaty === "peace" ? null : "not applicable";
    case "alliance":
      return r.treaty === "nap" || r.treaty === "peace" ? null : "requires peace or a non-aggression pact first";
    case "trade":
      return r.treaty !== "war" && !r.trade ? null : "not applicable";
    case "research":
      return r.treaty !== "war" && !r.research ? null : "not applicable";
    case "tribute":
      return null;
  }
}

/** Would AI empire `ai` accept `kind` from `from`? */
export function aiAccepts(s: GameState, ai: Empire, from: number, kind: DiplomaticProposal["kind"], amount = 0): boolean {
  const r = relation(s, ai.id, from)!;
  const att = r.attitude + (race(s.empires[from].raceId).traits.charismatic ? 10 : 0);
  const mine = empirePower(s, ai) + 1;
  const theirs = empirePower(s, s.empires[from]) + 1;
  const ratio = theirs / mine;
  switch (kind) {
    case "peace":
      return s.turn - r.lastWarTurn >= 8 && (att > -50 || ratio > 1.3) && !(ai.ai.aggression > 0.8 && ratio < 0.6);
    case "nap":
      return att > 5 - ratio * 10;
    case "alliance":
      return att > 45;
    case "trade":
      return att > -15;
    case "research":
      return att > 0;
    case "tribute":
      return amount > 0;
  }
}

/** Human (or AI) makes a proposal. AI recipients answer immediately; human recipients get it queued. */
export function propose(s: GameState, from: number, to: number, kind: DiplomaticProposal["kind"], amount = 0): { accepted: boolean | null; error?: string } {
  const err = proposalValid(s, from, to, kind);
  if (err) return { accepted: false, error: err };
  if (kind === "tribute" && (amount <= 0 || s.empires[from].bc < amount)) return { accepted: false, error: "not enough BC" };
  const rf = relation(s, from, to)!;
  const p: DiplomaticProposal = { id: s.nextId.proposal++, from, to, kind, amount, turn: s.turn };
  rf.lastProposalTurn = s.turn;
  const target = s.empires[to];
  if (target.human) {
    s.proposals.push(p);
    msg(s, to, "diplomacy", `The ${s.empires[from].name} proposes ${KIND_LABEL[kind]}.`);
    return { accepted: null };
  }
  const ok = aiAccepts(s, target, from, kind, amount);
  if (ok) applyProposal(s, p);
  else adjustAttitude(s, to, from, -2);
  msg(s, from, "diplomacy", `The ${target.name} ${ok ? "accepted" : "rejected"} ${KIND_LABEL[kind]}.`);
  return { accepted: ok };
}

export function respondToProposal(s: GameState, proposalId: number, accept: boolean): void {
  const i = s.proposals.findIndex((p) => p.id === proposalId);
  if (i < 0) return;
  const [p] = s.proposals.splice(i, 1);
  if (proposalValid(s, p.from, p.to, p.kind)) return;
  if (accept) applyProposal(s, p);
  else adjustAttitude(s, p.from, p.to, -5);
  msg(s, p.from, "diplomacy", `The ${s.empires[p.to].name} ${accept ? "accepted" : "rejected"} ${KIND_LABEL[p.kind]}.`);
}

function borderPressure(s: GameState, a: Empire, b: Empire): number {
  let close = 0;
  for (const ca of coloniesOf(s, a.id)) {
    const A = s.stars[ca.starId];
    for (const cb of coloniesOf(s, b.id)) {
      const B = s.stars[cb.starId];
      if (Math.hypot(A.x - B.x, A.y - B.y) < 5) close++;
    }
  }
  return close;
}

/** Per-turn attitude drift and AI-initiated diplomacy. */
export function updateDiplomacy(s: GameState, rng: Rng): void {
  // expire stale proposals to the human
  s.proposals = s.proposals.filter((p) => s.turn - p.turn <= 3);
  const alive = aliveEmpires(s);
  for (const a of alive) {
    for (const b of alive) {
      if (a.id === b.id) continue;
      const r = relation(s, a.id, b.id)!;
      if (!r.contact) continue;
      // drift toward a race-dependent baseline
      const base = (race(b.raceId).traits.charismatic ? 15 : 0) - (race(b.raceId).traits.repulsive ? 15 : 0) + (r.trade ? 10 : 0) + (r.research ? 5 : 0) + (r.treaty === "alliance" ? 20 : r.treaty === "nap" ? 8 : 0) - Math.min(20, borderPressure(s, a, b) * 2);
      if (r.attitude < base) r.attitude += 1;
      else if (r.attitude > base) r.attitude -= 1;
      if (r.treaty === "war") r.attitude = Math.max(-100, r.attitude - 0.5);
    }
  }
  for (const ai of alive) {
    if (ai.human) continue;
    for (const other of alive) {
      if (other.id === ai.id) continue;
      const r = relation(s, ai.id, other.id)!;
      if (!r.contact) continue;
      if (s.turn - r.lastProposalTurn < 6) continue;
      const mine = empirePower(s, ai) + 1;
      const theirs = empirePower(s, other) + 1;
      // war decision
      if (r.treaty !== "war" && r.treaty !== "alliance" && s.turn > 20 && s.turn - r.lastWarTurn > 20) {
        const want = ai.ai.aggression * 0.06 + (mine / theirs > 1.5 ? 0.04 : 0) - (r.attitude > 20 ? 0.08 : 0) - (r.treaty === "nap" ? 0.03 : 0) + (borderPressure(s, ai, other) > 0 ? 0.02 : 0);
        if (r.attitude < 0 && rng.chance(Math.max(0, want))) {
          declareWar(s, ai.id, other.id);
          ai.ai.targetEmpire = other.id;
          r.lastProposalTurn = s.turn;
          continue;
        }
      }
      // peace-making
      if (r.treaty === "war" && s.turn - r.lastWarTurn > 15 && (mine < theirs * 0.8 || rng.chance(0.08))) {
        propose(s, ai.id, other.id, "peace");
        continue;
      }
      if (r.treaty !== "war" && rng.chance(0.15)) {
        const kind = !r.trade ? "trade" : !r.research ? "research" : r.treaty === "none" ? "nap" : r.treaty === "nap" || r.treaty === "peace" ? "alliance" : null;
        if (kind && r.attitude > (kind === "alliance" ? 50 : kind === "nap" ? 10 : -5)) propose(s, ai.id, other.id, kind);
      }
    }
  }
}

function spyDefense(s: GameState, e: Empire): number {
  let d = e.spies * 3 + race(e.raceId).traits.spying;
  for (const t of ["security_stations", "cyber_security_link"]) if (hasTech(e, t)) d += 10;
  if (race(e.raceId).traits.telepathic) d += 10;
  return d;
}

function spyOffense(s: GameState, e: Empire): number {
  let o = e.spies * 4 + race(e.raceId).traits.spying;
  for (const t of ["neural_scanner", "stealth_suit"]) if (hasTech(e, t)) o += 10;
  return o;
}

/** One espionage attempt per empire per turn. */
export function processEspionage(s: GameState, rng: Rng): void {
  for (const e of aliveEmpires(s)) {
    if (!e.human) {
      // AI picks a target: wartime sabotage, otherwise theft from the most advanced contact
      if (e.spies > 0 && (e.espionage.target === null || !s.empires[e.espionage.target]?.alive)) {
        const contacts = aliveEmpires(s).filter((o) => o.id !== e.id && relation(s, e.id, o.id)?.contact);
        if (contacts.length) {
          const tgt = contacts.reduce((a, b) => (techGap(e, b).length > techGap(e, a).length ? b : a));
          e.espionage = { target: tgt.id, mode: relation(s, e.id, tgt.id)?.treaty === "war" ? "sabotage" : "steal" };
        }
      }
    }
    const tid = e.espionage.target;
    if (tid === null || e.spies <= 0) continue;
    const t = s.empires[tid];
    if (!t || !t.alive || !relation(s, e.id, tid)?.contact) continue;
    const chance = Math.max(0.03, Math.min(0.6, 0.12 + (spyOffense(s, e) - spyDefense(s, t)) / 100));
    if (rng.chance(chance)) {
      if (e.espionage.mode === "steal") {
        const gap = techGap(e, t);
        if (gap.length) {
          const tech = rng.pick(gap);
          grantTech(s, e, tech);
          msg(s, e.id, "diplomacy", `Our spies stole ${techName(tech)} from the ${t.name}.`);
          msg(s, t.id, "warning", `Enemy agents stole our ${techName(tech)} research.`);
        }
      } else {
        const cols = coloniesOf(s, t.id).filter((c) => c.buildings.some((b) => b !== "capitol"));
        if (cols.length) {
          const c = rng.pick(cols);
          const bs = c.buildings.filter((b) => b !== "capitol");
          const b = rng.pick(bs);
          c.buildings.splice(c.buildings.indexOf(b), 1);
          const bn = BUILDING_BY_ID[b]?.name ?? b;
          msg(s, e.id, "diplomacy", `Saboteurs destroyed the ${bn} at ${colonyName(s, c)}.`);
          msg(s, t.id, "warning", `Saboteurs destroyed the ${bn} at ${colonyName(s, c)}.`, { colonyId: c.id });
        }
      }
    } else if (rng.chance(0.35)) {
      e.spies -= 1;
      adjustAttitude(s, t.id, e.id, -10);
      msg(s, e.id, "warning", `One of our spies was captured by the ${t.name}.`);
      msg(s, t.id, "diplomacy", `We captured a ${e.name} spy.`);
    }
  }
}
