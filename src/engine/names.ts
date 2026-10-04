// Project-authored procedural name generation, used when no original name lists have been imported.

import type { Rng } from "./rng.ts";

const ONSET = ["Al", "Ar", "Be", "Ca", "Cor", "Da", "De", "El", "Er", "Fa", "Ga", "Hal", "Ix", "Ja", "Ka", "Kel", "La", "Ly", "Ma", "Mir", "Na", "Ny", "Or", "Pa", "Ph", "Qu", "Ra", "Rho", "Sa", "Sel", "Ta", "Tir", "Ul", "Va", "Vel", "Xa", "Ya", "Ze", "Zor"];
const MID = ["", "", "", "a", "e", "i", "o", "u", "ae", "ar", "en", "il", "on", "ra", "th", "ri", "ve", "lo"];
const CODA = ["", "", "n", "s", "x", "th", "ra", "ris", "nis", "tor", "lon", "dar", "mi", "phe", "us", "a", "ia", "on", "ek"];

export function proceduralName(rng: Rng): string {
  const n = rng.pick(ONSET) + rng.pick(MID) + rng.pick(CODA);
  return n.length < 3 ? n + rng.pick(["a", "on", "is"]) : n;
}

export function uniqueNames(rng: Rng, count: number, preferred: string[] = []): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  const pool = rng.shuffle(preferred.filter((x) => x && x.trim().length > 1).map((x) => x.trim()));
  for (const p of pool) {
    if (out.length >= count) break;
    if (!used.has(p.toLowerCase())) {
      used.add(p.toLowerCase());
      out.push(p);
    }
  }
  let guard = 0;
  while (out.length < count && guard++ < 10000) {
    const n = proceduralName(rng);
    if (!used.has(n.toLowerCase())) {
      used.add(n.toLowerCase());
      out.push(n);
    }
  }
  return out;
}

const SHIP_WORDS = ["Valiant", "Resolute", "Aurora", "Tempest", "Vigil", "Harbinger", "Corsair", "Sentinel", "Meridian", "Zephyr", "Paragon", "Talon", "Lance", "Bastion", "Comet", "Nova", "Specter", "Warden", "Falcon", "Monarch"];

export function shipName(rng: Rng, extra: string[] = []): string {
  if (extra.length && rng.chance(0.7)) return rng.pick(extra);
  return `${rng.pick(SHIP_WORDS)} ${rng.range(1, 99)}`;
}
