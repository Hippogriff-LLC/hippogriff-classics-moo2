// Turn processing. A turn runs in two phases so the human can fight tactical battles in between:
//   phase 1 (endTurn): AI orders, governors, movement, contacts, battle detection;
//            AI-only battles are auto-resolved; human battles are queued (phase "battles").
//   phase 2 (finishTurn): economy, production, research, growth, espionage, diplomacy, events,
//            council, elimination and victory checks, then the turn counter advances.

import type { Colony, Empire, GameState, PendingBattle } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import type { Rng } from "./rng.ts";
import { aiTurn, governTurn } from "./ai.ts";
import { applyBattle, autoResolve, createBattle } from "./combat.ts";
import type { Battle } from "./combat.ts";
import { designStats } from "./designs.ts";
import { processEspionage, updateDiplomacy } from "./diplomacy.ts";
import { clampJobs, colonyOutput, empireSummary } from "./economy.ts";
import { processCouncil, processEvents } from "./events.ts";
import { moveFleets, repairShips, updateContacts } from "./fleets.ts";
import { processProduction, stationTier } from "./production.ts";
import { advanceResearch } from "./research.ts";
import { BUILDING_BY_ID } from "./data/buildings.ts";
import { aliveEmpires, colonyName, coloniesOf, hostile, msg, withRng } from "./state.ts";
import { pruneFleets } from "./world.ts";

function hasDefenses(c: Colony): boolean {
  return stationTier(c) > 0 || c.buildings.some((b) => !!BUILDING_BY_ID[b]?.defense);
}

function fleetArmed(s: GameState, fid: number): boolean {
  const f = s.fleets[fid];
  return !!f && f.ships.some((sh) => designStats(s.designs[sh.designId], null).armed);
}

/** Find hostile encounters at every star. */
export function findBattles(s: GameState): PendingBattle[] {
  const out: PendingBattle[] = [];
  const byStar = new Map<number, number[]>();
  for (const f of Object.values(s.fleets)) {
    if (f.starId === null || !f.ships.length) continue;
    byStar.set(f.starId, [...(byStar.get(f.starId) ?? []), f.id]);
  }
  for (const [starId, fids] of [...byStar.entries()].sort((a, b) => a[0] - b[0])) {
    const owners = [...new Set(fids.map((id) => s.fleets[id].owner))];
    const colonyOwners = Object.values(s.colonies).filter((c) => c.starId === starId).map((c) => c.owner);
    const parties = [...new Set([...owners, ...colonyOwners])].sort((a, b) => a - b);
    const seen = new Set<string>();
    for (const a of owners) {
      for (const b of parties) {
        if (a === b || !hostile(s, a, b)) continue;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seen.has(key)) continue;
        // the side with a colony here defends; monsters always defend their lair
        let att = a;
        let def = b;
        if (a === MONSTER_OWNER || (colonyOwners.includes(a) && !colonyOwners.includes(b) && owners.includes(b))) {
          att = b;
          def = a;
        }
        const attFleets = fids.filter((id) => s.fleets[id].owner === att);
        const defFleets = fids.filter((id) => s.fleets[id].owner === def);
        const defColony = Object.values(s.colonies).filter((c) => c.starId === starId && c.owner === def && hasDefenses(c)).sort((x, y) => stationTier(y) - stationTier(x))[0];
        if (!attFleets.length) continue;
        const attArmed = attFleets.some((id) => fleetArmed(s, id));
        const defArmed = defFleets.some((id) => fleetArmed(s, id)) || !!defColony;
        if (!attArmed && !defArmed) continue;
        if (!defFleets.length && !defColony) continue;
        seen.add(key);
        out.push({ id: s.nextId.battle++, starId, attacker: att, defender: def, attackerFleetIds: attFleets, defenderFleetIds: defFleets, defenderColonyId: defColony ? defColony.id : null });
      }
    }
  }
  return out;
}

function humanInvolved(s: GameState, pb: PendingBattle): boolean {
  return !!s.empires[pb.attacker]?.human || !!s.empires[pb.defender]?.human;
}

/** Refresh a pending battle's participants (earlier battles may have destroyed or moved fleets). */
function refreshBattle(s: GameState, pb: PendingBattle): PendingBattle | null {
  const keep = (ids: number[]) => ids.filter((id) => s.fleets[id] && s.fleets[id].starId === pb.starId && s.fleets[id].ships.length);
  const nb = { ...pb, attackerFleetIds: keep(pb.attackerFleetIds), defenderFleetIds: keep(pb.defenderFleetIds) };
  if (nb.defenderColonyId !== null && !s.colonies[nb.defenderColonyId]) nb.defenderColonyId = null;
  if (!nb.attackerFleetIds.length) return null;
  if (!nb.defenderFleetIds.length && nb.defenderColonyId === null) return null;
  return nb;
}

