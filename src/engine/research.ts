// Research: per-field topic chains, one application chosen per topic.

import type { Empire, Field, GameState } from "./types.ts";
import { FIELDS } from "./types.ts";
import type { Topic } from "./data/techs.ts";
import { TOPICS, TOPIC_OF_APP, techName } from "./data/techs.ts";
import { race } from "./data/races.ts";
import type { Rng } from "./rng.ts";
import { hasTech, msg } from "./state.ts";

const DIFFICULTY_RESEARCH: Record<string, number> = { tutor: 1.3, easy: 1.15, average: 1, hard: 0.9, impossible: 0.8 };

export function nextTopic(e: Empire, field: Field): Topic | null {
  for (const t of TOPICS) {
    if (t.field !== field) continue;
    if (!e.research.topicsDone.includes(t.id)) return t;
  }
  return null;
}

export function availableTopics(e: Empire): Topic[] {
  const out: Topic[] = [];
  for (const f of FIELDS) {
    const t = nextTopic(e, f);
    if (t) out.push(t);
  }
  return out;
}

export function topicCost(s: GameState, e: Empire, t: Topic): number {
  let c = t.cost;
  if (!e.human) c *= DIFFICULTY_RESEARCH[s.settings.difficulty] ?? 1;
  if (race(e.raceId).traits.creative) c *= 1.1;
  return Math.max(1, Math.round(c));
}

export function currentTopic(e: Empire): Topic | null {
  const id = e.research.targetTech;
  return id ? TOPIC_OF_APP[id] ?? null : null;
}

export function setResearch(e: Empire, appId: string): string | null {
  const t = TOPIC_OF_APP[appId];
  if (!t) return "unknown technology";
  if (hasTech(e, appId)) return "already known";
  const next = nextTopic(e, t.field);
  if (!next || next.id !== t.id) return "topic not yet available";
  e.research.targetTech = appId;
  return null;
}

const GOV_ADVANCE: Record<string, Empire["government"]> = {
  feudal: "confederation",
  dictatorship: "imperium",
  democracy: "federation",
};

function grant(s: GameState, e: Empire, app: string): void {
  if (!e.techs.includes(app)) e.techs.push(app);
  if (app === "government_advance") {
    const ng = GOV_ADVANCE[e.government];
    if (ng) {
      e.government = ng;
      msg(s, e.id, "research", `Our government has advanced to ${ng[0].toUpperCase()}${ng.slice(1)}.`);
    }
  }
  if (app === "galactic_unification" && e.government === "unification") e.government = "galactic_unification";
}

/** Add research points; completes the current topic when funded. Returns completed topic names. */
export function advanceResearch(s: GameState, e: Empire, rp: number, rng: Rng): string[] {
  const done: string[] = [];
  e.research.progress += rp;
  for (let guard = 0; guard < 4; guard++) {
    const t = currentTopic(e);
    if (!t) break;
    const cost = topicCost(s, e, t);
    if (e.research.progress < cost) break;
    e.research.progress -= cost;
    const traits = race(e.raceId).traits;
    let gained: string[];
    if (traits.creative) gained = t.apps.filter((a) => !hasTech(e, a));
    else if (traits.uncreative) gained = [rng.pick(t.apps)];
    else gained = [e.research.targetTech!];
    for (const a of gained) grant(s, e, a);
    e.research.topicsDone.push(t.id);
    e.research.targetTech = null;
    done.push(t.name);
    msg(s, e.id, "research", `Research complete: ${t.name} — ${gained.map(techName).join(", ")}.`);
  }
  // cap stored overflow so long idle periods do not bank whole topics
  if (!e.research.targetTech) e.research.progress = Math.min(e.research.progress, 2000);
  return done;
}

/** Grant a specific app (espionage, events, trades). Marks its topic done if this is the next topic. */
export function grantTech(s: GameState, e: Empire, app: string): boolean {
  if (hasTech(e, app)) return false;
  const t = TOPIC_OF_APP[app];
  if (!t) return false;
  grant(s, e, app);
  if (!e.research.topicsDone.includes(t.id)) {
    const next = nextTopic(e, t.field);
    if (next && next.id === t.id) {
      e.research.topicsDone.push(t.id);
      if (e.research.targetTech && TOPIC_OF_APP[e.research.targetTech]?.id === t.id) e.research.targetTech = null;
    }
  }
  return true;
}

/** Technologies the other empire knows that we do not. */
export function techGap(e: Empire, other: Empire): string[] {
  return other.techs.filter((t) => !e.techs.includes(t) && TOPIC_OF_APP[t]);
}

/** Application priority used by AI and the human "auto" button. */
const APP_PRIORITY = [
  "automated_factory", "research_laboratory", "hydroponic_farm", "fusion_drive", "tritanium_armor", "fusion_beam", "class_i_shield",
  "deuterium_fuel_cells", "optronic_computer", "biospheres", "soil_enrichment", "robo_miner_plant", "merculite_missile", "zortrium_armor",
  "planetary_supercomputer", "ion_drive", "class_iii_shield", "space_port", "neutron_blaster", "cloning_center", "positronic_computer",
  "iridium_fuel_cells", "battle_scanner", "inertial_stabilizer", "pulson_missile", "robotic_factory", "anti_matter_drive", "graviton_beam",
  "neutronium_armor", "class_v_shield", "astro_university", "government_advance", "deep_core_mine", "phasor", "autolab",
];

export function aiChooseResearch(e: Empire, rng: Rng): string | null {
  const topics = availableTopics(e);
  if (!topics.length) return null;
  const sci = e.ai.science;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const t of topics) {
    for (const a of t.apps) {
      if (hasTech(e, a)) continue;
      const pri = APP_PRIORITY.indexOf(a);
      let score = -t.cost / 200 + (pri >= 0 ? 30 - pri * 0.6 : 0) + rng.next() * 4;
      if (t.field === "computers" || t.field === "sociology") score += sci * 3;
      if (t.field === "physics" || t.field === "fields") score += e.ai.aggression * 3;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
  }
  return best;
}
