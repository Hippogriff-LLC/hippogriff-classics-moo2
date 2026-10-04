// Integration test: long all-AI games through the public turn API keep the state consistent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, DEFAULT_SETTINGS } from "../src/engine/newgame.ts";
import { endTurn, autoResolvePending } from "../src/engine/turn.ts";
import { aiTurn } from "../src/engine/ai.ts";
import { coloniesOf, withRng } from "../src/engine/state.ts";
import { serialize, deserialize } from "../src/engine/save.ts";

for (const seed of [1, 2]) {
  test(`all-AI game (seed ${seed}) runs 120 turns with consistent state`, () => {
    const s = newGame({ seed, settings: { ...DEFAULT_SETTINGS, galaxySize: "medium", opponents: 4, playerRace: seed === 1 ? "human" : "klackon" } });
    const start = s.empires.map((e) => coloniesOf(s, e.id).length);
    for (let i = 0; i < 120 && !s.winner; i++) {
      withRng(s, (rng) => aiTurn(s, s.empires[0], rng));
      let r = endTurn(s);
      let guard = 0;
      while (r.phase === "battles") {
        for (const pb of [...s.pendingBattles]) autoResolvePending(s, pb.id);
        r = endTurn(s);
        assert.ok(++guard < 5, "battle phase terminates");
      }
      if (i % 30 === 0) deserialize(serialize(s)); // save always valid
      for (const c of Object.values(s.colonies)) {
        assert.equal(c.farmers + c.workers + c.scientists, c.outpost ? 0 : c.pop);
        assert.ok(c.queue.length <= 7);
      }
      for (const f of Object.values(s.fleets)) assert.ok(f.ships.length > 0);
    }
    assert.ok(s.turn > 100 || s.winner, "game advanced");
    const total = s.empires.reduce((n, e) => n + coloniesOf(s, e.id).length, 0);
    assert.ok(total > start.reduce((a, b) => a + b, 0), "empires expanded");
    assert.ok(s.empires.some((e) => e.techs.length > 20), "research progressed");
  });
}
