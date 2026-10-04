// Research screen: one available topic per field; pick the application to pursue.

import type { App } from "./app.ts";
import { FIELDS } from "../engine/types.ts";
import { FIELD_NAMES, TECH_SUMMARY, TOPICS, techName } from "../engine/data/techs.ts";
import { currentTopic, nextTopic, setResearch, topicCost } from "../engine/research.ts";
import { empireSummary } from "../engine/economy.ts";
import { cmdAutoResearch } from "../engine/commands.ts";
import { race } from "../engine/data/races.ts";
import { h, button, fmt } from "./dom.ts";

export function researchScreen(app: App): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const rp = empireSummary(s, e).research;
  const cur = currentTopic(e);
  const traits = race(e.raceId).traits;
  const fields = FIELDS.map((f) => {
    const t = nextTopic(e, f);
    const known = TOPICS.filter((x) => x.field === f && e.research.topicsDone.includes(x.id)).flatMap((x) => x.apps.filter((a) => e.techs.includes(a)));
    const body: (HTMLElement | null)[] = [h("h3", null, FIELD_NAMES[f])];
    if (!t) body.push(h("p", { class: "muted" }, "Field fully researched."));
    else {
      const cost = topicCost(s, e, t);
      const turns = rp > 0 ? Math.max(1, Math.ceil((cost - (cur?.id === t.id ? e.research.progress : 0)) / rp)) : Infinity;
      body.push(h("div", { class: "topic" }, h("strong", null, t.name), h("span", { class: "muted" }, ` ${cost} RP · ~${turns === Infinity ? "∞" : turns} turns`)));
      for (const a of t.apps) {
        const active = e.research.targetTech === a;
        body.push(
          button(h("span", null, h("strong", null, techName(a)), h("small", null, TECH_SUMMARY[a] ? ` — ${TECH_SUMMARY[a]}` : "")), () => {
            const err = setResearch(e, a);
            if (err) app.toast(err, "error");
            app.refresh();
          }, { cls: `app-choice ${active ? "active" : ""}`, testid: `research-${a}` }),
        );
      }
    }
    body.push(h("details", null, h("summary", null, `Known (${known.length})`), h("p", { class: "muted" }, known.map(techName).join(", ") || "—")));
    return h("div", { class: "field-card" }, ...body);
  });
  const pct = cur ? Math.min(100, (100 * e.research.progress) / topicCost(s, e, cur)) : 0;
  return h(
    "div",
    { class: "page wide" },
    h("h1", null, "Research"),
    h(
      "div",
      { class: "row" },
      h("span", null, cur ? `Researching ${techName(e.research.targetTech!)} (${cur.name}): ${fmt(e.research.progress)}/${topicCost(s, e, cur)} RP` : `No project selected · ${fmt(e.research.progress)} RP banked`),
      h("progress", { max: 100, value: pct }),
      h("span", null, `${fmt(rp)} RP/turn`),
      button("Let advisors choose", () => { cmdAutoResearch(s, e.id); app.refresh(); }),
    ),
    traits.creative ? h("p", { class: "muted" }, "Creative: completing a topic grants every application in it.") : traits.uncreative ? h("p", { class: "muted" }, "Uncreative: completing a topic grants one random application from it.") : null,
    h("div", { class: "field-grid" }, ...fields),
  );
}
