// Fleets overview, races/diplomacy/espionage and the information screen.

import type { App } from "./app.ts";
import type { DiplomaticProposal, Empire, Fleet } from "../engine/types.ts";
import { aliveEmpires, coloniesOf, relation, stardate } from "../engine/state.ts";
import { breakTreaty, declareWar, empirePower, propose, proposalValid, PROPOSAL_KINDS } from "../engine/diplomacy.ts";
import { fleetSpeed } from "../engine/fleets.ts";
import { empireSummary } from "../engine/economy.ts";
import { designStats } from "../engine/designs.ts";
import { EMPIRE_COLORS, race } from "../engine/data/races.ts";
import { h, button, select, fmt } from "./dom.ts";
import { fleetLabel, focusStar } from "./galaxy.ts";
import { portrait } from "./art.ts";

const KIND_TEXT: Record<DiplomaticProposal["kind"], string> = {
  peace: "Peace treaty",
  nap: "Non-aggression pact",
  alliance: "Alliance",
  trade: "Trade agreement",
  research: "Research agreement",
  tribute: "Gift 50 BC",
};

function fleetWhere(app: App, f: Fleet): string {
  const s = app.game!;
  if (f.starId !== null) return `at ${s.stars[f.starId].name}`;
  return f.destStarId !== null ? `en route to ${s.stars[f.destStarId].name}` : "in deep space";
}

export function fleetsScreen(app: App): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const mine = Object.values(s.fleets).filter((f) => f.owner === e.id);
  const sum = empireSummary(s, e);
  const rows = mine.map((f) => {
    const hp = f.ships.reduce((a, sh) => {
      const st = designStats(s.designs[sh.designId], e);
      return a + (sh.hp.structure + sh.hp.armor) / Math.max(1, st.structure + st.armor);
    }, 0) / Math.max(1, f.ships.length);
    return h(
      "tr",
      { "data-testid": `fleet-row-${f.id}` },
      h("td", null, f.name),
      h("td", null, fleetLabel(s, f)),
      h("td", null, fleetWhere(app, f)),
      h("td", null, String(fleetSpeed(s, f))),
      h("td", null, `${Math.round(hp * 100)}%`),
      h("td", null, button("Show", () => {
        const at = f.starId ?? f.destStarId ?? f.originStarId;
        if (at !== null) focusStar(app, at);
        app.sel.fleetId = f.id;
        app.render();
      })),
    );
  });
  return h(
    "div",
    { class: "page wide" },
    h("h1", null, "Fleets"),
    h("p", null, `${mine.length} fleets, ${mine.reduce((a, f) => a + f.ships.length, 0)} ships · Command points ${sum.commandUsed}/${sum.commandMax}${sum.commandUpkeep ? ` (over capacity costs ${fmt(sum.commandUpkeep, 1)} BC/turn)` : ""} · Freighters ${e.freighters} (${fmt(sum.freightNeeded, 1)} needed)`),
    mine.length ? h("table", { class: "grid" }, h("tr", null, ...["Fleet", "Ships", "Location", "Speed", "Condition", ""].map((t) => h("th", null, t))), ...rows) : h("p", { class: "muted" }, "You have no fleets."),
  );
}

function treatyLabel(t: string): string {
  return ({ none: "No treaty", war: "WAR", peace: "Peace", nap: "Non-aggression", alliance: "Alliance" } as Record<string, string>)[t] ?? t;
}

function attitudeLabel(a: number): string {
  if (a >= 60) return "Harmonious";
  if (a >= 25) return "Peaceful";
  if (a >= -10) return "Relaxed";
  if (a >= -40) return "Wary";
  if (a >= -70) return "Irritated";
  return "Belligerent";
}

