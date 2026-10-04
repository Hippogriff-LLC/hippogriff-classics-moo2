// Technology tree: eight research fields, each a sequence of topics; completing a topic grants one
// chosen application (all of them for "creative" races, as in the original's documented behaviour).
// Topic ordering and costs are reconstructed approximations (docs/research/RULES.md): fields are modelled as
// linear chains, whereas the original has some cross-field prerequisites.

import type { Field } from "../types.ts";

export interface Topic {
  id: string;
  field: Field;
  level: number;
  name: string;
  cost: number;
  apps: string[];
}

const COST = [0, 50, 150, 250, 400, 600, 900, 1300, 1800, 2400, 3200, 4200, 5500, 7000, 9000];

function chain(field: Field, topics: [string, string[]][]): Topic[] {
  return topics.map(([name, apps], level) => ({
    id: `${field}:${level}`,
    field,
    level,
    name,
    cost: COST[level] ?? 12000,
    apps,
  }));
}

export const TOPICS: Topic[] = [
  ...chain("construction", [
    ["Engineering", ["colony_base", "star_base", "marine_barracks"]],
    ["Advanced Engineering", ["anti_missile_rockets", "fighter_bays", "reinforced_hull"]],
    ["Advanced Construction", ["automated_factory", "missile_base", "heavy_armor"]],
    ["Capsule Construction", ["battle_pods", "troop_pods", "survival_pods"]],
    ["Astro Engineering", ["space_port", "armor_barracks", "fighter_garrison"]],
    ["Robotics", ["robo_miner_plant", "battlestation", "powered_armor"]],
    ["Servo Mechanics", ["fast_missile_racks", "advanced_damage_control", "assault_shuttles"]],
    ["Astro Construction", ["titan_construction", "ground_batteries", "battleoids"]],
    ["Advanced Manufacturing", ["recyclotron", "automated_repair_unit", "artificial_planet"]],
    ["Advanced Robotics", ["robotic_factory", "bomber_bays"]],
    ["Tectonic Engineering", ["deep_core_mine", "core_waste_dump"]],
    ["Superscalar Construction", ["star_fortress", "advanced_city_planning", "heavy_fighter_bays"]],
    ["Planetoid Construction", ["doom_star_construction", "artemis_system_net"]],
  ]),
  ...chain("power", [
    ["Nuclear Fission", ["freighters", "colony_ship", "outpost_ship", "nuclear_drive", "transport"]],
    ["Cold Fusion", ["fusion_drive", "fusion_bomb"]],
    ["Advanced Fusion", ["augmented_engines", "deuterium_fuel_cells"]],
    ["Ion Fission", ["ion_drive", "ion_pulse_cannon", "shield_capacitors"]],
    ["Anti-Matter Fission", ["anti_matter_drive", "anti_matter_torpedo", "anti_matter_bomb"]],
    ["Matter-Energy Conversion", ["food_replicators", "transporters"]],
    ["High Energy Distribution", ["high_energy_focus", "energy_absorber", "megafluxers"]],
    ["Hyper-Dimensional Fission", ["hyper_drive", "hyper_x_capacitors", "quantum_detonator"]],
    ["Interphased Fission", ["interphased_drive", "neutronium_bomb", "death_ray"]],
  ]),
  ...chain("chemistry", [
    ["Chemistry", ["nuclear_missile", "standard_fuel_cells", "titanium_armor", "extended_fuel_tanks"]],
    ["Advanced Metallurgy", ["tritanium_armor", "nuclear_bomb"]],
    ["Advanced Chemistry", ["merculite_missile", "pollution_processor"]],
    ["Molecular Manipulation", ["zortrium_armor", "iridium_fuel_cells"]],
    ["Nano Technology", ["pulson_missile", "atmospheric_renewer", "microlite_construction"]],
    ["Molecular Compression", ["neutronium_armor", "uridium_fuel_cells"]],
    ["Molecular Control", ["adamantium_armor", "thorium_fuel_cells", "zeon_missile"]],
    ["Artificial Matter", ["xentronium_armor", "nano_disassemblers"]],
  ]),
  ...chain("sociology", [
    ["Basic Sociology", []],
    ["Military Tactics", ["space_academy"]],
    ["Xeno Relations", ["xeno_psychology", "alien_management_center"]],
    ["Macro Economics", ["planetary_stock_exchange"]],
    ["Teaching Methods", ["astro_university"]],
    ["Advanced Governments", ["government_advance"]],
    ["Galactic Economics", ["galactic_currency_exchange"]],
    ["Galactic Unification", ["galactic_unification"]],
  ]),
  ...chain("computers", [
    ["Electronics", ["electronic_computer"]],
    ["Optronics", ["research_laboratory", "optronic_computer", "dauntless_guidance_system"]],
    ["Artificial Intelligence", ["neural_scanner", "scout_lab", "security_stations"]],
    ["Positronics", ["positronic_computer", "planetary_supercomputer", "holo_simulator"]],
    ["Artificial Consciousness", ["emissions_guidance_system", "rangemaster_unit", "cyber_security_link"]],
    ["Galactic Networking", ["virtual_reality_network", "galactic_cybernet"]],
    ["Cybertronics", ["cybertronic_computer", "autolab", "structural_analyzer"]],
    ["Moleculatronics", ["moleculartronic_computer", "pleasure_dome", "achilles_targeting_unit"]],
  ]),
  ...chain("biology", [
    ["Biology", ["hydroponic_farm"]],
    ["Astro Biology", ["biospheres", "soil_enrichment"]],
    ["Advanced Biology", ["cloning_center", "universal_antidote"]],
    ["Genetic Engineering", ["death_spores", "telepathic_training"]],
    ["Genetic Mutations", ["microbiotics", "terraforming"]],
    ["Macro Genetics", ["subterranean_farms", "weather_control_system"]],
    ["Evolutionary Genetics", ["evolutionary_mutation", "heightened_intelligence"]],
    ["Artificial Life", ["bio_terminator", "gaia_transformation"]],
    ["Trans Genetics", ["biomorphic_fungi"]],
  ]),
  ...chain("physics", [
    ["Physics", ["laser_cannon", "laser_rifle", "space_scanner"]],
    ["Fusion Physics", ["fusion_beam", "fusion_rifle"]],
    ["Tachyon Physics", ["tachyon_communications", "tachyon_scanner", "battle_scanner"]],
    ["Neutrino Physics", ["neutron_blaster", "neutron_scanner"]],
    ["Artificial Gravity", ["tractor_beam", "graviton_beam", "planetary_gravity_generator"]],
    ["Subspace Physics", ["subspace_communications", "jump_gate"]],
    ["Multi-Phased Physics", ["phasor", "phasor_rifle", "multi_phased_shields"]],
    ["Plasma Physics", ["plasma_cannon", "plasma_rifle", "plasma_web"]],
    ["Multi-Dimensional Physics", ["disrupter_cannon", "dimensional_portal"]],
    ["Hyper-Dimensional Physics", ["hyperspace_communications", "sensors", "mauler_device"]],
    ["Temporal Physics", ["time_warp_facilitator", "stellar_converter", "star_gate"]],
  ]),
  ...chain("fields", [
    ["Advanced Magnetism", ["class_i_shield", "mass_driver", "ecm_jammer"]],
    ["Gravitic Fields", ["anti_grav_harness", "inertial_stabilizer", "gyro_destabilizer"]],
    ["Magneto Gravitics", ["class_iii_shield", "planetary_radiation_shield", "warp_dissipater"]],
    ["Electromagnetic Refraction", ["stealth_field", "personal_shield", "stealth_suit"]],
    ["Warp Fields", ["pulsar", "warp_interdictor", "lightning_field"]],
    ["Subspace Fields", ["class_v_shield", "multi_wave_ecm_jammer", "gauss_cannon"]],
    ["Distortion Fields", ["cloaking_device", "stasis_field", "hard_shields"]],
    ["Quantum Fields", ["class_vii_shield", "planetary_flux_shield"]],
    ["Transwarp Fields", ["displacement_device", "subspace_teleporter", "inertial_nullifier"]],
    ["Temporal Fields", ["class_x_shield", "planetary_barrier_shield", "phasing_cloak"]],
  ]),
];

