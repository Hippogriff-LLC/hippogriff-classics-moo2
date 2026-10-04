// Ship hulls and components. Values are reconstructed approximations tuned for this engine's combat model
// (docs/research/RULES.md). They are not claimed to match the original tables exactly.

export interface HullDef {
  id: number;
  name: string;
  space: number;
  cost: number;
  structure: number; // base structure HP; armor HP = structure * armor multiplier
  defense: number; // beam defense size bonus
  command: number; // command points used
  tech: string | null;
  size: number; // tactical display scale
}

export const HULLS: HullDef[] = [
  { id: 0, name: "Frigate", space: 25, cost: 10, structure: 3, defense: 35, command: 1, tech: null, size: 1 },
  { id: 1, name: "Destroyer", space: 60, cost: 30, structure: 12, defense: 25, command: 2, tech: null, size: 1.2 },
  { id: 2, name: "Cruiser", space: 120, cost: 80, structure: 36, defense: 15, command: 3, tech: null, size: 1.45 },
  { id: 3, name: "Battleship", space: 250, cost: 200, structure: 100, defense: 5, command: 4, tech: null, size: 1.7 },
  { id: 4, name: "Titan", space: 500, cost: 500, structure: 300, defense: -5, command: 6, tech: "titan_construction", size: 2.1 },
  { id: 5, name: "Doom Star", space: 1200, cost: 1200, structure: 1000, defense: -15, command: 10, tech: "doom_star_construction", size: 2.6 },
];

export interface DriveDef {
  id: string;
  name: string;
  speed: number; // parsecs per turn
  combat: number; // tactical movement points
  tier: number;
}
export const DRIVES: DriveDef[] = [
  { id: "nuclear_drive", name: "Nuclear Drive", speed: 2, combat: 2, tier: 1 },
  { id: "fusion_drive", name: "Fusion Drive", speed: 3, combat: 3, tier: 2 },
  { id: "ion_drive", name: "Ion Drive", speed: 4, combat: 3, tier: 3 },
  { id: "anti_matter_drive", name: "Anti-Matter Drive", speed: 5, combat: 4, tier: 4 },
  { id: "hyper_drive", name: "Hyper Drive", speed: 6, combat: 4, tier: 5 },
  { id: "interphased_drive", name: "Interphased Drive", speed: 7, combat: 5, tier: 6 },
];

export interface ComputerDef {
  id: string;
  name: string;
  attack: number;
  costPerSpace: number;
  spaceFrac: number;
}
export const COMPUTERS: ComputerDef[] = [
  { id: "electronic_computer", name: "Electronic Computer", attack: 25, costPerSpace: 0.4, spaceFrac: 0.05 },
  { id: "optronic_computer", name: "Optronic Computer", attack: 50, costPerSpace: 0.5, spaceFrac: 0.05 },
  { id: "positronic_computer", name: "Positronic Computer", attack: 75, costPerSpace: 0.6, spaceFrac: 0.05 },
  { id: "cybertronic_computer", name: "Cybertronic Computer", attack: 100, costPerSpace: 0.7, spaceFrac: 0.05 },
  { id: "moleculartronic_computer", name: "Moleculartronic Computer", attack: 125, costPerSpace: 0.8, spaceFrac: 0.05 },
];

export interface ArmorDef {
  id: string;
  name: string;
  mult: number;
  costMult: number; // cost per hull structure point
}
export const ARMORS: ArmorDef[] = [
  { id: "titanium_armor", name: "Titanium", mult: 1, costMult: 0.3 },
  { id: "tritanium_armor", name: "Tritanium", mult: 2, costMult: 0.4 },
  { id: "zortrium_armor", name: "Zortrium", mult: 3, costMult: 0.5 },
  { id: "neutronium_armor", name: "Neutronium", mult: 5, costMult: 0.7 },
  { id: "adamantium_armor", name: "Adamantium", mult: 7, costMult: 0.9 },
  { id: "xentronium_armor", name: "Xentronium", mult: 10, costMult: 1.1 },
];

export interface ShieldDef {
  id: string;
  name: string;
  absorb: number;
  spaceFrac: number;
  costPerSpace: number;
}
export const SHIELDS: ShieldDef[] = [
  { id: "class_i_shield", name: "Class I", absorb: 1, spaceFrac: 0.05, costPerSpace: 0.5 },
  { id: "class_iii_shield", name: "Class III", absorb: 3, spaceFrac: 0.07, costPerSpace: 0.6 },
  { id: "class_v_shield", name: "Class V", absorb: 5, spaceFrac: 0.09, costPerSpace: 0.7 },
  { id: "class_vii_shield", name: "Class VII", absorb: 7, spaceFrac: 0.11, costPerSpace: 0.8 },
  { id: "class_x_shield", name: "Class X", absorb: 10, spaceFrac: 0.13, costPerSpace: 1.0 },
];

