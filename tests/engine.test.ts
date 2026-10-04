// Engine unit tests: determinism, economy, research, production, colonisation, combat, invasion, saves.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState } from "../src/engine/types.ts";
import { Rng } from "../src/engine/rng.ts";
import { newGame, DEFAULT_SETTINGS } from "../src/engine/newgame.ts";
import { endTurn, autoResolvePending, findBattles } from "../src/engine/turn.ts";
import { coloniesOf, fleetsOf, withRng } from "../src/engine/state.ts";
import { colonyOutput, empireSummary } from "../src/engine/economy.ts";
import { advanceResearch, setResearch, availableTopics } from "../src/engine/research.ts";
import { enqueue, processProduction, buyCost, itemCost } from "../src/engine/production.ts";
import { designsOf, designStats } from "../src/engine/designs.ts";
import { colonize, orderMove } from "../src/engine/fleets.ts";
import { createBattle, autoResolve, applyBattle } from "../src/engine/combat.ts";
import { declareWar } from "../src/engine/diplomacy.ts";
import { invade } from "../src/engine/ground.ts";
import { spawnFleet } from "../src/engine/world.ts";
import { serialize, deserialize, SaveError, cloneState } from "../src/engine/save.ts";

function game(seed = 42, opponents = 3): GameState {
  return newGame({ seed, settings: { ...DEFAULT_SETTINGS, opponents } });
}

function playTurns(s: GameState, n: number): void {
  for (let i = 0; i < n && !s.winner; i++) {
    let r = endTurn(s);
    while (r.phase === "battles") {
      for (const pb of [...s.pendingBattles]) autoResolvePending(s, pb.id);
      r = endTurn(s);
    }
  }
}

function checkInvariants(s: GameState): void {
  for (const c of Object.values(s.colonies)) {
    assert.equal(c.farmers + c.workers + c.scientists, c.outpost ? 0 : c.pop, `jobs add up at colony ${c.id}`);
    assert.ok(c.pop >= (c.outpost ? 0 : 1), "colonies keep at least one population");
    assert.equal(s.planets[c.planetId].colonyId, c.id, "planet back-reference");
    assert.ok(s.empires[c.owner].alive, "colonies belong to living empires");
  }
  for (const f of Object.values(s.fleets)) {
    assert.ok(f.ships.length > 0, "no empty fleets");
    for (const sh of f.ships) assert.ok(s.designs[sh.designId], "ship designs exist");
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
  }
  for (const e of s.empires) {
    assert.ok(Number.isFinite(e.bc));
    for (const r of Object.values(e.relations)) assert.ok(["none", "war", "peace", "nap", "alliance"].includes(r.treaty));
  }
}

test("rng is deterministic and seed-dependent", () => {
  const a = Rng.fromSeed(7);
  const b = Rng.fromSeed(7);
  const c = Rng.fromSeed(8);
  const sa = Array.from({ length: 20 }, () => a.u32());
  assert.deepEqual(sa, Array.from({ length: 20 }, () => b.u32()));
  assert.notDeepEqual(sa, Array.from({ length: 20 }, () => c.u32()));
  const r = Rng.fromSeed(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(6);
    assert.ok(v >= 0 && v < 6 && Number.isInteger(v));
  }
});

test("new game is deterministic and well formed", () => {
  const a = game(123);
  const b = game(123);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(game(124)));
  assert.equal(a.empires.length, 4);
  assert.ok(a.empires[0].human);
  for (const e of a.empires) {
    const cs = coloniesOf(a, e.id);
    assert.equal(cs.length, 1);
    assert.ok(cs[0].buildings.includes("capitol"));
    assert.ok(fleetsOf(a, e.id).length >= 3);
  }
  checkInvariants(a);
});

test("home colonies produce food, industry and research", () => {
  const s = game(5);
  const c = coloniesOf(s, 0)[0];
  const o = colonyOutput(s, c);
  assert.ok(o.industry > 0);
  assert.ok(o.research > 0);
  assert.ok(o.food >= o.foodNeed, "homeworld feeds itself");
  const m = empireSummary(s, s.empires[0]);
  assert.equal(m.colonies, 1);
});

test("research completes a chosen application", () => {
  const s = game(9);
  const e = s.empires[0];
  const topic = availableTopics(e)[0];
  const app = topic.apps[0];
  assert.equal(setResearch(e, app), null);
  withRng(s, (rng) => advanceResearch(s, e, 100000, rng));
  assert.ok(e.techs.includes(app), `learned ${app}`);
});

test("production builds queued items and buy charges BC", () => {
  const s = game(11);
  const c = coloniesOf(s, 0)[0];
  c.queue = [];
  const scout = designsOf(s, s.empires[0]).find((d) => d.name === "Scout")!;
  assert.equal(enqueue(s, c, { kind: "ship", designId: scout.id }), null);
  const before = fleetsOf(s, 0).reduce((n, f) => n + f.ships.length, 0);
  processProduction(s, c, itemCost(s, c, c.queue[0]));
  const after = fleetsOf(s, 0).reduce((n, f) => n + f.ships.length, 0);
  assert.equal(after, before + 1);
  assert.equal(enqueue(s, c, { kind: "ship", designId: scout.id }), null);
  assert.ok(buyCost(s, c) > 0);
});