function raceCard(app: App, o: Empire): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const mine = relation(s, e.id, o.id)!;
  const theirs = relation(s, o.id, e.id)!;
  const rd = race(o.raceId);
  const pic = portrait(o.raceId, 96, 106);
  pic.classList.add("portrait");
  const body: (HTMLElement | null)[] = [
    h("h3", { style: `color:${EMPIRE_COLORS[o.color]}` }, o.name),
    h("p", null, `${o.leaderName} · ${rd.plural} · ${o.government.replace("_", " ")}`),
  ];
  if (!o.alive) {
    body.push(h("p", { class: "muted" }, `Eliminated on turn ${o.eliminatedTurn ?? "?"}.`));
    return h("div", { class: "race-card dead" }, pic, h("div", null, ...body));
  }
  if (!mine.contact) {
    body.push(h("p", { class: "muted" }, "No contact yet."));
    return h("div", { class: "race-card" }, pic, h("div", null, ...body));
  }
  body.push(
    h("p", null, h("strong", { class: mine.treaty === "war" ? "bad" : "" }, treatyLabel(mine.treaty)), mine.trade ? " · Trade" : "", mine.research ? " · Research" : "", ` · Attitude: ${attitudeLabel(theirs.attitude)} (${theirs.attitude})`),
    h("p", { class: "muted" }, `Colonies ${coloniesOf(s, o.id).length} · Power ${empirePower(s, o)} · Techs ${o.techs.length}`),
  );
  const offers = PROPOSAL_KINDS.filter((k) => !proposalValid(s, e.id, o.id, k));
  const acts: HTMLElement[] = offers.map((k) =>
    button(KIND_TEXT[k], () => {
      const r = propose(s, e.id, o.id, k, k === "tribute" ? 50 : 0);
      if (r.error) app.toast(r.error, "error");
      else app.toast(`The ${o.name} ${r.accepted ? "accepted" : "rejected"} the ${KIND_TEXT[k].toLowerCase()}.`, r.accepted ? "info" : "error");
      app.refresh();
    }, { disabled: (k === "tribute" && e.bc < 50) || mine.lastProposalTurn === s.turn, title: mine.lastProposalTurn === s.turn ? "Only one proposal per empire per turn" : "", testid: `propose-${o.id}-${k}` }),
  );
  if (mine.treaty !== "war") {
    if (mine.treaty !== "none" || mine.trade || mine.research) acts.push(button("Break treaties", () => app.confirm("Break treaties", `Cancel all treaties with the ${o.name}?`, () => { breakTreaty(s, e.id, o.id); app.refresh(); }), { testid: `break-${o.id}` }));
    acts.push(button("Declare war", () => app.confirm("Declare war", `Declare war on the ${o.name}?`, () => {
      const err = declareWar(s, e.id, o.id);
      if (err) app.toast(err, "error");
      app.refresh();
    }, "Declare war"), { cls: "danger", testid: `war-${o.id}` }));
  }
  body.push(h("div", { class: "row wrap" }, ...acts));
  return h("div", { class: "race-card", "data-testid": `race-card-${o.id}` }, pic, h("div", null, ...body));
}

export function racesScreen(app: App): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const others = s.empires.filter((o) => o.id !== e.id);
  const contacts = others.filter((o) => o.alive && relation(s, e.id, o.id)?.contact);
  const target = select(e.espionage.target ?? -1, [[-1, "Defend at home"], ...contacts.map((o) => [o.id, o.name] as [number, string])], (v) => {
    e.espionage.target = v < 0 ? null : v;
    app.refresh();
  }, { "data-testid": "spy-target" });
  const mode = select(e.espionage.mode, [["steal", "Steal technology"], ["sabotage", "Sabotage"]], (v) => {
    e.espionage.mode = v;
    app.refresh();
  });
  return h(
    "div",
    { class: "page wide" },
    h("h1", null, "Races & Diplomacy"),
    h("div", { class: "row" }, h("strong", null, `Spies: ${e.spies}`), h("label", null, "Mission ", target), h("label", null, "Mode ", mode), h("span", { class: "muted" }, "Train spies from a colony's build queue.")),
    h("div", { class: "race-grid" }, ...others.map((o) => raceCard(app, o))),
  );
}

export function infoScreen(app: App): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const msgs = s.messages.filter((m) => m.empire === e.id).slice(-80).reverse();
  const reports = s.battleReports.filter((r) => r.attacker === e.id || r.defender === e.id).slice(-20).reverse();
  const known = aliveEmpires(s).filter((o) => o.id === e.id || relation(s, e.id, o.id)?.contact);
  const name = (id: number) => (id < 0 ? "Monsters" : s.empires[id].name);
  return h(
    "div",
    { class: "page wide" },
    h("h1", null, "Information"),
    h(
      "div",
      { class: "cols" },
      h(
        "div",
        null,
        h("h3", null, "Empire comparison"),
        h(
          "table",
          { class: "grid" },
          h("tr", null, ...["Empire", "Colonies", "Population", "Power", "Techs"].map((t) => h("th", null, t))),
          ...known.map((o) => h("tr", null, h("td", { style: `color:${EMPIRE_COLORS[o.color]}` }, o.name), h("td", null, String(coloniesOf(s, o.id).length)), h("td", null, fmt(coloniesOf(s, o.id).reduce((a, c) => a + c.pop, 0))), h("td", null, String(empirePower(s, o))), h("td", null, String(o.techs.length)))),
        ),
        h("h3", null, "Galactic Council"),
        h("p", null, `Next session: turn ${s.council.nextTurn} (stardate ${stardate(s.council.nextTurn)}).`),
        s.council.lastResult ? h("pre", { class: "council" }, s.council.lastResult) : null,
        h("h3", null, "Battle reports"),
        reports.length
          ? h("table", { class: "grid small" }, h("tr", null, ...["Turn", "System", "Attacker", "Defender", "Winner", "Losses A/D"].map((t) => h("th", null, t))), ...reports.map((r) => h("tr", null, h("td", null, String(r.turn)), h("td", null, s.stars[r.starId].name), h("td", null, name(r.attacker)), h("td", null, name(r.defender)), h("td", null, r.winner === null ? "Draw" : name(r.winner)), h("td", null, `${r.attackerLosses}/${r.defenderLosses}`))))
          : h("p", { class: "muted" }, "No battles yet."),
      ),
      h(
        "div",
        null,
        h("h3", null, "Messages"),
        h("ul", { class: "news", "data-testid": "messages" }, ...msgs.map((m) => h("li", { class: `msg-${m.kind}`, onclick: m.starId !== undefined ? () => focusStar(app, m.starId!) : undefined }, h("span", { class: "muted" }, `T${m.turn} `), m.text))),
      ),
    ),
  );
}