export type WeaponKind = "beam" | "missile" | "torpedo" | "bomb";

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  min: number;
  max: number;
  space: number;
  cost: number;
  range: number; // tactical squares
  ammo: number; // shots per battle (0 = unlimited)
}
export const WEAPONS: WeaponDef[] = [
  { id: "mass_driver", name: "Mass Driver", kind: "beam", min: 2, max: 5, space: 10, cost: 6, range: 6, ammo: 0 },
  { id: "laser_cannon", name: "Laser Cannon", kind: "beam", min: 1, max: 4, space: 8, cost: 5, range: 7, ammo: 0 },
  { id: "fusion_beam", name: "Fusion Beam", kind: "beam", min: 2, max: 6, space: 10, cost: 8, range: 7, ammo: 0 },
  { id: "ion_pulse_cannon", name: "Ion Pulse Cannon", kind: "beam", min: 3, max: 8, space: 12, cost: 10, range: 6, ammo: 0 },
  { id: "neutron_blaster", name: "Neutron Blaster", kind: "beam", min: 3, max: 12, space: 14, cost: 12, range: 7, ammo: 0 },
  { id: "graviton_beam", name: "Graviton Beam", kind: "beam", min: 1, max: 15, space: 15, cost: 14, range: 8, ammo: 0 },
  { id: "gauss_cannon", name: "Gauss Cannon", kind: "beam", min: 6, max: 16, space: 18, cost: 16, range: 7, ammo: 0 },
  { id: "phasor", name: "Phasor", kind: "beam", min: 5, max: 20, space: 18, cost: 18, range: 8, ammo: 0 },
  { id: "plasma_cannon", name: "Plasma Cannon", kind: "beam", min: 6, max: 30, space: 24, cost: 24, range: 8, ammo: 0 },
  { id: "disrupter_cannon", name: "Disrupter", kind: "beam", min: 10, max: 40, space: 30, cost: 30, range: 9, ammo: 0 },
  { id: "death_ray", name: "Death Ray", kind: "beam", min: 30, max: 50, space: 40, cost: 50, range: 9, ammo: 0 },
  { id: "mauler_device", name: "Mauler Device", kind: "beam", min: 20, max: 100, space: 60, cost: 70, range: 9, ammo: 0 },
  { id: "nuclear_missile", name: "Nuclear Missile", kind: "missile", min: 8, max: 8, space: 8, cost: 4, range: 12, ammo: 5 },
  { id: "merculite_missile", name: "Merculite Missile", kind: "missile", min: 12, max: 12, space: 9, cost: 6, range: 13, ammo: 5 },
  { id: "pulson_missile", name: "Pulson Missile", kind: "missile", min: 16, max: 16, space: 10, cost: 8, range: 14, ammo: 5 },
  { id: "zeon_missile", name: "Zeon Missile", kind: "missile", min: 24, max: 24, space: 11, cost: 10, range: 15, ammo: 5 },
  { id: "anti_matter_torpedo", name: "Anti-Matter Torpedo", kind: "torpedo", min: 30, max: 30, space: 25, cost: 20, range: 10, ammo: 0 },
  { id: "nuclear_bomb", name: "Nuclear Bomb", kind: "bomb", min: 3, max: 12, space: 10, cost: 5, range: 1, ammo: 0 },
  { id: "fusion_bomb", name: "Fusion Bomb", kind: "bomb", min: 4, max: 16, space: 10, cost: 7, range: 1, ammo: 0 },
  { id: "anti_matter_bomb", name: "Anti-Matter Bomb", kind: "bomb", min: 5, max: 20, space: 10, cost: 9, range: 1, ammo: 0 },
  { id: "neutronium_bomb", name: "Neutronium Bomb", kind: "bomb", min: 10, max: 40, space: 12, cost: 12, range: 1, ammo: 0 },
];

