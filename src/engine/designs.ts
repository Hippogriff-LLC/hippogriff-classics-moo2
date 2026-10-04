// Ship design statistics, costs, validation and automatic design.

import type { Empire, GameState, ShipDesign, WeaponMount } from "./types.ts";
import { ARMORS, ARMOR_BY_ID, COMPUTERS, COMPUTER_BY_ID, DRIVES, DRIVE_BY_ID, HULLS, ROLE_COST, SHIELDS, SHIELD_BY_ID, SPECIALS, SPECIAL_BY_ID, TROOPS_PER_TRANSPORT, WEAPONS, WEAPON_BY_ID } from "./data/ships.ts";
import type { WeaponDef } from "./data/ships.ts";
import { race } from "./data/races.ts";
import { governmentMods } from "./economy.ts";
import { hasTech } from "./state.ts";

export interface DesignStats {
  space: number;
  spaceUsed: number;
  cost: number;
  attack: number;
  defense: number;
  structure: number;
  armor: number;
  shield: number;
  speed: number;
  combatSpeed: number;
  missileEvade: number;
  antiMissile: number;
  troops: number;
  beamDamageMult: number;
  ignoreShields: boolean;
  noRangePenalty: boolean;
  repair: number;
  rangeMult: number;
  armed: boolean;
  firepower: number; // rough average damage per round for AI strength estimates
}

export function hullSpace(d: ShipDesign): number {
  const h = HULLS[d.hull];
  return Math.floor(h.space * (d.specials.includes("battle_pods") ? 1.5 : 1));
}

export function specialSpace(id: string, space: number): number {
  const sp = SPECIAL_BY_ID[id];
  if (!sp) return 0;
  return Math.max(sp.minSpace, Math.ceil(sp.spaceFrac * space));
}

export function designStats(d: ShipDesign, owner: Empire | null): DesignStats {
  const h = HULLS[d.hull];
  const space = hullSpace(d);
  const traits = owner ? race(owner.raceId).traits : null;
  let used = 0;
  let cost = h.cost * (d.specials.includes("battle_pods") ? 1.25 : 1);
  const drive = DRIVE_BY_ID[d.drive] ?? DRIVES[0];
  cost += h.space * 0.05 * drive.tier;
  let attack = 0;
  if (d.computer) {
    const c = COMPUTER_BY_ID[d.computer];
    const sp = Math.ceil(c.spaceFrac * space);
    used += sp;
    cost += sp * c.costPerSpace;
    attack += c.attack;
  }
  let shield = 0;
  if (d.shield) {
    const sh = SHIELD_BY_ID[d.shield];
    const sp = Math.ceil(sh.spaceFrac * space);
    used += sp;
    cost += sp * sh.costPerSpace;
    shield += sh.absorb;
  }
  const ar = ARMOR_BY_ID[d.armor] ?? ARMORS[0];
  let structure = h.structure;
  let armor = h.structure * ar.mult;
  cost += h.structure * ar.costMult;
  let firepower = 0;
  for (const w of d.weapons) {
    const wd = WEAPON_BY_ID[w.weaponId];
    if (!wd) continue;
    used += wd.space * w.count;
    cost += wd.cost * w.count;
    firepower += ((wd.min + wd.max) / 2) * w.count * (wd.kind === "missile" ? 0.7 : 1);
  }
  let defense = h.defense + drive.tier * 5;
  let combatSpeed = drive.combat;
  let speed = drive.speed;
  let missileEvade = 0;
  let antiMissile = 0;
  let beamDamageMult = 1;
  let ignoreShields = false;
  let noRangePenalty = false;
  let repair = 0;
  let rangeMult = 1;
  let troops = 0;
  for (const s of d.specials) {
    const sp = SPECIAL_BY_ID[s];
    if (!sp) continue;
    const spc = s === "battle_pods" ? 0 : specialSpace(s, space);
    used += spc;
    cost += spc * sp.costPerSpace;
    switch (s) {
      case "battle_scanner":
        attack += 50;
        break;
      case "ecm_jammer":
        missileEvade = Math.max(missileEvade, 30);
        break;
      case "multi_wave_ecm_jammer":
        missileEvade = Math.max(missileEvade, 60);
        break;
      case "inertial_stabilizer":
        defense += 25;
        combatSpeed += 1;
        break;
      case "inertial_nullifier":
        defense += 50;
        combatSpeed += 2;
        break;
      case "reinforced_hull":
        structure = Math.round(structure * 1.5);
        break;
      case "heavy_armor":
        armor *= 2;
        break;
      case "augmented_engines":
        speed += 1;
        combatSpeed += 1;
        break;
      case "extended_fuel_tanks":
        rangeMult = 1.5;
        break;
      case "troop_pods":
        troops += 2 * (1 + d.hull);
        break;
      case "automated_repair_unit":
        repair = Math.max(repair, 0.15);
        break;
      case "advanced_damage_control":
        repair = Math.max(repair, 0.1);
        break;
      case "high_energy_focus":
        beamDamageMult += 0.5;
        break;
      case "structural_analyzer":
        beamDamageMult += 0.25;
        break;
      case "achilles_targeting_unit":
        ignoreShields = true;
        break;
      case "rangemaster_unit":
        noRangePenalty = true;
        break;
      case "cloaking_device":
        defense += 50;
        break;
      case "anti_missile_rockets":
        antiMissile = 40;
        break;
      case "shield_capacitors":
        if (shield > 0) shield += 2;
        break;
    }
  }
  if (d.role !== "combat" && d.role !== "monster") {
    cost += ROLE_COST[d.role] ?? 0;
    if (d.role === "transport") troops += TROOPS_PER_TRANSPORT;
  }
  if (traits) {
    attack += traits.shipAttack;
    defense += traits.shipDefense;
  }
  if (owner) cost *= governmentMods(owner.government).shipCost;
  if (d.monster) {
    structure = d.monster.structure;
    armor = d.monster.armor;
    shield = d.monster.shield;
    attack = d.monster.attack;
    defense = d.monster.defense;
  }
  return {
    space,
    spaceUsed: used,
    cost: Math.max(1, Math.round(cost)),
    attack,
    defense,
    structure,
    armor,
    shield,
    speed,
    combatSpeed,
    missileEvade,
    antiMissile,
    troops,
    beamDamageMult,
    ignoreShields,
    noRangePenalty,
    repair,
    rangeMult,
    armed: d.weapons.some((w) => w.count > 0),
    firepower: firepower * beamDamageMult,
  };
}

