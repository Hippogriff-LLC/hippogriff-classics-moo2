// Save slots in IndexedDB plus JSON export/import. Saves contain only engine state (no original data).

import type { GameState } from "../engine/types.ts";
import { deserialize, serialize } from "../engine/save.ts";
import type { SaveHeader } from "../engine/save.ts";
import { STORE_SAVES, idbDelete, idbGet, idbKeys, idbPut } from "../import/idb.ts";

export const AUTOSAVE = "autosave";
export const SLOTS = ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6", "slot7", "slot8"];

export interface SlotInfo {
  slot: string;
  header: SaveHeader | null;
  error?: string;
}

export async function writeSave(slot: string, s: GameState, label: string): Promise<void> {
  await idbPut(STORE_SAVES, slot, serialize(s, label));
}

export async function readSave(slot: string): Promise<GameState> {
  const text = await idbGet<string>(STORE_SAVES, slot);
  if (!text) throw new Error("empty slot");
  return deserialize(text).state;
}

export async function listSaves(): Promise<SlotInfo[]> {
  const keys = new Set(await idbKeys(STORE_SAVES).catch(() => [] as string[]));
  const out: SlotInfo[] = [];
  for (const slot of [AUTOSAVE, ...SLOTS]) {
    if (!keys.has(slot)) {
      out.push({ slot, header: null });
      continue;
    }
    try {
      const text = (await idbGet<string>(STORE_SAVES, slot))!;
      out.push({ slot, header: deserialize(text).header });
    } catch (err) {
      out.push({ slot, header: null, error: (err as Error).message });
    }
  }
  return out;
}

export async function deleteSave(slot: string): Promise<void> {
  await idbDelete(STORE_SAVES, slot);
}

export function downloadSave(s: GameState, label: string): void {
  const text = serialize(s, label);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = `hippogriff-moo2-turn${s.turn}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readSaveFile(file: File): Promise<GameState> {
  return deserialize(await file.text()).state;
}
