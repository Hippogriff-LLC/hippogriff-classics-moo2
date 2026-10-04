// Artwork: decoded from the user's imported installation when available, otherwise procedural
// project-authored drawings. Every function here works with or without imported data.

import type { Planet, ShipDesign, Star } from "../engine/types.ts";
import { STAR_COLORS } from "../engine/types.ts";
import { EMPIRE_COLORS, race } from "../engine/data/races.ts";
import { assets } from "../import/assets.ts";

export const STAR_RGB: Record<string, string> = {
  blue: "#9cc8ff",
  white: "#f0f0ff",
  yellow: "#ffe27a",
  orange: "#ffaa50",
  red: "#ff6a50",
  brown: "#b98a66",
  blackhole: "#5a3a7a",
};

export const CLIMATE_RGB = ["#9a7a20", "#b04a2a", "#8c8c84", "#c49460", "#b8c8d8", "#3a70c0", "#5f7a40", "#b09070", "#3a8aa0", "#40b050"];

const cache = new Map<string, HTMLCanvasElement>();

function canvas(w: number, hgt: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  return [c, c.getContext("2d")!];
}

function memo(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
}

/** Forget procedural caches (e.g. after importing or forgetting original data). */
export function resetArt(): void {
  cache.clear();
}

function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function starColorIndex(st: Star): number {
  return st.color === "blackhole" ? -1 : STAR_COLORS.indexOf(st.color as (typeof STAR_COLORS)[number]);
}