export function validateDesign(d: ShipDesign, owner: Empire): string[] {
  const errs: string[] = [];
  const h = HULLS[d.hull];
  if (!h) return ["invalid hull"];
  if (h.tech && !hasTech(owner, h.tech)) errs.push(`${h.name} hull not researched`);
  const req = (id: string | null, what: string) => {
    if (id && !hasTech(owner, id)) errs.push(`${what} not researched`);
  };
  req(d.computer, "computer");
  req(d.shield, "shield");
  req(d.armor, "armor");
  req(d.drive, "drive");
  for (const w of d.weapons) {
    req(w.weaponId, WEAPON_BY_ID[w.weaponId]?.name ?? w.weaponId);
    if (w.count < 0 || !Number.isInteger(w.count)) errs.push("invalid weapon count");
  }
  for (const s of d.specials) req(s, SPECIAL_BY_ID[s]?.name ?? s);
  if (new Set(d.specials).size !== d.specials.length) errs.push("duplicate special");
  const st = designStats(d, owner);
  if (st.spaceUsed > st.space) errs.push(`over capacity (${st.spaceUsed}/${st.space})`);
  if (!d.name.trim()) errs.push("name required");
  return errs;
}

function best<T extends { id: string }>(list: T[], e: Empire): T | null {
  let r: T | null = null;
  for (const x of list) if (hasTech(e, x.id)) r = x;
  return r;
}

export function bestDrive(e: Empire): string {
  return best(DRIVES, e)?.id ?? DRIVES[0].id;
}
export function bestComputer(e: Empire): string | null {
  return best(COMPUTERS, e)?.id ?? null;
}
export function bestArmor(e: Empire): string {
  return best(ARMORS, e)?.id ?? ARMORS[0].id;
}
export function bestShield(e: Empire): string | null {
  return best(SHIELDS, e)?.id ?? null;
}
export function bestBeam(e: Empire): WeaponDef | null {
  let r: WeaponDef | null = null;
  for (const w of WEAPONS) if (w.kind === "beam" && hasTech(e, w.id) && (!r || w.max + w.min > r.max + r.min)) r = w;
  return r;
}
export function bestMissile(e: Empire): WeaponDef | null {
  let r: WeaponDef | null = null;
  for (const w of WEAPONS) if ((w.kind === "missile" || w.kind === "torpedo") && hasTech(e, w.id) && (!r || w.max > r.max)) r = w;
  return r;
}
export function bestBomb(e: Empire): WeaponDef | null {
  let r: WeaponDef | null = null;
  for (const w of WEAPONS) if (w.kind === "bomb" && hasTech(e, w.id) && (!r || w.max > r.max)) r = w;
  return r;
}
export function availableHulls(e: Empire): number[] {
  return HULLS.filter((h) => !h.tech || hasTech(e, h.tech)).map((h) => h.id);
}

