// Core simulation state. Everything in GameState is plain JSON-serializable data so that
// persistence, determinism checks and replays are straightforward.

import type { RngState } from "./rng.ts";

export const STAR_COLORS = ["blue", "white", "yellow", "orange", "red", "brown"] as const;
export type StarColor = (typeof STAR_COLORS)[number] | "blackhole";

export const CLIMATES = ["Toxic", "Radiated", "Barren", "Desert", "Tundra", "Ocean", "Swamp", "Arid", "Terran", "Gaia"] as const;
export type Climate = number; // index into CLIMATES
export const PLANET_SIZES = ["Tiny", "Small", "Medium", "Large", "Huge"] as const;
export const MINERALS = ["Ultra Poor", "Poor", "Abundant", "Rich", "Ultra Rich"] as const;
export const GRAVITIES = ["Low-G", "Normal-G", "Heavy-G"] as const;
export const FIELDS = ["construction", "power", "chemistry", "sociology", "computers", "biology", "physics", "fields"] as const;
export type Field = (typeof FIELDS)[number];
export const GOVERNMENTS = ["feudal", "dictatorship", "democracy", "unification", "confederation", "imperium", "federation", "galactic_unification"] as const;
export type Government = (typeof GOVERNMENTS)[number];

export type PlanetKind = "habitable" | "asteroids" | "gasgiant";
export type PlanetSpecial = "none" | "gold" | "gems" | "artifacts" | "natives" | "ruins";

export interface Star {
  id: number;
  name: string;
  x: number; // parsecs
  y: number;
  color: StarColor;
  size: number; // 0 (large) .. 2 (small) visual size class
  planetIds: number[];
  special: "none" | "orion" | "homeworld";
  /** empire ids that have explored this system */
  exploredBy: number[];
  wormholeTo: number | null;
}

export interface Planet {
  id: number;
  starId: number;
  orbit: number; // 0..4
  kind: PlanetKind;
  size: number; // 0..4
  climate: Climate;
  minerals: number; // 0..4
  gravity: number; // 0..2
  special: PlanetSpecial;
  colonyId: number | null;
  /** turn of last terraform step, to throttle */
  terraformed: number;
}

export type BuildItem =
  | { kind: "building"; id: string }
  | { kind: "ship"; designId: number }
  | { kind: "spy" }
  | { kind: "freighters" }
  | { kind: "housing" }
  | { kind: "tradegoods" };

export interface Colony {
  id: number;
  planetId: number;
  starId: number;
  owner: number;
  raceId: string; // race of the colonists (conquest keeps the original population race)
  outpost: boolean;
  pop: number; // population units (millions)
  growth: number; // accumulated growth in thousands (0..999)
  farmers: number;
  workers: number;
  scientists: number;
  buildings: string[];
  queue: BuildItem[];
  progress: number; // production accumulated toward queue[0]
  founded: number;
  /** if true, the empire's automation allocates jobs and fills the queue */
  governor: boolean;
  /** turns of unrest/starvation tracking */
  starving: number;
  rebel: number;
}

export interface ShipDamage {
  structure: number; // remaining structure HP
  armor: number; // remaining armor HP
}

export interface Ship {
  id: number;
  designId: number;
  name: string;
  hp: ShipDamage;
  xp: number;
}

export type FleetOrder = "none" | "colonize" | "invade" | "patrol";

export interface Fleet {
  id: number;
  owner: number; // empire id, or MONSTER_OWNER
  x: number;
  y: number;
  starId: number | null; // at a star (null while in transit)
  destStarId: number | null;
  originStarId: number | null;
  ships: Ship[];
  order: FleetOrder;
  /** colonize/invade target planet */
  targetPlanetId: number | null;
  name: string;
}

export interface WeaponMount {
  weaponId: string;
  count: number;
}

export interface ShipDesign {
  id: number;
  owner: number;
  name: string;
  hull: number; // 0..5
  role: "combat" | "colony" | "outpost" | "transport" | "scout" | "monster";
  computer: string | null;
  armor: string;
  shield: string | null;
  drive: string;
  weapons: WeaponMount[];
  specials: string[];
  obsolete: boolean;
  imageIndex: number;
  /** monster-specific overrides */
  monster?: { name: string; structure: number; armor: number; shield: number; attack: number; defense: number };
}

