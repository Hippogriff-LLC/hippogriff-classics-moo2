// User-local import of an original Master of Orion II installation.
//
// The user points the browser at their own installation folder. Only the archives the client actually
// reads are validated and copied into this browser's IndexedDB; nothing leaves the machine and nothing
// is bundled with the application. See docs/research/ASSET_MAP.md for what each archive is used for.

import { parseLbx } from "../formats/lbx.ts";
import { STORE_FILES, STORE_META, idbClear, idbGet, idbPut } from "./idb.ts";

/** Archives read by the client. All are required for the "original assets" presentation. */
export const REQUIRED_FILES = [
  "BUFFER0.LBX",
  "FONTS.LBX",
  "MAINMENU.LBX",
  "PLANETS.LBX",
  "RACESEL.LBX",
  "SHIPS.LBX",
  "STARBG.LBX",
  "STARNAME.LBX",
  "SHIPNAME.LBX",
  "RACENAME.LBX",
  "TECHNAME.LBX",
] as const;

/** Read (never stored) to identify the release. */
const VERSION_FILES = ["README.TXT"];

export interface InstallInfo {
  version: string | null;
  files: { name: string; size: number; entries: number }[];
  importedAt: string;
  source: "folder" | "dev";
}

export interface SourceFile {
  name: string;
  size: number;
  read(): Promise<ArrayBuffer>;
}

export interface ImportReport {
  ok: boolean;
  info: InstallInfo | null;
  missing: string[];
  errors: string[];
}

const upper = (n: string) => n.split(/[\\/]/).pop()!.toUpperCase();

/** Files from an <input type=file webkitdirectory> selection. Only top-level matches are considered. */
export function sourcesFromFileList(list: FileList | File[]): SourceFile[] {
  const files = Array.from(list);
  // prefer the shallowest path for duplicate names (e.g. the game folder vs. nested backups)
  const best = new Map<string, File>();
  const depth = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split("/").length;
  for (const f of files) {
    const key = upper(f.name);
    const prev = best.get(key);
    if (!prev || depth(f) < depth(prev)) best.set(key, f);
  }
  return [...best.entries()].map(([name, f]) => ({ name, size: f.size, read: () => f.arrayBuffer() }));
}

/** Files from the File System Access API directory handle (searches one level of subfolders). */
export async function sourcesFromDirectoryHandle(dir: FileSystemDirectoryHandle): Promise<SourceFile[]> {
  const out = new Map<string, SourceFile>();
  const visit = async (d: FileSystemDirectoryHandle, depth: number) => {
    // @ts-ignore -- async iteration of directory handles is not in every lib.dom version
    for await (const [name, h] of d.entries()) {
      if (h.kind === "file") {
        const key = upper(name);
        if (out.has(key)) continue;
        const file = await (h as FileSystemFileHandle).getFile();
        out.set(key, { name: key, size: file.size, read: () => file.arrayBuffer() });
      } else if (depth < 1) await visit(h as FileSystemDirectoryHandle, depth + 1);
    }
  };
  await visit(dir, 0);
  return [...out.values()];
}

/** DEVELOPMENT ONLY: files exposed by `tools/serve.mjs --dev-install <dir>`. Absent in production builds. */
export async function sourcesFromDevServer(): Promise<SourceFile[] | null> {
  try {
    const res = await fetch("/__dev_install/index.json", { cache: "no-store" });
    if (!res.ok) return null;
    const idx = (await res.json()) as { files: { name: string; size: number }[] };
    return idx.files.map((f) => ({
      name: upper(f.name),
      size: f.size,
      read: async () => {
        const r = await fetch(`/__dev_install/files/${encodeURIComponent(f.name)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`dev install fetch failed for ${f.name}: ${r.status}`);
        return r.arrayBuffer();
      },
    }));
  } catch {
    return null;
  }
}

export function detectVersion(readme: string): string | null {
  const m = /version\s+(\d+\.\d+)/i.exec(readme);
  return m ? m[1] : null;
}

/** Validate and store an installation. `progress` receives (done, total, fileName). */
export async function importInstallation(sources: SourceFile[], source: InstallInfo["source"], progress?: (done: number, total: number, name: string) => void): Promise<ImportReport> {
  const byName = new Map(sources.map((s) => [upper(s.name), s]));
  const missing = REQUIRED_FILES.filter((n) => !byName.has(n));
  const errors: string[] = [];
  if (missing.length) return { ok: false, info: null, missing, errors: ["This folder does not look like a Master of Orion II installation."] };
  const files: InstallInfo["files"] = [];
  const blobs: [string, ArrayBuffer][] = [];
  let i = 0;
  for (const name of REQUIRED_FILES) {
    progress?.(i++, REQUIRED_FILES.length, name);
    const buf = await byName.get(name)!.read();
    try {
      const a = parseLbx(name, new Uint8Array(buf));
      files.push({ name, size: buf.byteLength, entries: a.count });
      blobs.push([name, buf]);
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
    }
  }
  if (errors.length) return { ok: false, info: null, missing: [], errors };
  let version: string | null = null;
  for (const vf of VERSION_FILES) {
    const s = byName.get(vf);
    if (!s) continue;
    version = detectVersion(new TextDecoder("latin1").decode(await s.read()));
    if (version) break;
  }
  await idbClear(STORE_FILES);
  for (const [name, buf] of blobs) await idbPut(STORE_FILES, name, buf);
  const info: InstallInfo = { version, files, importedAt: new Date().toISOString(), source };
  await idbPut(STORE_META, "install", info);
  progress?.(REQUIRED_FILES.length, REQUIRED_FILES.length, "");
  return { ok: true, info, missing: [], errors: [] };
}

export async function installInfo(): Promise<InstallInfo | null> {
  return (await idbGet<InstallInfo>(STORE_META, "install").catch(() => undefined)) ?? null;
}

export async function loadInstalledFile(name: string): Promise<Uint8Array | null> {
  const buf = await idbGet<ArrayBuffer>(STORE_FILES, name).catch(() => undefined);
  return buf ? new Uint8Array(buf) : null;
}

export async function forgetInstallation(): Promise<void> {
  await idbClear(STORE_FILES);
  await idbPut(STORE_META, "install", null);
}