export function battleSeed(s: GameState, pb: PendingBattle): number {
  return (s.seed ^ Math.imul(pb.id + 1, 0x9e3779b1) ^ Math.imul(s.turn, 0x85ebca6b)) >>> 0;
}

/** Start an interactive battle for a pending encounter (used by the UI). */
export function startPendingBattle(s: GameState, battleId: number): Battle | null {
  const pb = s.pendingBattles.find((b) => b.id === battleId);
  if (!pb) return null;
  const fresh = refreshBattle(s, pb);
  if (!fresh) {
    s.pendingBattles = s.pendingBattles.filter((b) => b.id !== battleId);
    return null;
  }
  return createBattle(s, fresh, battleSeed(s, fresh));
}

/** Commit a finished (or auto-resolved) battle and drop it from the queue. */
export function concludeBattle(s: GameState, b: Battle): void {
  if (!b.over) autoResolve(b);
  applyBattle(s, b);
  s.pendingBattles = s.pendingBattles.filter((x) => x.id !== b.pendingId);
}

export function autoResolvePending(s: GameState, battleId: number): Battle | null {
  const b = startPendingBattle(s, battleId);
  if (!b) return null;
  autoResolve(b);
  concludeBattle(s, b);
  return b;
}

export interface TurnOutcome {
  phase: GameState["phase"];
  battles: number;
}

export function endTurn(s: GameState): TurnOutcome {
  if (s.winner) return { phase: s.phase, battles: 0 };
  if (s.phase === "battles") {
    if (s.pendingBattles.length) return { phase: "battles", battles: s.pendingBattles.length };
    finishTurn(s);
    return { phase: s.phase, battles: 0 };
  }
  withRng(s, (rng) => {
    for (const e of aliveEmpires(s)) {
      if (e.human) governTurn(s, e, rng);
      else aiTurn(s, e, rng);
    }
  });
  moveFleets(s);
  updateContacts(s);
  const battles = findBattles(s);
  for (const pb of battles) {
    if (humanInvolved(s, pb)) {
      s.pendingBattles.push(pb);
      continue;
    }
    const fresh = refreshBattle(s, pb);
    if (!fresh) continue;
    const b = createBattle(s, fresh, battleSeed(s, fresh));
    autoResolve(b);
    applyBattle(s, b);
  }
  if (s.pendingBattles.length) {
    s.phase = "battles";
    return { phase: "battles", battles: s.pendingBattles.length };
  }
  finishTurn(s);
  return { phase: s.phase, battles: 0 };
}

function growColony(s: GameState, c: Colony, e: Empire, growthK: number, maxPop: number): void {
  if (c.outpost) return;
  if (c.pop > maxPop) {
    c.pop = Math.max(1, maxPop);
    c.growth = 0;
  } else if (c.pop < maxPop) {
    c.growth += growthK;
    while (c.growth >= 1000 && c.pop < maxPop) {
      c.growth -= 1000;
      c.pop += 1;
      c.workers += 1;
      if (e.human) msg(s, e.id, "colony", `${colonyName(s, c)} has grown to ${c.pop} million.`, { colonyId: c.id, starId: c.starId });
    }
    if (c.pop >= maxPop) c.growth = 0;
  }
  clampJobs(c);
}

function feedEmpire(s: GameState, e: Empire, rng: Rng): void {
  const cs = coloniesOf(s, e.id).filter((c) => !c.outpost);
  let surplus = 0;
  const deficits: { c: Colony; d: number }[] = [];
  for (const c of cs) {
    const o = colonyOutput(s, c);
    const bal = o.food - o.foodNeed;
    if (bal >= 0) surplus += bal;
    else deficits.push({ c, d: -bal });
  }
  let capacity = e.freighters * 5;
  for (const { c, d } of deficits.sort((a, b) => b.d - a.d)) {
    const shipped = Math.min(d, surplus, capacity);
    surplus -= shipped;
    capacity -= shipped;
    const short = d - shipped;
    if (short >= 1) {
      c.starving += 1;
      const die = Math.min(c.pop - 1, Math.max(1, Math.floor(short / 2)));
      if (die > 0 && (c.starving >= 2 || rng.chance(0.5))) {
        c.pop -= die;
        clampJobs(c);
        msg(s, e.id, "warning", `${colonyName(s, c)} is starving: ${die} million died.`, { colonyId: c.id, starId: c.starId });
      }
    } else c.starving = 0;
  }
  for (const c of cs) if (!deficits.some((x) => x.c === c)) c.starving = 0;
}