test("colony ships settle habitable planets", () => {
  const s = game(17);
  const e = s.empires[0];
  const f = fleetsOf(s, 0).find((x) => x.name === "Colony Fleet")!;
  const home = s.stars[e.capitalStarId];
  const target = home.planetIds.map((id) => s.planets[id]).find((p) => p.kind === "habitable" && p.colonyId === null);
  if (!target) return; // home system without a free habitable planet for this seed
  const r = colonize(s, f.id, target.id, false);
  assert.notEqual(typeof r, "string", String(r));
  assert.equal(coloniesOf(s, 0).length, 2);
  assert.equal(s.fleets[f.id], undefined, "colony ship consumed");
  checkInvariants(s);
});

test("fleet movement validates range", () => {
  const s = game(3);
  const f = fleetsOf(s, 0).find((x) => x.name === "Scout 1")!;
  const far = [...s.stars].sort((a, b) => Math.hypot(b.x - f.x, b.y - f.y) - Math.hypot(a.x - f.x, a.y - f.y));
  const near = far[far.length - 2];
  assert.equal(orderMove(s, f.id, near.id), null);
  assert.equal(s.fleets[f.id].destStarId, near.id);
  assert.notEqual(orderMove(s, f.id, -5), null);
});

test("space combat is deterministic and applies losses", () => {
  const s = game(21);
  const e0 = s.empires[0];
  const e1 = s.empires[1];
  e0.relations[1].contact = true;
  e1.relations[0].contact = true;
  assert.equal(declareWar(s, 1, 0), null);
  const guard1 = fleetsOf(s, 1).find((f) => f.name === "Home Guard")!;
  const destroyer = designsOf(s, e1).find((d) => d.name === "Destroyer")!;
  const raid = spawnFleet(s, 1, e0.capitalStarId, [destroyer.id, destroyer.id, destroyer.id, guard1.ships[0].designId], "Raid");
  const battles = findBattles(s).filter((b) => b.starId === e0.capitalStarId);
  assert.equal(battles.length, 1);
  const pb = battles[0];
  assert.ok(pb.attackerFleetIds.includes(raid.id) || pb.defenderFleetIds.includes(raid.id));
  const b1 = createBattle(s, pb, 99);
  const b2 = createBattle(cloneState(s), pb, 99);
  autoResolve(b1);
  autoResolve(b2);
  assert.ok(b1.over);
  assert.deepEqual(
    b1.units.map((u) => [u.uid, u.structure, u.armor, u.destroyed]),
    b2.units.map((u) => [u.uid, u.structure, u.armor, u.destroyed]),
  );
  const reports = s.battleReports.length;
  applyBattle(s, b1);
  assert.equal(s.battleReports.length, reports + 1);
  checkInvariants(s);
});

test("ground invasion captures an undefended colony", () => {
  const s = game(31);
  const e0 = s.empires[0];
  e0.relations[1].contact = true;
  s.empires[1].relations[0].contact = true;
  declareWar(s, 0, 1);
  const target = coloniesOf(s, 1)[0];
  target.buildings = target.buildings.filter((b) => b !== "star_base" && b !== "marine_barracks");
  for (const f of fleetsOf(s, 1)) if (f.starId === target.starId) delete s.fleets[f.id];
  for (const f of Object.values(s.fleets)) if (f.owner < 0 && f.starId === target.starId) delete s.fleets[f.id];
  const transport = designsOf(s, e0).find((d) => d.name === "Transport")!;
  assert.ok(designStats(transport, e0).troops > 0);
  const fleet = spawnFleet(s, 0, target.starId, Array(12).fill(transport.id), "Invasion");
  const r = withRng(s, (rng) => invade(s, fleet.id, target.id, rng));
  assert.notEqual(typeof r, "string", String(r));
  if (typeof r !== "string") assert.ok(r.success);
  assert.equal(s.colonies[target.id].owner, 0);
  checkInvariants(s);
});

test("save files round-trip and reject tampering", () => {
  const s = game(77);
  playTurns(s, 3);
  const text = serialize(s, "test", new Date(0));
  const loaded = deserialize(text);
  assert.equal(JSON.stringify(loaded.state), JSON.stringify(s));
  assert.equal(loaded.header.turn, s.turn);
  const tampered = text.replace(/"bc":\d+/, '"bc":999999');
  assert.throws(() => deserialize(tampered), SaveError);
  assert.throws(() => deserialize("not json"), SaveError);
  assert.throws(() => deserialize('{"header":{"format":"other"},"state":{}}'), SaveError);
});

test("turn processing is deterministic across save/load", () => {
  const a = game(55);
  playTurns(a, 10);
  const b = deserialize(serialize(a, "", new Date(0))).state;
  playTurns(a, 15);
  playTurns(b, 15);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