export interface SpecialDef {
  id: string;
  name: string;
  spaceFrac: number;
  costPerSpace: number;
  minSpace: number;
  desc: string;
}
export const SPECIALS: SpecialDef[] = [
  { id: "battle_scanner", name: "Battle Scanner", spaceFrac: 0.04, costPerSpace: 0.5, minSpace: 5, desc: "+50 beam attack" },
  { id: "ecm_jammer", name: "ECM Jammer", spaceFrac: 0.05, costPerSpace: 0.5, minSpace: 3, desc: "-30% missile hit chance against this ship" },
  { id: "multi_wave_ecm_jammer", name: "Multi-Wave ECM", spaceFrac: 0.06, costPerSpace: 0.6, minSpace: 4, desc: "-60% missile hit chance against this ship" },
  { id: "inertial_stabilizer", name: "Inertial Stabilizer", spaceFrac: 0.05, costPerSpace: 0.6, minSpace: 3, desc: "+25 beam defense, +1 combat speed" },
  { id: "inertial_nullifier", name: "Inertial Nullifier", spaceFrac: 0.06, costPerSpace: 0.8, minSpace: 4, desc: "+50 beam defense, +2 combat speed" },
  { id: "reinforced_hull", name: "Reinforced Hull", spaceFrac: 0.1, costPerSpace: 0.3, minSpace: 2, desc: "+50% structure" },
  { id: "heavy_armor", name: "Heavy Armor", spaceFrac: 0.1, costPerSpace: 0.4, minSpace: 2, desc: "+100% armor" },
  { id: "augmented_engines", name: "Augmented Engines", spaceFrac: 0.1, costPerSpace: 0.4, minSpace: 3, desc: "+1 galactic speed, +1 combat speed" },
  { id: "extended_fuel_tanks", name: "Extended Fuel Tanks", spaceFrac: 0.05, costPerSpace: 0.2, minSpace: 2, desc: "+50% range" },
  { id: "troop_pods", name: "Troop Pods", spaceFrac: 0.2, costPerSpace: 0.2, minSpace: 5, desc: "+2 marines per pod set for invasions" },
  { id: "automated_repair_unit", name: "Automated Repair", spaceFrac: 0.08, costPerSpace: 0.8, minSpace: 5, desc: "Repair 15% per combat round" },
  { id: "battle_pods", name: "Battle Pods", spaceFrac: 0, costPerSpace: 0, minSpace: 0, desc: "+50% hull space (+25% hull cost)" },
  { id: "high_energy_focus", name: "High Energy Focus", spaceFrac: 0.08, costPerSpace: 0.7, minSpace: 5, desc: "+50% beam damage" },
  { id: "achilles_targeting_unit", name: "Achilles Targeting", spaceFrac: 0.08, costPerSpace: 0.8, minSpace: 5, desc: "Beams ignore shields" },
  { id: "rangemaster_unit", name: "Rangemaster", spaceFrac: 0.06, costPerSpace: 0.6, minSpace: 4, desc: "No range penalty for beams" },
  { id: "cloaking_device", name: "Cloaking Device", spaceFrac: 0.1, costPerSpace: 0.8, minSpace: 6, desc: "+50 beam defense; first strike" },
  { id: "anti_missile_rockets", name: "Anti-Missile Rockets", spaceFrac: 0.06, costPerSpace: 0.4, minSpace: 3, desc: "Intercept 40% of incoming missiles" },
  { id: "shield_capacitors", name: "Shield Capacitors", spaceFrac: 0.06, costPerSpace: 0.6, minSpace: 4, desc: "+2 shield absorption" },
  { id: "structural_analyzer", name: "Structural Analyzer", spaceFrac: 0.08, costPerSpace: 0.8, minSpace: 5, desc: "+25% weapon damage" },
  { id: "advanced_damage_control", name: "Adv. Damage Control", spaceFrac: 0.08, costPerSpace: 0.6, minSpace: 4, desc: "Repair 10% per round" },
];

export const HULL_BY_ID = HULLS;
export const DRIVE_BY_ID: Record<string, DriveDef> = Object.fromEntries(DRIVES.map((d) => [d.id, d]));
export const COMPUTER_BY_ID: Record<string, ComputerDef> = Object.fromEntries(COMPUTERS.map((d) => [d.id, d]));
export const ARMOR_BY_ID: Record<string, ArmorDef> = Object.fromEntries(ARMORS.map((d) => [d.id, d]));
export const SHIELD_BY_ID: Record<string, ShieldDef> = Object.fromEntries(SHIELDS.map((d) => [d.id, d]));
export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((d) => [d.id, d]));
export const SPECIAL_BY_ID: Record<string, SpecialDef> = Object.fromEntries(SPECIALS.map((d) => [d.id, d]));

/** Non-combat role payloads. */
export const ROLE_COST: Record<string, number> = { colony: 110, outpost: 35, transport: 30, scout: 3 };
export const ROLE_NAME: Record<string, string> = { colony: "Colony Pod", outpost: "Outpost Pod", transport: "Troop Bay", scout: "Long-Range Scanner" };
export const TROOPS_PER_TRANSPORT = 4;
