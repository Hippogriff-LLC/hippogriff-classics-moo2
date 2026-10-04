// Colony list (empire overview, tax) and the colony management screen (jobs, production, buildings).

import type { App } from "./app.ts";
import type { BuildItem, Colony } from "../engine/types.ts";
import { CLIMATES, MINERALS, PLANET_SIZES, GRAVITIES } from "../engine/types.ts";
import { BUILDING_BY_ID } from "../engine/data/buildings.ts";
import { race } from "../engine/data/races.ts";
import { colonyOutput, empireSummary } from "../engine/economy.ts";
import { availableBuildings, buildableDesigns, buy, buyCost, dequeue, enqueue, isContinuous, itemCost, itemName, moveQueueItem, FREIGHTER_COST, SPY_COST } from "../engine/production.ts";
import { coloniesOf, colonyName } from "../engine/state.ts";
import { designStats } from "../engine/designs.ts";
import { cmdAutoJobs, cmdAutoJobsAll, cmdSetTax, cmdShiftJob } from "../engine/commands.ts";
import { h, button, fmt, signed } from "./dom.ts";
import { planetImage, backdrop } from "./art.ts";
import { focusStar } from "./galaxy.ts";

function queueSummary(app: App, c: Colony): string {
  const s = app.game!;
  if (!c.queue.length) return "—";
  const it = c.queue[0];
  const cost = itemCost(s, c, it);
  const o = colonyOutput(s, c);
  const left = Math.max(0, cost - c.progress);
  const eta = isContinuous(it) ? "" : o.production > 0 ? ` (${Math.ceil(left / o.production)} t)` : " (never)";
  return `${itemName(s, it)}${eta}`;
}

export function coloniesScreen(app: App): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const m = empireSummary(s, e);
  const cs = coloniesOf(s, e.id).sort((a, b) => b.pop - a.pop);
  const rows = cs.map((c) => {
    const o = colonyOutput(s, c);
    return h(
      "tr",
      { class: "click", onclick: () => { app.colonyId = c.id; app.back = "colonies"; app.go("colony"); }, "data-testid": `colony-row-${c.id}` },
      h("td", null, colonyName(s, c)),
      h("td", null, c.outpost ? "outpost" : race(c.raceId).name),
      h("td", null, c.outpost ? "—" : `${c.pop}/${o.maxPop}`),
      h("td", null, c.outpost ? "—" : `${c.farmers}/${c.workers}/${c.scientists}`),
      h("td", { class: o.food < o.foodNeed ? "bad" : "" }, `${fmt(o.food)}/${fmt(o.foodNeed)}`),
      h("td", null, fmt(o.production)),
      h("td", null, fmt(o.research)),
      h("td", null, fmt(o.bc - o.upkeep, 1)),
      h("td", null, queueSummary(app, c)),
      h("td", null, c.governor ? "auto" : ""),
    );
  });
  const taxBtns = [0, 10, 20, 30, 40, 50].map((t) => button(`${t}%`, () => { cmdSetTax(s, e.id, t); app.refresh(); }, { cls: e.taxRate === t ? "active" : "" }));
  return h(
    "div",
    { class: "page wide" },
    h("h1", null, "Colonies"),
    h(
      "div",
      { class: "summary-cards" },
      h("div", null, h("strong", null, "Treasury"), `${fmt(e.bc)} BC, ${signed(m.net, 1)}/turn`),
      h("div", null, h("strong", null, "Income"), `${fmt(m.income, 1)} BC − upkeep ${fmt(m.upkeep, 1)} − freighters ${fmt(m.freighterUpkeep, 1)} − fleet ${fmt(m.commandUpkeep, 1)}`),
      h("div", null, h("strong", null, "Food"), `${fmt(m.food)} produced, ${fmt(m.foodNeed)} eaten; freight ${m.freightNeeded}/${m.freightCapacity}`),
      h("div", null, h("strong", null, "Spies / Freighters"), `${e.spies} / ${e.freighters}`),
    ),
    h("div", { class: "row" }, h("span", null, "Tax rate (industry → BC):"), ...taxBtns, button("Auto-assign all jobs", () => { cmdAutoJobsAll(s, e.id); app.refresh(); })),
    h("table", { class: "grid" }, h("tr", null, ...["Colony", "Race", "Pop", "F/W/S", "Food", "Prod", "Res", "BC", "Building", "Gov"].map((t) => h("th", null, t))), ...rows),
  );
}