/** "none" = in contact (or not) without any treaty: fleets coexist but either side may declare war. */
export type Treaty = "none" | "war" | "peace" | "nap" | "alliance";

export interface Relation {
  contact: boolean;
  treaty: Treaty;
  trade: boolean;
  research: boolean;
  attitude: number; // -100..100 (how the owner of this record feels about `other`)
  lastWarTurn: number;
  lastProposalTurn: number;
}

export interface ResearchState {
  /** chosen application within the next topic */
  targetTech: string | null;
  progress: number;
  topicsDone: string[]; // topic ids
  /** RP that overflowed from the last completion */
}

export interface Empire {
  id: number;
  name: string;
  leaderName: string;
  raceId: string;
  color: number; // 0..7 banner colour
  human: boolean;
  alive: boolean;
  bc: number;
  taxRate: number; // 0..50 step 10
  government: Government;
  research: ResearchState;
  techs: string[];
  freighters: number;
  spies: number;
  /** spies with a target run missions; without one they defend at home */
  espionage: { target: number | null; mode: "steal" | "sabotage" };
  relations: Record<number, Relation>;
  homeColonyId: number | null;
  capitalStarId: number;
  /** sticky AI parameters */
  ai: { aggression: number; expansion: number; science: number; lastWarCheck: number; targetEmpire: number | null };
  stats: { lastFood: number; lastIndustry: number; lastResearch: number; lastIncome: number; commandUsed: number; commandMax: number };
  /** best-known race-trait bonuses captured for convenience */
  eliminatedTurn: number | null;
}

export interface GameMessage {
  turn: number;
  empire: number; // recipient
  kind: "info" | "research" | "production" | "combat" | "diplomacy" | "event" | "colony" | "warning";
  text: string;
  starId?: number;
  colonyId?: number;
}

export interface DiplomaticProposal {
  id: number;
  from: number;
  to: number;
  kind: "peace" | "nap" | "alliance" | "trade" | "research" | "tribute";
  amount?: number;
  turn: number;
}

export interface PendingBattle {
  id: number;
  starId: number;
  attacker: number; // empire id (or MONSTER_OWNER)
  defender: number;
  attackerFleetIds: number[];
  defenderFleetIds: number[];
  defenderColonyId: number | null;
}

export interface BattleReport {
  turn: number;
  starId: number;
  attacker: number;
  defender: number;
  winner: number | null;
  attackerLosses: number;
  defenderLosses: number;
  rounds: number;
}

export interface GameSettings {
  galaxySize: "small" | "medium" | "large" | "huge";
  galaxyAge: "young" | "average" | "old";
  opponents: number; // 1..7
  difficulty: "tutor" | "easy" | "average" | "hard" | "impossible";
  playerRace: string;
  playerName: string;
  playerColor: number;
  events: boolean;
  antarans: boolean;
}

export type TurnPhase = "orders" | "battles";

export interface CouncilState {
  nextTurn: number;
  lastResult: string | null;
  /** set when an AI has been elected and the human must accept or defy */
  pendingDecision: { winner: number } | null;
}

export interface GameState {
  schema: 1;
  id: string;
  seed: number;
  rng: RngState;
  turn: number;
  phase: TurnPhase;
  settings: GameSettings;
  width: number;
  height: number;
  stars: Star[];
  planets: Planet[];
  colonies: Record<number, Colony>;
  fleets: Record<number, Fleet>;
  designs: ShipDesign[];
  empires: Empire[];
  nextId: { colony: number; fleet: number; ship: number; proposal: number; battle: number };
  messages: GameMessage[];
  proposals: DiplomaticProposal[];
  pendingBattles: PendingBattle[];
  battleReports: BattleReport[];
  council: CouncilState;
  winner: { empire: number; kind: "conquest" | "council" | "defeat" } | null;
  /** human-visible names imported from original data, if any were used */
  nameSource: "builtin" | "imported";
}

export const MONSTER_OWNER = -1;