export const TOPIC_BY_ID: Record<string, Topic> = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
export const TOPIC_OF_APP: Record<string, Topic> = {};
for (const t of TOPICS) for (const a of t.apps) TOPIC_OF_APP[a] = t;

export const FIELD_NAMES: Record<Field, string> = {
  construction: "Construction",
  power: "Power",
  chemistry: "Chemistry",
  sociology: "Sociology",
  computers: "Computers",
  biology: "Biology",
  physics: "Physics",
  fields: "Force Fields",
};

/** Display names for applications; auto-derived from ids where not overridden. */
const NAME_OVERRIDES: Record<string, string> = {
  class_i_shield: "Class I Shield",
  class_iii_shield: "Class III Shield",
  class_v_shield: "Class V Shield",
  class_vii_shield: "Class VII Shield",
  class_x_shield: "Class X Shield",
  ecm_jammer: "ECM Jammer",
  multi_wave_ecm_jammer: "Multi-Wave ECM Jammer",
  government_advance: "Advanced Government Form",
  hyper_x_capacitors: "Hyper-X Capacitors",
  anti_grav_harness: "Anti-Grav Harness",
  anti_matter_torpedo: "Anti-Matter Torpedoes",
  robo_miner_plant: "Robo-Miner Plant",
  multi_phased_shields: "Multi-Phased Shields",
};

