// Playable race definitions.
// Trait magnitudes are reconstructed approximations of the classic picks system (see docs/research/RULES.md);
// they are not claimed to be byte-exact with the original.

import type { Government } from "../types.ts";

export interface RaceTraits {
  food: number; // per-farmer bonus (-0.5, +1, +2)
  industry: number; // per-worker bonus
  research: number; // per-scientist bonus
  growth: number; // multiplier delta (-0.5, +0.5, +1.0)
  money: number; // BC per pop multiplier delta
  shipAttack: number; // beam attack bonus
  shipDefense: number; // beam defense bonus
  ground: number; // ground combat bonus
  spying: number; // espionage bonus
  gravity: "low" | "normal" | "high";
  homeworldSize: number; // planet size index
  homeworldRichness: number; // minerals index
  government: Government;
  aquatic: boolean;
  subterranean: boolean;
  lithovore: boolean;
  telepathic: boolean;
  tolerant: boolean;
  creative: boolean;
  uncreative: boolean;
  charismatic: boolean;
  repulsive: boolean;
  lucky: boolean;
  cybernetic: boolean;
  omniscient: boolean;
  stealthy: boolean;
  tradeBonus: boolean;
  warlord: boolean;
  artifacts: boolean;
}

export interface RaceDef {
  id: string;
  name: string;
  plural: string;
  portrait: number; // index in the imported portrait set (RACESEL)
  tint: string; // fallback UI colour for procedural portrait
  traits: RaceTraits;
  personality: { aggression: number; expansion: number; science: number };
  leaderNames: string[];
}

const base: RaceTraits = {
  food: 0,
  industry: 0,
  research: 0,
  growth: 0,
  money: 0,
  shipAttack: 0,
  shipDefense: 0,
  ground: 0,
  spying: 0,
  gravity: "normal",
  homeworldSize: 2,
  homeworldRichness: 2,
  government: "dictatorship",
  aquatic: false,
  subterranean: false,
  lithovore: false,
  telepathic: false,
  tolerant: false,
  creative: false,
  uncreative: false,
  charismatic: false,
  repulsive: false,
  lucky: false,
  cybernetic: false,
  omniscient: false,
  stealthy: false,
  tradeBonus: false,
  warlord: false,
  artifacts: false,
};

function r(id: string, name: string, plural: string, portrait: number, tint: string, t: Partial<RaceTraits>, p: [number, number, number], leaders: string[]): RaceDef {
  return { id, name, plural, portrait, tint, traits: { ...base, ...t }, personality: { aggression: p[0], expansion: p[1], science: p[2] }, leaderNames: leaders };
}

// Leader names are project-authored placeholders.
export const RACES: RaceDef[] = [
  r("alkari", "Alkari", "Alkari", 0, "#b0a070", { shipDefense: 25, gravity: "low", artifacts: true }, [0.5, 0.5, 0.5], ["Skyreach", "Talonis", "Aerin"]),
  r("bulrathi", "Bulrathi", "Bulrathi", 1, "#8a6a40", { ground: 20, shipAttack: 20, gravity: "high", homeworldSize: 3 }, [0.8, 0.5, 0.3], ["Grawl", "Ursk", "Mordak"]),
  r("darlok", "Darlok", "Darloks", 2, "#5b4a8a", { spying: 20, stealthy: true, repulsive: true }, [0.7, 0.4, 0.4], ["Shade", "Vex", "Nihl"]),
  r("elerian", "Elerian", "Elerians", 3, "#a070b0", { telepathic: true, omniscient: true, shipDefense: 10, government: "feudal", food: 1 }, [0.6, 0.5, 0.4], ["Ysolde", "Merai", "Thessaly"]),
  r("gnolam", "Gnolam", "Gnolams", 4, "#c09050", { money: 1, lucky: true, gravity: "low", tradeBonus: true }, [0.2, 0.6, 0.4], ["Bricabrac", "Goldfang", "Tallyman"]),
  r("human", "Human", "Humans", 5, "#5070c0", { charismatic: true, government: "democracy", money: 0.5, tradeBonus: true }, [0.4, 0.6, 0.6], ["Hartmann", "Okafor", "Lindqvist"]),
  r("klackon", "Klackon", "Klackons", 6, "#c06030", { food: 1, industry: 1, government: "unification", ground: 10, uncreative: true }, [0.5, 0.8, 0.2], ["Kkr-Tik", "Zzat", "Chkt"]),
  r("meklar", "Meklar", "Meklars", 7, "#6080a0", { industry: 2, cybernetic: true, homeworldSize: 3 }, [0.5, 0.6, 0.5], ["Unit 7", "Calculon", "Gearmind"]),
  r("mrrshan", "Mrrshan", "Mrrshans", 8, "#d0a040", { shipAttack: 50, warlord: true }, [0.9, 0.5, 0.3], ["Fangclaw", "Rrowl", "Sheyra"]),
  r("psilon", "Psilon", "Psilons", 9, "#a090d0", { research: 2, creative: true, government: "democracy", homeworldSize: 3 }, [0.2, 0.5, 0.9], ["Theorem", "Axiom", "Quorum"]),
  r("sakkra", "Sakkra", "Sakkra", 10, "#60a050", { growth: 1, food: 1, subterranean: true, gravity: "high", government: "feudal" }, [0.7, 0.9, 0.2], ["Ssithra", "Kesh", "Vorrk"]),
  r("silicoid", "Silicoid", "Silicoids", 11, "#a0a0a0", { lithovore: true, tolerant: true, repulsive: true, growth: -0.5, industry: 1, research: -1 }, [0.6, 0.8, 0.2], ["Crystallus", "Geode", "Obsidian"]),
  r("trilarian", "Trilarian", "Trilarians", 12, "#40a0b0", { aquatic: true, research: 1, government: "democracy" }, [0.3, 0.5, 0.7], ["Nerith", "Tidecaller", "Marisa"]),
];

export const RACE_BY_ID: Record<string, RaceDef> = Object.fromEntries(RACES.map((x) => [x.id, x]));

export function race(id: string): RaceDef {
  const d = RACE_BY_ID[id];
  if (!d) throw new Error(`unknown race ${id}`);
  return d;
}

export const EMPIRE_COLORS = ["#d03030", "#e0c020", "#30b040", "#a0a0a0", "#3060e0", "#c08030", "#a040c0", "#30c0c0"];
export const EMPIRE_COLOR_NAMES = ["Red", "Yellow", "Green", "Silver", "Blue", "Brown", "Purple", "Cyan"];