export function blankDesign(e: Empire, hull: number, role: ShipDesign["role"], name: string): ShipDesign {
  return {
    id: -1,
    owner: e.id,
    name,
    hull,
    role,
    computer: role === "combat" ? bestComputer(e) : null,
    armor: bestArmor(e),
    shield: role === "combat" ? bestShield(e) : null,
    drive: bestDrive(e),
    weapons: [],
    specials: [],
    obsolete: false,
    imageIndex: hull * 8,
  };
}

/** Automatic warship design: best systems, a useful special if room, then fill with weapons. */
export function autoDesign(e: Empire, hull: number, name: string, style: "beam" | "missile" | "mixed" = "mixed", bomber = false): ShipDesign {
  const d = blankDesign(e, hull, "combat", name);
  const space = () => designStats(d, e).space - designStats(d, e).spaceUsed;
  const wantSpecials = ["battle_scanner", "inertial_stabilizer", "high_energy_focus", "automated_repair_unit", "ecm_jammer", "reinforced_hull"];
  if (hull >= 1) {
    for (const s of wantSpecials) {
      if (!hasTech(e, s)) continue;
      if (d.specials.length >= Math.min(3, hull)) break;
      d.specials.push(s);
      if (space() < 0) d.specials.pop();
    }
  }
  const beam = bestBeam(e);
  const missile = bestMissile(e);
  const bomb = bomber ? bestBomb(e) : null;
  const mounts: WeaponMount[] = [];
  if (bomb) {
    const n = Math.max(1, Math.floor((space() * 0.3) / bomb.space));
    mounts.push({ weaponId: bomb.id, count: n });
    d.weapons = mounts;
  }
  if (missile && (style === "missile" || (style === "mixed" && hull >= 1))) {
    const share = style === "missile" ? 1 : 0.3;
    const n = Math.floor((space() * share) / missile.space);
    if (n > 0) mounts.push({ weaponId: missile.id, count: n });
    d.weapons = mounts;
  }
  if (beam) {
    const n = Math.floor(space() / beam.space);
    if (n > 0) mounts.push({ weaponId: beam.id, count: n });
    d.weapons = mounts;
  }
  if (!mounts.length && missile) {
    mounts.push({ weaponId: missile.id, count: Math.max(1, Math.floor(space() / missile.space)) });
  }
  d.weapons = mounts.filter((m) => m.count > 0);
  while (designStats(d, e).spaceUsed > designStats(d, e).space && d.weapons.length) {
    const last = d.weapons[d.weapons.length - 1];
    last.count -= 1;
    if (last.count <= 0) d.weapons.pop();
  }
  d.imageIndex = Math.min(5, hull) * 8 + (name.length % 8);
  return d;
}

export function addDesign(s: GameState, d: ShipDesign): ShipDesign {
  const nd: ShipDesign = { ...d, id: s.designs.length, weapons: d.weapons.map((w) => ({ ...w })), specials: [...d.specials] };
  s.designs.push(nd);
  return nd;
}

export function designsOf(s: GameState, e: Empire, includeObsolete = false): ShipDesign[] {
  return s.designs.filter((d) => d.owner === e.id && (includeObsolete || !d.obsolete));
}

export function initialDesigns(s: GameState, e: Empire): void {
  const mk = (hull: number, role: ShipDesign["role"], name: string, img: number): void => {
    const d = blankDesign(e, hull, role, name);
    d.imageIndex = img;
    if (role === "scout") d.specials = [];
    addDesign(s, d);
  };
  mk(0, "scout", "Scout", 0);
  mk(1, "colony", "Colony Ship", 18);
  mk(0, "outpost", "Outpost Ship", 10);
  mk(1, "transport", "Transport", 12);
  addDesign(s, autoDesign(e, 0, "Frigate", "beam"));
  addDesign(s, autoDesign(e, 1, "Destroyer", "mixed"));
}

/** Combat strength estimate used by the AI and auto-resolve previews. */
export function shipStrength(d: ShipDesign, owner: Empire | null): number {
  const st = designStats(d, owner);
  if (!st.armed) return 0;
  const durability = st.structure + st.armor + st.shield * 4;
  const offense = st.firepower * (1 + st.attack / 100);
  return Math.sqrt(Math.max(1, durability) * Math.max(0.1, offense)) * (1 + st.defense / 200);
}