export function techName(id: string): string {
  if (NAME_OVERRIDES[id]) return NAME_OVERRIDES[id];
  return id
    .split("_")
    .map((w) => (w.length <= 2 && w !== "of" ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Short functional summaries (project-authored). */
export const TECH_SUMMARY: Record<string, string> = {
  colony_base: "Build a colony base to settle another planet in the same system.",
  star_base: "Orbital defence station; +2 command points.",
  marine_barracks: "Garrison marines; removes dictatorship morale penalty.",
  automated_factory: "+1 industry per worker, +5 flat.",
  missile_base: "Planetary missile battery for system defence.",
  space_port: "+50% BC from taxes at this colony.",
  robo_miner_plant: "+2 industry per worker, +10 flat; adds pollution.",
  battlestation: "Upgraded orbital station; +3 command points.",
  ground_batteries: "Planetary beam batteries.",
  recyclotron: "+1 industry per colonist.",
  robotic_factory: "+5/+10/+15/+20/+25 industry by mineral richness.",
  deep_core_mine: "+3 industry per worker, +15 flat.",
  star_fortress: "Fortress-class orbital station; +4 command points.",
  freighters: "Freighter fleets move food between colonies.",
  colony_ship: "Settle habitable planets.",
  outpost_ship: "Claim asteroids, gas giants and hostile worlds.",
  transport: "Troop transports for planetary invasion.",
  hydroponic_farm: "+2 food at this colony.",
  biospheres: "+2 maximum population.",
  soil_enrichment: "+1 food per farmer on non-hostile worlds.",
  cloning_center: "+100k population growth per turn.",
  microbiotics: "+25% population growth everywhere; +1 maximum population.",
  terraforming: "Terraform a planet one climate step toward Terran.",
  subterranean_farms: "+2 food per colony (no farmers needed).",
  weather_control_system: "+2 food at this colony.",
  gaia_transformation: "Turn Terran worlds into Gaia.",
  research_laboratory: "+1 research per scientist, +5 flat.",
  planetary_supercomputer: "+2 research per scientist, +10 flat.",
  autolab: "+30 research flat.",
  galactic_cybernet: "+3 research per scientist, +15 flat.",
  holo_simulator: "+20% morale.",
  pleasure_dome: "+30% morale.",
  planetary_stock_exchange: "+1 BC per worker.",
  galactic_currency_exchange: "+50% treasury income.",
  space_academy: "Ships built here gain experience.",
  alien_management_center: "+20% morale for conquered populations.",
  astro_university: "+1 research per scientist, +1 food per farmer, +1 industry per worker.",
  pollution_processor: "Halves pollution at this colony.",
  atmospheric_renewer: "Removes most pollution at this colony.",
  core_waste_dump: "Eliminates pollution at this colony.",
  advanced_city_planning: "+5 maximum population.",
  government_advance: "Unlocks the improved form of your government.",
  galactic_unification: "Final government form: large bonuses to all output.",
  food_replicators: "Spare industry turns into food (2 PP per food).",
  space_scanner: "Detect fleets in a wider radius.",
  tachyon_scanner: "Detect fleets in a wider radius.",
  neutron_scanner: "Detect fleets in a wider radius.",
  tachyon_communications: "+2 command points.",
  subspace_communications: "+2 command points.",
  hyperspace_communications: "+2 command points.",
  standard_fuel_cells: "Ship range 4 parsecs beyond your colonies.",
  deuterium_fuel_cells: "Ship range 6 parsecs.",
  iridium_fuel_cells: "Ship range 8 parsecs.",
  uridium_fuel_cells: "Ship range 11 parsecs.",
  thorium_fuel_cells: "Unlimited ship range.",
  universal_antidote: "+5 ground combat; prevents plague events.",
  telepathic_training: "+5 ground combat; +10% morale.",
  powered_armor: "+10 ground combat for troops.",
  personal_shield: "+10 ground combat for troops.",
  laser_rifle: "+5 ground combat for troops.",
  fusion_rifle: "+10 ground combat for troops.",
  phasor_rifle: "+15 ground combat for troops.",
  plasma_rifle: "+20 ground combat for troops.",
  armor_barracks: "+4 garrison troops.",
  planetary_radiation_shield: "Planetary shield 5.",
  planetary_flux_shield: "Planetary shield 10.",
  planetary_barrier_shield: "Planetary shield 20.",
  security_stations: "+10 counter-espionage.",
  neural_scanner: "+10 espionage.",
  cyber_security_link: "+10 counter-espionage.",
  stealth_suit: "+10 espionage.",
  extended_fuel_tanks: "Ship special: +50% range.",
};

export const START_TECHS: string[] = TOPICS.filter((t) => t.level === 0).flatMap((t) => t.apps);
export const START_TOPICS: string[] = TOPICS.filter((t) => t.level === 0).map((t) => t.id);