function settleBudget(s: GameState, e: Empire, tradeBc: number): void {
  const sum = empireSummary(s, e);
  e.bc += sum.net + tradeBc;
  e.stats = { lastFood: sum.food - sum.foodNeed, lastIndustry: sum.industry, lastResearch: sum.research, lastIncome: Math.round((sum.net + tradeBc) * 10) / 10, commandUsed: sum.commandUsed, commandMax: sum.commandMax };
  if (e.bc < 0) {
    // bankrupt: sell a building with upkeep
    const cs = coloniesOf(s, e.id).filter((c) => c.buildings.some((b) => (BUILDING_BY_ID[b]?.upkeep ?? 0) > 0 && b !== "capitol"));
    if (cs.length) {
      const c = cs[0];
      const b = c.buildings.filter((x) => (BUILDING_BY_ID[x]?.upkeep ?? 0) > 0 && x !== "capitol").sort((x, y) => BUILDING_BY_ID[y].upkeep - BUILDING_BY_ID[x].upkeep)[0];
      c.buildings.splice(c.buildings.indexOf(b), 1);
      msg(s, e.id, "warning", `Treasury empty: the ${BUILDING_BY_ID[b].name} at ${colonyName(s, c)} was sold off.`, { colonyId: c.id });
    }
    e.bc = 0;
  }
  e.bc = Math.round(e.bc * 10) / 10;
}

function checkEliminations(s: GameState): void {
  for (const e of s.empires) {
    if (!e.alive) continue;
    if (coloniesOf(s, e.id).length === 0) {
      e.alive = false;
      e.eliminatedTurn = s.turn;
      for (const f of Object.values(s.fleets)) if (f.owner === e.id) delete s.fleets[f.id];
      s.proposals = s.proposals.filter((p) => p.from !== e.id && p.to !== e.id);
      for (const o of aliveEmpires(s)) msg(s, o.id, "diplomacy", `The ${e.name} has been eliminated.`);
      if (e.human) msg(s, e.id, "warning", "Our empire has fallen.");
    } else if (e.homeColonyId === null || !s.colonies[e.homeColonyId] || s.colonies[e.homeColonyId].owner !== e.id) {
      // move the capital to the largest remaining colony
      const cs = coloniesOf(s, e.id).filter((c) => !c.outpost).sort((a, b) => b.pop - a.pop);
      if (cs.length) {
        e.homeColonyId = cs[0].id;
        e.capitalStarId = cs[0].starId;
        if (!cs[0].buildings.includes("capitol")) cs[0].buildings.push("capitol");
        msg(s, e.id, "colony", `The capital has moved to ${colonyName(s, cs[0])}.`, { colonyId: cs[0].id });
      }
    }
  }
  const human = s.empires.find((e) => e.human);
  if (human && !human.alive) {
    s.winner = { empire: human.id, kind: "defeat" };
    return;
  }
  const alive = aliveEmpires(s);
  if (alive.length === 1) s.winner = { empire: alive[0].id, kind: "conquest" };
}

export function finishTurn(s: GameState): void {
  s.phase = "orders";
  s.pendingBattles = [];
  pruneFleets(s);
  withRng(s, (rng) => {
    for (const e of aliveEmpires(s)) {
      let tradeBc = 0;
      let research = 0;
      const outputs = coloniesOf(s, e.id).map((c) => [c, colonyOutput(s, c)] as const);
      for (const [c, o] of outputs) {
        research += o.research;
        tradeBc += processProduction(s, c, o.production);
      }
      feedEmpire(s, e, rng);
      settleBudget(s, e, tradeBc);
      const sum = empireSummary(s, e);
      // research agreements contribute through the summary; colony output already counted
      advanceResearch(s, e, Math.max(research, sum.research), rng);
      for (const [c, o] of outputs) if (s.colonies[c.id]) growColony(s, c, e, o.growthK, o.maxPop);
    }
    repairShips(s);
    processEspionage(s, rng);
    updateDiplomacy(s, rng);
    processEvents(s, rng);
  });
  processCouncil(s);
  checkEliminations(s);
  s.turn += 1;
  if (s.messages.length > 600) s.messages.splice(0, s.messages.length - 600);
}
