// Save-game serialisation. Saves are plain JSON of GameState wrapped with a small header.

import type { GameState } from "./types.ts";

export const SAVE_FORMAT = "hippogriff-moo2-save";
export const SAVE_VERSION = 1;

export interface SaveHeader {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  label: string;
  turn: number;
  empire: string;
  checksum: string;
}

export interface SaveFile {
  header: SaveHeader;
  state: GameState;
}

/** FNV-1a over the canonical state JSON; detects truncation/corruption, not tampering. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function serialize(s: GameState, label = "", now: Date = new Date()): string {
  const stateJson = JSON.stringify(s);
  const human = s.empires.find((e) => e.human);
  const header: SaveHeader = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    label: label || `Turn ${s.turn}`,
    turn: s.turn,
    empire: human?.name ?? "",
    checksum: checksum(stateJson),
  };
  return `{"header":${JSON.stringify(header)},"state":${stateJson}}`;
}

export class SaveError extends Error {}

const REQUIRED: (keyof GameState)[] = ["schema", "seed", "rng", "turn", "phase", "settings", "stars", "planets", "colonies", "fleets", "designs", "empires", "nextId", "messages"];

export function deserialize(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError("save file is not valid JSON");
  }
  const obj = raw as Partial<SaveFile>;
  if (!obj || typeof obj !== "object" || !obj.header || !obj.state) throw new SaveError("not a save file");
  if (obj.header.format !== SAVE_FORMAT) throw new SaveError("unrecognised save format");
  if (obj.header.version > SAVE_VERSION) throw new SaveError("save was written by a newer version");
  const st = obj.state as GameState;
  for (const k of REQUIRED) if (!(k in st)) throw new SaveError(`save is missing ${k}`);
  if (st.schema !== 1) throw new SaveError("unsupported state schema");
  if (checksum(JSON.stringify(st)) !== obj.header.checksum) throw new SaveError("save checksum mismatch (file damaged?)");
  // forward-compatible defaults
  for (const e of st.empires) e.espionage ??= { target: null, mode: "steal" };
  st.pendingBattles ??= [];
  st.proposals ??= [];
  st.battleReports ??= [];
  return { header: obj.header, state: st };
}

export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
