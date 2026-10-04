// New game setup: galaxy, empires, homeworlds, starting fleets, monsters.

import type { Empire, GameSettings, GameState, Relation, ShipDesign } from "./types.ts";
import { MONSTER_OWNER } from "./types.ts";
import { Rng } from "./rng.ts";
import { generateGalaxy, shapeHomeSystem } from "./galaxy.ts";
import { RACES, race } from "./data/races.ts";
import { START_TECHS, START_TOPICS } from "./data/techs.ts";
import { uniqueNames } from "./names.ts";
import { addDesign, designsOf, initialDesigns } from "./designs.ts";
import { autoAssignJobs } from "./economy.ts";
import { createColony, spawnFleet } from "./world.ts";

export interface NewGameOptions {
  settings: GameSettings;
  seed: number;
  /** names decoded from a user-imported installation (never bundled) */
  importedNames?: { stars?: string[]; ships?: string[] };
}

export const DEFAULT_SETTINGS: GameSettings = {
  galaxySize: "small",
  galaxyAge: "average",
  opponents: 3,
  difficulty: "average",
  playerRace: "human",
  playerName: "Commander",
  playerColor: 4,
  events: true,
  antarans: false,
};

const GOV_TITLE: Record<string, string> = {
  feudal: "Kingdom",
  dictatorship: "Empire",
  democracy: "Republic",
  unification: "Collective",
};

function emptyRelation(): Relation {
  return { contact: false, treaty: "none", trade: false, research: false, attitude: 0, lastWarTurn: -999, lastProposalTurn: -999 };
}

function monsterDesign(name: string, hull: number, weapons: [string, number][], m: NonNullable<ShipDesign["monster"]>, img: number): ShipDesign {
  return {
    id: -1,
    owner: MONSTER_OWNER,
    name,
    hull,
    role: "monster",
    computer: null,
    armor: "titanium_armor",
    shield: null,
    drive: "nuclear_drive",
    weapons: weapons.map(([weaponId, count]) => ({ weaponId, count })),
    specials: [],
    obsolete: false,
    imageIndex: img,
    monster: m,
  };
}