/** Draw a star on the galaxy map centred at (x, y). `px` is the desired radius in screen pixels. */
export function drawGalaxyStar(ctx: CanvasRenderingContext2D, st: Star, x: number, y: number, px: number, frame = 0): void {
  const ci = starColorIndex(st);
  const img = assets.available ? assets.galaxyStar(ci, ci < 0 ? 0 : 1 + st.size, ci < 0 ? frame % 16 : frame % 5) : null;
  if (img) {
    const s = (px * 2.6) / Math.max(img.width, 1);
    ctx.drawImage(img, x - (img.width * s) / 2, y - (img.height * s) / 2, img.width * s, img.height * s);
    return;
  }
  if (st.color === "blackhole") {
    ctx.strokeStyle = "#7a4aa8";
    ctx.lineWidth = Math.max(1, px / 3);
    ctx.beginPath();
    ctx.arc(x, y, px, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(x, y, px * 0.7, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const col = STAR_RGB[st.color];
  const g = ctx.createRadialGradient(x, y, 0, x, y, px * 2.2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.25, col);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, px * 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function proceduralPlanet(p: Planet, r: number): HTMLCanvasElement {
  return memo(`planet:${p.kind}:${p.climate}:${p.size}:${p.id % 7}:${r}`, () => {
    const d = Math.ceil(r * 2 + 2);
    const [c, ctx] = canvas(d, d);
    const cx = d / 2;
    if (p.kind === "asteroids") {
      for (let i = 0; i < 14; i++) {
        const hsh = hash(p.id * 31 + i);
        const a = ((hsh & 1023) / 1023) * Math.PI * 2;
        const rr = r * (0.3 + ((hsh >>> 10) & 255) / 400);
        ctx.fillStyle = i % 2 ? "#8a8070" : "#a09888";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 1 + ((hsh >>> 18) % 3) * (r / 14), 0, Math.PI * 2);
        ctx.fill();
      }
      return c;
    }
    const base = p.kind === "gasgiant" ? "#c08a50" : CLIMATE_RGB[p.climate];
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cx, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, d, d);
    if (p.kind === "gasgiant") {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? "rgba(255,220,170,0.25)" : "rgba(90,50,20,0.25)";
        ctx.fillRect(0, cx - r + (i * 2 * r) / 6, d, r / 4);
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const hsh = hash(p.id * 97 + i);
        ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";
        ctx.beginPath();
        ctx.arc(((hsh & 255) / 255) * d, (((hsh >>> 8) & 255) / 255) * d, r * (0.15 + ((hsh >>> 16) & 63) / 160), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const shade = ctx.createRadialGradient(cx - r * 0.4, cx - r * 0.4, r * 0.1, cx, cx, r * 1.05);
    shade.addColorStop(0, "rgba(255,255,255,0.25)");
    shade.addColorStop(0.6, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, d, d);
    ctx.restore();
    return c;
  });
}

/** Planet icon for lists and the system view. */
export function planetImage(p: Planet, r: number, frame = 0): HTMLCanvasElement {
  if (assets.available) {
    const img = p.kind === "gasgiant" ? assets.gasGiant(frame) : p.kind === "habitable" ? assets.planetIcon(p.climate, p.size, frame) : null;
    if (img) return img;
  }
  return proceduralPlanet(p, r);
}

export function drawStarDisc(ctx: CanvasRenderingContext2D, st: Star, x: number, y: number, r: number): void {
  const img = assets.available ? assets.systemStar(starColorIndex(st)) : null;
  if (img) {
    const s = (r * 2) / img.width;
    ctx.drawImage(img, x - r, y - (img.height * s) / 2, r * 2, img.height * s);
    return;
  }
  drawGalaxyStar(ctx, st, x, y, r * 0.8);
}

function proceduralShip(d: ShipDesign, color: string, size: number): HTMLCanvasElement {
  return memo(`ship:${d.hull}:${d.imageIndex}:${color}:${size}:${d.role}`, () => {
    const [c, ctx] = canvas(size, size);
    const s = size / 2;
    const k = hash(d.imageIndex + d.hull * 13);
    const len = s * (0.55 + d.hull * 0.08);
    const wid = s * (0.3 + (k % 5) * 0.04 + d.hull * 0.05);
    ctx.translate(s, s);
    if (d.role === "monster") {
      ctx.fillStyle = color;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4, s * 0.25, s * 0.12, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#fff8";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      return c;
    }
    ctx.fillStyle = "#283040";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size / 28);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.7, -wid);
    ctx.lineTo(-len * (0.45 + (k % 3) * 0.1), 0);
    ctx.lineTo(-len * 0.7, wid);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(len * 0.15, 0, Math.max(1.5, wid * 0.3), 0, Math.PI * 2);
    ctx.fill();
    if (d.hull >= 2) {
      ctx.fillRect(-len * 0.6, -wid * 0.9, len * 0.5, wid * 0.18);
      ctx.fillRect(-len * 0.6, wid * 0.72, len * 0.5, wid * 0.18);
    }
    return c;
  });
}

/** Ship sprite facing right. */
export function shipImage(d: ShipDesign, empireColor: number, size = 48): HTMLCanvasElement {
  const color = d.owner < 0 ? "#c050ff" : EMPIRE_COLORS[empireColor] ?? "#ccc";
  if (assets.available && d.role !== "monster") {
    const img = assets.ship(empireColor, d.imageIndex, color);
    if (img) return memo(`shipfit:${empireColor}:${d.imageIndex}:${d.hull}:${color}:${size}`, () => fitSprite(img, size, 0.66 + Math.min(5, d.hull) * 0.066));
  }
  return proceduralShip(d, color, size);
}

/** Crop a sprite to its opaque pixels and centre it in a size×size canvas, filling `frac` of the side. */
function fitSprite(img: HTMLCanvasElement, size: number, frac: number): HTMLCanvasElement {
  const a = img.getContext("2d")!.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!a[(y * img.width + x) * 4 + 3]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return img;
  const w = x1 - x0 + 1;
  const hgt = y1 - y0 + 1;
  const k = (size * frac) / Math.max(w, hgt);
  const [c, ctx] = canvas(size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x0, y0, w, hgt, (size - w * k) / 2, (size - hgt * k) / 2, w * k, hgt * k);
  return c;
}

/** Race portrait (imported) or a procedural emblem. */
export function portrait(raceId: string, w = 145, hgt = 161): HTMLCanvasElement {
  const rd = race(raceId);
  if (assets.available) {
    const img = assets.portrait(rd.portrait);
    if (img) return img;
  }
  return memo(`portrait:${raceId}:${w}x${hgt}`, () => {
    const [c, ctx] = canvas(w, hgt);
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    g.addColorStop(0, "#0b1020");
    g.addColorStop(1, rd.tint);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    const k = hash(rd.portrait + 3);
    ctx.fillStyle = rd.tint;
    ctx.strokeStyle = "#0008";
    ctx.lineWidth = 3;
    const hw = w * (0.24 + (k % 5) * 0.03);
    const hh = hgt * (0.26 + ((k >>> 3) % 5) * 0.025);
    ctx.beginPath();
    ctx.ellipse(w / 2, hgt * 0.45, hw, hh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(w / 2, hgt * 1.02, w * 0.42, hgt * 0.3, 0, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = (k & 64) ? "#ffd84a" : "#101010";
    const ey = hgt * 0.42;
    const ex = hw * 0.45;
    const er = Math.max(3, hw * (0.12 + ((k >>> 7) % 4) * 0.04));
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(w / 2 + sx * ex, ey, er, er * (0.6 + ((k >>> 9) % 3) * 0.2), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(hgt / 9)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(rd.name.toUpperCase(), w / 2, hgt - 8);
    return c;
  });
}

/** Full-screen backdrop for menus: imported title art or a procedural starfield. */
export function backdrop(w: number, hgt: number, kind: "title" | "space" = "space", seed = 1): HTMLCanvasElement {
  if (assets.available) {
    const img = kind === "title" ? assets.title() : assets.starBackground(seed);
    if (img) return img;
  }
  return memo(`backdrop:${kind}:${w}x${hgt}:${seed}`, () => {
    const [c, ctx] = canvas(w, hgt);
    const g = ctx.createRadialGradient(w * 0.6, hgt * 0.4, 0, w * 0.6, hgt * 0.4, w);
    g.addColorStop(0, "#1a1440");
    g.addColorStop(0.5, "#090b1c");
    g.addColorStop(1, "#020208");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    for (let i = 0; i < (w * hgt) / 900; i++) {
      const k = hash(i * 7 + seed * 1013);
      const b = 120 + (k & 127);
      ctx.fillStyle = `rgb(${b},${b},${Math.min(255, b + 30)})`;
      ctx.fillRect((k >>> 8) % w, (k >>> 4) % hgt, (k & 3) === 0 ? 2 : 1, (k & 3) === 0 ? 2 : 1);
    }
    if (kind === "title") {
      ctx.fillStyle = "#ffd65a";
      ctx.font = `bold ${Math.round(w / 16)}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.fillText("HIPPOGRIFF", w / 2, hgt * 0.32);
      ctx.font = `${Math.round(w / 40)}px Georgia, serif`;
      ctx.fillStyle = "#c8d0ff";
      ctx.fillText("a browser-native Master of Orion II reimplementation", w / 2, hgt * 0.32 + w / 22);
    }
    return c;
  });
}
