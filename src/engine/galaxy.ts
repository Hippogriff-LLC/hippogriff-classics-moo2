// Procedural galaxy generation. The distributions are project-authored approximations
// (docs/research/RULES.md); no original map data is used.

import type { GameSettings, Planet, PlanetKind, Star, StarColor } from "./types.ts";
import { STAR_COLORS } from "./types.ts";
import type { Rng } from "./rng.ts";

export const GALAXY_DIMENSIONS: Record<GameSettings["galaxySize"], { w: number; h: number; stars: number }> = {
  small: { w: 24, h: 18, stars: 20 },
  medium: { w: 32, h: 24, stars: 36 },
  large: { w: 40, h: 30, stars: 54 },
  huge: { w: 48, h: 36, stars: 72 },
};

const COLOR_WEIGHTS: Record<GameSettings["galaxyAge"], number[]> = {
  // blue, white, yellow, orange, red, brown
  young: [16, 20, 22, 16, 14, 4],
  average: [10, 15, 22, 20, 23, 10],
  old: [5, 10, 18, 20, 30, 17],
};

/** Climate weights by star colour: Toxic, Radiated, Barren, Desert, Tundra, Ocean, Swamp, Arid, Terran, Gaia. */
const CLIMATE_WEIGHTS: Record<string, number[]> = {
  blue: [30, 30, 20, 8, 5, 2, 2, 3, 1, 0],
  white: [20, 20, 20, 10, 8, 6, 4, 6, 4, 1],
  yellow: [10, 8, 15, 10, 10, 12, 8, 10, 12, 5],
  orange: [10, 5, 18, 10, 12, 10, 10, 12, 10, 3],
  red: [12, 3, 25, 12, 18, 6, 8, 10, 5, 1],
  brown: [20, 5, 35, 15, 15, 2, 3, 4, 1, 0],
};

const MINERAL_WEIGHTS: Record<string, number[]> = {
  blue: [3, 10, 30, 35, 22],
  white: [5, 15, 35, 30, 15],
  yellow: [10, 25, 40, 18, 7],
  orange: [12, 28, 40, 15, 5],
  red: [18, 32, 35, 12, 3],
  brown: [30, 35, 25, 8, 2],
};

export interface GalaxyResult {
  width: number;
  height: number;
  stars: Star[];
  planets: Planet[];
  orionStarId: number;
  homeStarIds: number[];
}

function weightedIndex(rng: Rng, w: number[]): number {
  return rng.weighted(w.map((x, i) => [i, x] as const));
}

function makePlanet(rng: Rng, id: number, starId: number, orbit: number, color: string): Planet {
  const roll = rng.next();
  const kind: PlanetKind = roll < 0.12 ? "asteroids" : roll < 0.28 ? "gasgiant" : "habitable";
  const size = kind === "habitable" ? weightedIndex(rng, [10, 25, 35, 20, 10]) : kind === "gasgiant" ? 4 : 1;
  const climate = kind === "habitable" ? weightedIndex(rng, CLIMATE_WEIGHTS[color] ?? CLIMATE_WEIGHTS.yellow) : 2;
  const minerals = weightedIndex(rng, MINERAL_WEIGHTS[color] ?? MINERAL_WEIGHTS.yellow);
  let gravity = 1;
  const g = size + minerals;
  if (g <= 2) gravity = 0;
  else if (g >= 6) gravity = 2;
  let special: Planet["special"] = "none";
  if (kind === "habitable") {
    const sr = rng.next();
    if (sr < 0.04) special = "gold";
    else if (sr < 0.06) special = "gems";
    else if (sr < 0.08) special = "artifacts";
    else if (sr < 0.1) special = "ruins";
  }
  return { id, starId, orbit, kind, size, climate, minerals, gravity, special, colonyId: null, terraformed: -999 };
}

/** Place stars with a minimum spacing using best-candidate sampling. */
function placeStars(rng: Rng, w: number, h: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  const margin = 1.2;
  for (let i = 0; i < n; i++) {
    let best: [number, number] = [0, 0];
    let bestD = -1;
    for (let k = 0; k < 14; k++) {
      const x = margin + rng.next() * (w - 2 * margin);
      const y = margin + rng.next() * (h - 2 * margin);
      let md = Infinity;
      for (const [px, py] of pts) md = Math.min(md, Math.hypot(px - x, py - y));
      if (md > bestD) {
        bestD = md;
        best = [x, y];
      }
    }
    pts.push([Math.round(best[0] * 10) / 10, Math.round(best[1] * 10) / 10]);
  }
  return pts;
}

/** Choose `count` home stars spread far apart and away from the centre (Orion). */
function chooseHomes(rng: Rng, stars: Star[], count: number, orionId: number): number[] {
  const candidates = stars.filter((s) => s.id !== orionId && s.color !== "blackhole").map((s) => s.id);
  const orion = stars[orionId];
  const homes: number[] = [];
  for (let i = 0; i < count; i++) {
    let best = -1;
    let bestScore = -Infinity;
    for (const id of candidates) {
      if (homes.includes(id)) continue;
      const st = stars[id];
      let md = Infinity;
      for (const h of homes) md = Math.min(md, Math.hypot(stars[h].x - st.x, stars[h].y - st.y));
      if (!homes.length) md = Math.hypot(st.x - orion.x, st.y - orion.y) + rng.next() * 6;
      const score = md + rng.next() * 2 + Math.min(6, Math.hypot(st.x - orion.x, st.y - orion.y)) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best < 0) break;
    homes.push(best);
  }
  return homes;
}

