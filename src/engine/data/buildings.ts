// Colony buildings. Costs/upkeep are reconstructed approximations (docs/research/RULES.md).

export interface BuildingDef {
  id: string; // also the tech application id that unlocks it (unless `tech` given)
  name: string;
  cost: number;
  upkeep: number; // BC per turn
  tech: string | null; // null = always available
  /** additive per-colony effects; interpreted in economy.ts */
  food?: number;
  foodPerFarmer?: number;
  industry?: number;
  industryPerWorker?: number;
  research?: number;
  researchPerScientist?: number;
  maxPop?: number;
  morale?: number;
  growthK?: number;
  taxMult?: number;
  bcPerWorker?: number;
  pollutionMult?: number;
  command?: number;
  troops?: number;
  defense?: "missile" | "beam" | "station";
  station?: number; // station tier 1..3
  planetShield?: number;
  outpostOk?: boolean;
  unique?: "empire";
}

export const BUILDINGS: BuildingDef[] = [
  { id: "marine_barracks", name: "Marine Barracks", cost: 60, upkeep: 1, tech: "marine_barracks", troops: 4 },
  { id: "star_base", name: "Star Base", cost: 120, upkeep: 1, tech: "star_base", command: 2, defense: "station", station: 1, outpostOk: true },
  { id: "battlestation", name: "Battlestation", cost: 250, upkeep: 2, tech: "battlestation", command: 3, defense: "station", station: 2, outpostOk: true },
  { id: "star_fortress", name: "Star Fortress", cost: 500, upkeep: 3, tech: "star_fortress", command: 4, defense: "station", station: 3, outpostOk: true },
  { id: "automated_factory", name: "Automated Factory", cost: 60, upkeep: 1, tech: "automated_factory", industry: 5, industryPerWorker: 1 },
  { id: "missile_base", name: "Missile Base", cost: 120, upkeep: 2, tech: "missile_base", defense: "missile", outpostOk: true },
  { id: "space_port", name: "Space Port", cost: 80, upkeep: 1, tech: "space_port", taxMult: 0.5 },
  { id: "armor_barracks", name: "Armor Barracks", cost: 150, upkeep: 2, tech: "armor_barracks", troops: 4 },
  { id: "fighter_garrison", name: "Fighter Garrison", cost: 150, upkeep: 2, tech: "fighter_garrison", defense: "beam" },
  { id: "robo_miner_plant", name: "Robo-Miner Plant", cost: 150, upkeep: 2, tech: "robo_miner_plant", industry: 10, industryPerWorker: 2 },
  { id: "ground_batteries", name: "Ground Batteries", cost: 200, upkeep: 2, tech: "ground_batteries", defense: "beam", outpostOk: true },
  { id: "recyclotron", name: "Recyclotron", cost: 200, upkeep: 3, tech: "recyclotron" },
  { id: "robotic_factory", name: "Robotic Factory", cost: 200, upkeep: 3, tech: "robotic_factory" },
  { id: "deep_core_mine", name: "Deep Core Mine", cost: 250, upkeep: 3, tech: "deep_core_mine", industry: 15, industryPerWorker: 3 },
  { id: "core_waste_dump", name: "Core Waste Dump", cost: 200, upkeep: 4, tech: "core_waste_dump", pollutionMult: 0 },
  { id: "advanced_city_planning", name: "Advanced City Planning", cost: 200, upkeep: 2, tech: "advanced_city_planning", maxPop: 5 },
  { id: "artemis_system_net", name: "Artemis System Net", cost: 300, upkeep: 4, tech: "artemis_system_net", defense: "missile", outpostOk: true },
  { id: "pollution_processor", name: "Pollution Processor", cost: 80, upkeep: 1, tech: "pollution_processor", pollutionMult: 0.5 },
  { id: "atmospheric_renewer", name: "Atmospheric Renewer", cost: 150, upkeep: 3, tech: "atmospheric_renewer", pollutionMult: 0.25 },
  { id: "space_academy", name: "Space Academy", cost: 100, upkeep: 2, tech: "space_academy" },
  { id: "alien_management_center", name: "Alien Management Center", cost: 200, upkeep: 3, tech: "alien_management_center", morale: 20 },
  { id: "planetary_stock_exchange", name: "Planetary Stock Exchange", cost: 150, upkeep: 0, tech: "planetary_stock_exchange", bcPerWorker: 1 },
  { id: "astro_university", name: "Astro University", cost: 200, upkeep: 3, tech: "astro_university", researchPerScientist: 1, foodPerFarmer: 1, industryPerWorker: 1 },
  { id: "research_laboratory", name: "Research Laboratory", cost: 60, upkeep: 1, tech: "research_laboratory", research: 5, researchPerScientist: 1 },
  { id: "planetary_supercomputer", name: "Planetary Supercomputer", cost: 150, upkeep: 2, tech: "planetary_supercomputer", research: 10, researchPerScientist: 2 },
  { id: "holo_simulator", name: "Holo Simulator", cost: 120, upkeep: 1, tech: "holo_simulator", morale: 20 },
  { id: "autolab", name: "Autolab", cost: 200, upkeep: 3, tech: "autolab", research: 30 },
  { id: "galactic_cybernet", name: "Galactic Cybernet", cost: 250, upkeep: 3, tech: "galactic_cybernet", research: 15, researchPerScientist: 3 },
  { id: "pleasure_dome", name: "Pleasure Dome", cost: 250, upkeep: 3, tech: "pleasure_dome", morale: 30 },
  { id: "virtual_reality_network", name: "Virtual Reality Network", cost: 250, upkeep: 3, tech: "virtual_reality_network", morale: 20 },
  { id: "hydroponic_farm", name: "Hydroponic Farm", cost: 60, upkeep: 2, tech: "hydroponic_farm", food: 2 },
  { id: "biospheres", name: "Biospheres", cost: 60, upkeep: 1, tech: "biospheres", maxPop: 2 },
  { id: "soil_enrichment", name: "Soil Enrichment", cost: 100, upkeep: 0, tech: "soil_enrichment", foodPerFarmer: 1 },
  { id: "cloning_center", name: "Cloning Center", cost: 100, upkeep: 2, tech: "cloning_center", growthK: 100 },
  { id: "subterranean_farms", name: "Subterranean Farms", cost: 150, upkeep: 4, tech: "subterranean_farms", food: 2 },
  { id: "weather_control_system", name: "Weather Controller", cost: 200, upkeep: 3, tech: "weather_control_system", food: 2 },
  { id: "planetary_gravity_generator", name: "Gravity Generator", cost: 120, upkeep: 2, tech: "planetary_gravity_generator" },
  { id: "planetary_radiation_shield", name: "Radiation Shield", cost: 80, upkeep: 1, tech: "planetary_radiation_shield", planetShield: 5, outpostOk: true },
  { id: "planetary_flux_shield", name: "Planetary Flux Shield", cost: 200, upkeep: 3, tech: "planetary_flux_shield", planetShield: 10, outpostOk: true },
  { id: "planetary_barrier_shield", name: "Planetary Barrier Shield", cost: 500, upkeep: 5, tech: "planetary_barrier_shield", planetShield: 20, outpostOk: true },
  { id: "galactic_currency_exchange", name: "Galactic Currency Exchange", cost: 250, upkeep: 3, tech: "galactic_currency_exchange", taxMult: 0.5 },
  { id: "capitol", name: "Capitol", cost: 0, upkeep: 0, tech: "__never__", morale: 20, unique: "empire" },
];

export const BUILDING_BY_ID: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

export function building(id: string): BuildingDef {
  const b = BUILDING_BY_ID[id];
  if (!b) throw new Error(`unknown building ${id}`);
  return b;
}