export function newGame(opts: NewGameOptions): GameState {
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  settings.opponents = Math.max(1, Math.min(7, Math.floor(settings.opponents)));
  const rng = Rng.fromSeed(opts.seed);
  const nEmpires = settings.opponents + 1;
  const starNames = uniqueNames(rng, 90, opts.importedNames?.stars ?? []);
  const g = generateGalaxy(rng, settings, nEmpires, starNames);
  const s: GameState = {
    schema: 1,
    id: `g${(opts.seed >>> 0).toString(36)}-${rng.u32().toString(36)}`,
    seed: opts.seed >>> 0,
    rng: [0, 0, 0, 0],
    turn: 1,
    phase: "orders",
    settings,
    width: g.width,
    height: g.height,
    stars: g.stars,
    planets: g.planets,
    colonies: {},
    fleets: {},
    designs: [],
    empires: [],
    nextId: { colony: 0, fleet: 0, ship: 0, proposal: 0, battle: 0 },
    messages: [],
    proposals: [],
    pendingBattles: [],
    battleReports: [],
    council: { nextTurn: 100, lastResult: null, pendingDecision: null },
    winner: null,
    nameSource: opts.importedNames?.stars?.length ? "imported" : "builtin",
  };

  // races and colours
  const player = race(settings.playerRace);
  const otherRaces = rng.shuffle(RACES.filter((r) => r.id !== player.id).map((r) => r.id));
  const colors = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7].filter((c) => c !== settings.playerColor));
  const raceIds = [player.id, ...otherRaces.slice(0, settings.opponents)];
  raceIds.forEach((rid, i) => {
    const rd = race(rid);
    const human = i === 0;
    const e: Empire = {
      id: i,
      name: `${rd.name} ${GOV_TITLE[rd.traits.government] ?? "Empire"}`,
      leaderName: human ? settings.playerName || "Commander" : rng.pick(rd.leaderNames),
      raceId: rid,
      color: human ? settings.playerColor : colors[i - 1],
      human,
      alive: true,
      bc: 50,
      taxRate: 20,
      government: rd.traits.government,
      research: { targetTech: null, progress: 0, topicsDone: [...START_TOPICS] },
      techs: [...START_TECHS],
      freighters: 2,
      spies: 0,
      espionage: { target: null, mode: "steal" },
      relations: {},
      homeColonyId: null,
      capitalStarId: g.homeStarIds[i],
      ai: {
        aggression: Math.max(0, Math.min(1, rd.personality.aggression + (rng.next() - 0.5) * 0.3)),
        expansion: Math.max(0, Math.min(1, rd.personality.expansion + (rng.next() - 0.5) * 0.3)),
        science: Math.max(0, Math.min(1, rd.personality.science + (rng.next() - 0.5) * 0.3)),
        lastWarCheck: 0,
        targetEmpire: null,
      },
      stats: { lastFood: 0, lastIndustry: 0, lastResearch: 0, lastIncome: 0, commandUsed: 0, commandMax: 0 },
      eliminatedTurn: null,
    };
    s.empires.push(e);
  });
  for (const a of s.empires) for (const b of s.empires) if (a.id !== b.id) a.relations[b.id] = emptyRelation();
  for (const a of s.empires) {
    for (const b of s.empires) {
      if (a.id === b.id) continue;
      const tb = race(b.raceId).traits;
      a.relations[b.id].attitude = tb.charismatic ? 15 : tb.repulsive ? -15 : 0;
    }
  }

  // homeworlds and starting assets
  for (const e of s.empires) {
    const t = race(e.raceId).traits;
    const homeStar = e.capitalStarId;
    const hw = shapeHomeSystem(rng, s.stars, s.planets, homeStar, {
      size: t.homeworldSize,
      climate: t.aquatic ? 5 : 8,
      minerals: t.homeworldRichness,
      gravity: t.gravity === "low" ? 0 : t.gravity === "high" ? 2 : 1,
    });
    const startPop = [4, 6, 8, 10, 12][hw.size];
    const c = createColony(s, e.id, hw.id, e.raceId, startPop, false);
    c.buildings.push("capitol", "marine_barracks", "star_base");
    c.governor = !e.human;
    e.homeColonyId = c.id;
    autoAssignJobs(s, c);
    initialDesigns(s, e);
    const ds = designsOf(s, e);
    const byName = (n: string) => ds.find((d) => d.name === n)!.id;
    spawnFleet(s, e.id, homeStar, [byName("Frigate"), byName("Frigate")], "Home Guard");
    spawnFleet(s, e.id, homeStar, [byName("Colony Ship")], "Colony Fleet");
    spawnFleet(s, e.id, homeStar, [byName("Scout")], "Scout 1");
    spawnFleet(s, e.id, homeStar, [byName("Scout")], "Scout 2");
  }
  // planets are created after the homeworld shaping; keep star planet lists consistent
  for (const st of s.stars) st.planetIds.sort((a, b) => s.planets[a].orbit - s.planets[b].orbit);

  // monsters
  const guardian = addDesign(s, monsterDesign("Orion Guardian", 5, [["death_ray", 4], ["plasma_cannon", 6], ["zeon_missile", 4]], { name: "Orion Guardian", structure: 600, armor: 1500, shield: 10, attack: 125, defense: 0 }, 400));
  spawnFleet(s, MONSTER_OWNER, g.orionStarId, [guardian.id], "Orion Guardian");
  const leviathan = addDesign(s, monsterDesign("Void Leviathan", 3, [["fusion_beam", 8]], { name: "Void Leviathan", structure: 120, armor: 160, shield: 2, attack: 40, defense: 10 }, 410));
  const swarm = addDesign(s, monsterDesign("Crystal Swarm", 2, [["laser_cannon", 6], ["nuclear_missile", 2]], { name: "Crystal Swarm", structure: 60, armor: 80, shield: 1, attack: 30, defense: 20 }, 420));
  const lairs = s.stars.filter((st) => st.special === "none" && st.color !== "blackhole" && st.planetIds.some((pid) => s.planets[pid].kind === "habitable" && s.planets[pid].climate >= 5));
  rng.shuffle(lairs);
  const homes = s.empires.map((e) => s.stars[e.capitalStarId]);
  const nMonsters = Math.max(1, Math.floor(s.stars.length / 14));
  let placed = 0;
  for (const st of lairs) {
    if (placed >= nMonsters) break;
    if (homes.some((h) => Math.hypot(h.x - st.x, h.y - st.y) < 6)) continue;
    spawnFleet(s, MONSTER_OWNER, st.id, [placed % 2 === 0 ? leviathan.id : swarm.id], placed % 2 === 0 ? "Void Leviathan" : "Crystal Swarm");
    placed++;
  }

  s.rng = rng.state();
  return s;
}
