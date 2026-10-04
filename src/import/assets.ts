// Decoded-asset cache backed by the user's imported installation (IndexedDB). When nothing has been
// imported, every getter returns null and the UI draws its own procedural artwork instead.
//
// Index constants below are observations about the layout of the user's own files (see
// docs/research/ASSET_MAP.md); they are not copies of any content.

import { parseLbx } from "../formats/lbx.ts";
import type { LbxArchive } from "../formats/lbx.ts";
import { applyEmbeddedPalette, decodeFrame, frameToRgba, isProbablyImage, readImageHeader } from "../formats/image.ts";
import { decodePalette4 } from "../formats/palette.ts";
import type { Palette } from "../formats/palette.ts";
import { decodeNulList, decodeRecordTable, looksLikeRecordTable } from "../formats/text.ts";
import { REQUIRED_FILES, installInfo, loadInstalledFile } from "./install.ts";
import type { InstallInfo } from "./install.ts";

export const ASSET = {
  mainPalette: 1, // FONTS.LBX
  shipPalette: 12, // FONTS.LBX: neutral ramp used for player-tinted ship sprites
  title: 1, // MAINMENU.LBX
  galaxyStar: 148, // BUFFER0.LBX: + 6 * colour + size (0 = largest)
  blackHole: 184, // BUFFER0.LBX
  systemStar: 83, // BUFFER0.LBX: + colour
  planetIcon: 92, // BUFFER0.LBX: + 5 * climate + size (39-40 rotation frames)
  gasGiant: 142, // BUFFER0.LBX
  portrait: 15, // RACESEL.LBX: + race portrait index
  shipBlock: 50, // SHIPS.LBX: images per style block
  starBackgrounds: 6, // STARBG.LBX entries used as backdrops
  planetSurfaces: 30, // PLANETS.LBX
} as const;

export type Img = HTMLCanvasElement;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class AssetService {
  info: InstallInfo | null = null;
  private archives = new Map<string, LbxArchive>();
  private cache = new Map<string, Img | null>();
  private palettes = new Map<number, Palette>();
  starNames: string[] = [];
  shipNames: string[] = [];
  techNames: string[] = [];
  raceNames: string[] = [];

  get available(): boolean {
    return this.archives.size === REQUIRED_FILES.length;
  }

  /** Load archives from IndexedDB. Returns false when no (complete) installation is present. */
  async load(): Promise<boolean> {
    this.archives.clear();
    this.cache.clear();
    this.palettes.clear();
    this.info = await installInfo();
    if (!this.info) return false;
    for (const name of REQUIRED_FILES) {
      const bytes = await loadInstalledFile(name);
      if (!bytes) {
        this.archives.clear();
        return false;
      }
      try {
        this.archives.set(name, parseLbx(name, bytes));
      } catch {
        this.archives.clear();
        return false;
      }
    }
    this.starNames = this.table("STARNAME.LBX", 1);
    this.shipNames = this.table("SHIPNAME.LBX", 0);
    this.raceNames = this.table("RACENAME.LBX", 0);
    try {
      this.techNames = decodeNulList(this.archives.get("TECHNAME.LBX")!.entry(0)).filter(Boolean);
    } catch {
      this.techNames = [];
    }
    return true;
  }

  unload(): void {
    this.archives.clear();
    this.cache.clear();
    this.palettes.clear();
    this.info = null;
    this.starNames = [];
    this.shipNames = [];
    this.techNames = [];
    this.raceNames = [];
  }

  private table(file: string, entry: number): string[] {
    const a = this.archives.get(file);
    if (!a || entry >= a.count) return [];
    const e = a.entry(entry);
    return looksLikeRecordTable(e) ? decodeRecordTable(e).map((s) => s.trim()).filter(Boolean) : [];
  }

  palette(n: number): Palette | null {
    if (this.palettes.has(n)) return this.palettes.get(n)!;
    const a = this.archives.get("FONTS.LBX");
    if (!a || n >= a.count) return null;
    const p = decodePalette4(a.entry(n));
    this.palettes.set(n, p);
    return p;
  }

  /** Decode one image frame to a canvas. `tint` recolours neutral-grey pixels (ship hulls). */
  image(file: string, entry: number, frame = 0, paletteIdx: number = ASSET.mainPalette, tint?: string): Img | null {
    const key = `${file}:${entry}:${frame}:${paletteIdx}:${tint ?? ""}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let out: Img | null = null;
    try {
      const a = this.archives.get(file);
      const base = this.palette(paletteIdx);
      if (a && base && entry < a.count) {
        const e = a.entry(entry);
        if (isProbablyImage(e)) {
          const h = readImageHeader(e);
          const pal = applyEmbeddedPalette(e, base);
          const f = decodeFrame(e, Math.min(frame, h.frameCount - 1));
          const rgba = frameToRgba(f, pal);
          if (tint) {
            const [tr, tg, tb] = hexToRgb(tint);
            for (let i = 0; i < rgba.length; i += 4) {
              if (!rgba[i + 3]) continue;
              const r = rgba[i];
              const g = rgba[i + 1];
              const b = rgba[i + 2];
              if (Math.max(r, g, b) - Math.min(r, g, b) > 14) continue;
              const l = (r + g + b) / 765;
              rgba[i] = Math.min(255, tr * l * 1.6);
              rgba[i + 1] = Math.min(255, tg * l * 1.6);
              rgba[i + 2] = Math.min(255, tb * l * 1.6);
            }
          }
          const c = document.createElement("canvas");
          c.width = f.width;
          c.height = f.height;
          c.getContext("2d")!.putImageData(new ImageData(rgba, f.width, f.height), 0, 0);
          out = c;
        }
      }
    } catch {
      out = null;
    }
    this.cache.set(key, out);
    return out;
  }

  frameCount(file: string, entry: number): number {
    try {
      const a = this.archives.get(file);
      return a ? readImageHeader(a.entry(entry)).frameCount : 0;
    } catch {
      return 0;
    }
  }

  title(): Img | null {
    return this.image("MAINMENU.LBX", ASSET.title);
  }
  galaxyStar(colorIndex: number, size: number, frame = 0): Img | null {
    if (colorIndex < 0) return this.image("BUFFER0.LBX", ASSET.blackHole, frame);
    return this.image("BUFFER0.LBX", ASSET.galaxyStar + 6 * colorIndex + Math.max(0, Math.min(5, size)), frame);
  }
  systemStar(colorIndex: number): Img | null {
    if (colorIndex < 0) return this.image("BUFFER0.LBX", ASSET.blackHole);
    return this.image("BUFFER0.LBX", ASSET.systemStar + colorIndex);
  }
  planetIcon(climate: number, size: number, frame = 0): Img | null {
    return this.image("BUFFER0.LBX", ASSET.planetIcon + 5 * climate + size, frame);
  }
  gasGiant(frame = 0): Img | null {
    return this.image("BUFFER0.LBX", ASSET.gasGiant, frame);
  }
  portrait(index: number): Img | null {
    return this.image("RACESEL.LBX", ASSET.portrait + index);
  }
  ship(style: number, index: number, tint: string): Img | null {
    return this.image("SHIPS.LBX", (style % 8) * ASSET.shipBlock + (index % 48), 0, ASSET.shipPalette, tint);
  }
  starBackground(i: number): Img | null {
    return this.image("STARBG.LBX", i % ASSET.starBackgrounds);
  }
  planetSurface(i: number): Img | null {
    return this.image("PLANETS.LBX", i % ASSET.planetSurfaces);
  }
}

export const assets = new AssetService();