function addItemMenu(app: App, c: Colony): HTMLElement {
  const s = app.game!;
  const groups: [string, BuildItem, number, string][] = [];
  for (const b of availableBuildings(s, c)) groups.push(["Buildings", { kind: "building", id: b.id }, itemCost(s, c, { kind: "building", id: b.id }), `upkeep ${b.upkeep} BC`]);
  for (const d of buildableDesigns(s, c)) {
    const st = designStats(d, app.me);
    groups.push(["Ships", { kind: "ship", designId: d.id }, st.cost, `${d.role}${st.armed ? `, firepower ${fmt(st.firepower)}` : ""}`]);
  }
  if (!c.outpost) {
    groups.push(["Other", { kind: "freighters" }, FREIGHTER_COST, "2 freighters (move 10 food)"]);
    groups.push(["Other", { kind: "spy" }, SPY_COST, "1 spy"]);
    groups.push(["Other", { kind: "housing" }, 0, "continuous: boosts growth"]);
    groups.push(["Other", { kind: "tradegoods" }, 0, "continuous: production → BC"]);
  }
  const sel = h("select", { "data-testid": "add-item" }, h("option", { value: "" }, "Add to queue…"));
  let cur = "";
  let og: HTMLOptGroupElement | null = null;
  groups.forEach(([g, it, cost, note], i) => {
    if (g !== cur) {
      og = h("optgroup", { label: g });
      sel.appendChild(og);
      cur = g;
    }
    og!.appendChild(h("option", { value: String(i) }, `${itemName(s, it)}${cost ? ` — ${cost}` : ""} (${note})`));
  });
  sel.addEventListener("change", () => {
    const g = groups[Number(sel.value)];
    if (!g) return;
    const err = enqueue(s, c, g[1]);
    if (err) app.toast(err, "error");
    app.refresh();
  });
  return sel;
}