export function generateGalaxy(rng: Rng, settings: GameSettings, empires: number, names: string[]): GalaxyResult {
  const dim = GALAXY_DIMENSIONS[settings.galaxySize];
  const n = Math.max(dim.stars, empires * 4 + 4);
  const pts = placeStars(rng, dim.w, dim.h, n);
  // Orion: the star nearest the centre
  let orionId = 0;
  let od = Infinity;
  pts.forEach(([x, y], i) => {
    const d = Math.hypot(x - dim.w / 2, y - dim.h / 2);
    if (d < od) {
      od = d;
      orionId = i;
    }
  });
  const stars: Star[] = [];
  const planets: Planet[] = [];
  const cw = COLOR_WEIGHTS[settings.galaxyAge];
  pts.forEach(([x, y], i) => {
    let color: StarColor = STAR_COLORS[weightedIndex(rng, cw)];
    if (i !== orionId && rng.chance(0.05)) color = "blackhole";
    if (i === orionId) color = "yellow";
    stars.push({
      id: i,
      name: names[i] ?? `Star ${i}`,
      x,
      y,
      color,
      size: rng.int(3),
      planetIds: [],
      special: i === orionId ? "orion" : "none",
      exploredBy: [],
      wormholeTo: null,
    });
  });
  stars[orionId].name = "Orion";
  const homeStarIds = chooseHomes(rng, stars, empires, orionId);
  for (const st of stars) {
    if (st.color === "blackhole") continue;
    const isHome = homeStarIds.includes(st.id);
    if (st.id === orionId) {
      const p: Planet = { id: planets.length, starId: st.id, orbit: 2, kind: "habitable", size: 4, climate: 9, minerals: 4, gravity: 1, special: "artifacts", colonyId: null, terraformed: -999 };
      planets.push(p);
      st.planetIds.push(p.id);
      continue;
    }
    for (let orbit = 0; orbit < 5; orbit++) {
      const chance = isHome ? 0.5 : 0.45;
      if (!rng.chance(chance)) continue;
      const p = makePlanet(rng, planets.length, st.id, orbit, st.color);
      planets.push(p);
      st.planetIds.push(p.id);
    }
  }
  // a few wormhole pairs among non-home, non-Orion stars
  const free = stars.filter((s) => s.color !== "blackhole" && s.id !== orionId && !homeStarIds.includes(s.id)).map((s) => s.id);
  rng.shuffle(free);
  const pairs = Math.floor(stars.length / 18);
  for (let i = 0; i < pairs && free.length >= 2; i++) {
    const a = free.pop()!;
    const b = free.pop()!;
    if (Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y) < 8) continue;
    stars[a].wormholeTo = b;
    stars[b].wormholeTo = a;
  }
  return { width: dim.w, height: dim.h, stars, planets, orionStarId: orionId, homeStarIds };
}

/** Rebuild a home system: homeworld at orbit 2 plus a guaranteed mix of other bodies. */
export function shapeHomeSystem(rng: Rng, stars: Star[], planets: Planet[], starId: number, hw: { size: number; climate: number; minerals: number; gravity: number }): Planet {
  const st = stars[starId];
  st.color = rng.pick(["yellow", "orange", "white"] as const);
  st.special = "homeworld";
  const byOrbit = new Map<number, Planet>();
  for (const pid of st.planetIds) byOrbit.set(planets[pid].orbit, planets[pid]);
  const ensure = (orbit: number): Planet => {
    let p = byOrbit.get(orbit);
    if (!p) {
      p = makePlanet(rng, planets.length, starId, orbit, st.color);
      planets.push(p);
      st.planetIds.push(p.id);
      byOrbit.set(orbit, p);
    }
    return p;
  };
  const home = ensure(2);
  Object.assign(home, { kind: "habitable", size: hw.size, climate: hw.climate, minerals: hw.minerals, gravity: hw.gravity, special: "none" });
  const second = ensure(rng.pick([0, 1, 3, 4]));
  Object.assign(second, { kind: "habitable", size: rng.range(0, 2), climate: rng.pick([2, 3, 4, 7]), minerals: rng.range(1, 3), gravity: 1, special: "none" });
  const third = ensure(second.orbit === 4 ? 3 : 4);
  Object.assign(third, { kind: rng.chance(0.5) ? "gasgiant" : "asteroids", size: 4, climate: 2, minerals: 2, gravity: 1, special: "none" });
  for (const p of st.planetIds.map((id) => planets[id])) {
    if (p === home || p === second || p === third) continue;
    p.kind = "habitable";
    p.climate = rng.pick([0, 1, 2]);
    p.special = "none";
  }
  st.planetIds.sort((a, b) => planets[a].orbit - planets[b].orbit);
  return home;
}