export function colonyScreen(app: App): HTMLElement {
  const s = app.game!;
  const c = app.colonyId !== null ? s.colonies[app.colonyId] : undefined;
  if (!c || c.owner !== app.me.id) return h("div", { class: "page" }, h("p", null, "Colony not available."), button("Back", () => app.go("colonies")));
  const p = s.planets[c.planetId];
  const o = colonyOutput(s, c);
  const mine = coloniesOf(s, app.me.id).sort((a, b) => a.id - b.id);
  const idx = mine.findIndex((x) => x.id === c.id);
  const nav = (d: number) => {
    app.colonyId = mine[(idx + d + mine.length) % mine.length].id;
    app.refresh();
  };
  const pic = h("canvas", { width: 160, height: 120, class: "colony-pic" });
  const ctx = pic.getContext("2d")!;
  ctx.drawImage(backdrop(640, 480, "space", c.planetId), 0, 0, 160, 120);
  ctx.drawImage(planetImage(p, 40), 40, 20, 80, 80);
  const job = (label: string, key: "farmers" | "workers" | "scientists", per: number, unit: string) =>
    h(
      "div",
      { class: "job-row" },
      h("span", { class: "job-label" }, label),
      button("−", () => { cmdShiftJob(s, c.id, key, key === "workers" ? "farmers" : "workers"); app.refresh(); }, { disabled: c[key] <= 0, testid: `job-${key}-minus` }),
      h("span", { class: "job-count", "data-testid": `job-${key}` }, "●".repeat(c[key]) || "·"),
      button("+", () => {
        const from = key === "workers" ? (c.scientists > 0 ? "scientists" : "farmers") : "workers";
        cmdShiftJob(s, c.id, from, key);
        app.refresh();
      }, { disabled: c.farmers + c.workers + c.scientists - c[key] <= 0, testid: `job-${key}-plus` }),
      h("span", { class: "muted" }, `${c[key]} × ${fmt(per, 1)} ${unit}`),
    );
  const qrows = c.queue.map((it, i) => {
    const cost = itemCost(s, c, it);
    return h(
      "div",
      { class: "queue-row" },
      h("span", null, `${i + 1}. ${itemName(s, it)}`),
      h("span", { class: "muted" }, isContinuous(it) ? "continuous" : i === 0 ? `${fmt(c.progress)}/${cost}` : String(cost)),
      button("▲", () => { moveQueueItem(c, i, i - 1); app.refresh(); }, { disabled: i === 0 }),
      button("▼", () => { moveQueueItem(c, i, i + 1); app.refresh(); }, { disabled: i === c.queue.length - 1 }),
      button("✕", () => { dequeue(c, i); app.refresh(); }),
    );
  });
  const bc = c.queue.length ? buyCost(s, c) : 0;
  const buyBtn = button(`Buy (${bc} BC)`, () => {
    const name = c.queue.length ? itemName(s, c.queue[0]) : "";
    const err = buy(s, c);
    if (err) app.toast(err, "error");
    else app.toast(`Purchased ${name}; it completes next turn`);
    app.refresh();
  }, { disabled: !c.queue.length || isContinuous(c.queue[0]) || bc > app.me.bc, testid: "buy" });
  const gov = h("input", { type: "checkbox", checked: c.governor, "data-testid": "governor" }) as HTMLInputElement;
  gov.addEventListener("change", () => { c.governor = gov.checked; app.refresh(); });
  return h(
    "div",
    { class: "page wide colony" },
    h("div", { class: "row" }, button("◀", () => nav(-1), { title: "Previous colony" }), h("h1", null, colonyName(s, c)), button("▶", () => nav(1), { title: "Next colony" }), button("Show on map", () => focusStar(app, c.starId)), button("Back", () => app.go(app.back === "colony" ? "colonies" : app.back))),
    h(
      "div",
      { class: "cols" },
      h(
        "div",
        null,
        pic,
        h("p", null, `${PLANET_SIZES[p.size]} ${p.kind === "habitable" ? CLIMATES[p.climate] : p.kind}, ${MINERALS[p.minerals]}, ${GRAVITIES[p.gravity]}${p.special !== "none" ? `, ${p.special}` : ""}`),
        h("p", null, c.outpost ? "Outpost" : `${race(c.raceId).name} · population ${c.pop}/${o.maxPop}M · growth ${o.growthK >= 0 ? "+" : ""}${o.growthK}k/turn · morale ${o.morale}%`),
        c.starving ? h("p", { class: "bad" }, "Starving!") : null,
        h("h3", null, "Buildings"),
        h("ul", { class: "buildings" }, ...c.buildings.map((b) => h("li", { title: `upkeep ${BUILDING_BY_ID[b]?.upkeep ?? 0} BC` }, BUILDING_BY_ID[b]?.name ?? b))),
      ),
      h(
        "div",
        null,
        c.outpost
          ? h("p", { class: "muted" }, "Outposts have no population.")
          : h(
              "div",
              { class: "jobs" },
              h("h3", null, "Population"),
              job("Farmers", "farmers", o.foodPerFarmer, "food"),
              job("Workers", "workers", o.industryPerWorker, "industry"),
              job("Scientists", "scientists", o.researchPerScientist, "research"),
              h("div", { class: "row" }, button("Auto-assign", () => { cmdAutoJobs(s, c.id); app.refresh(); }), h("label", { class: "check" }, gov, "Governor (auto jobs & queue)")),
            ),
        h(
          "table",
          { class: "grid small" },
          h("tr", null, h("th", null, "Food"), h("td", { class: o.food < o.foodNeed ? "bad" : "" }, `${fmt(o.food)} (need ${fmt(o.foodNeed)})`)),
          h("tr", null, h("th", null, "Industry"), h("td", null, `${fmt(o.industryGross)} − pollution ${fmt(o.pollution, 1)} − tax ${fmt(o.taxed, 1)} = ${fmt(o.production, 1)} production`)),
          h("tr", null, h("th", null, "Research"), h("td", null, fmt(o.research, 1))),
          h("tr", null, h("th", null, "BC"), h("td", null, `${fmt(o.bc, 1)} income, ${fmt(o.upkeep, 1)} upkeep`)),
        ),
      ),
      h(
        "div",
        null,
        h("h3", null, "Production"),
        h("div", { class: "queue", "data-testid": "queue" }, ...(qrows.length ? qrows : [h("p", { class: "muted" }, "Queue empty — industry is wasted.")])),
        c.queue.length < 7 ? addItemMenu(app, c) : h("p", { class: "muted" }, "Queue full"),
        h("div", { class: "row" }, buyBtn, h("span", { class: "muted" }, `Treasury ${fmt(app.me.bc)} BC`)),
      ),
    ),
  );
}
