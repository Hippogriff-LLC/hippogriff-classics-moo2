// Colony build queues: buildings, ships, spies, freighters, housing and trade goods.

import type { BuildItem, Colony, Empire, GameState } from "./types.ts";
import { BUILDINGS, BUILDING_BY_ID } from "./data/buildings.ts";
import type { BuildingDef } from "./data/buildings.ts";
import { designStats } from "./designs.ts";
import { colonyName, empire, hasTech, msg } from "./state.ts";
import { addShipsAt, newShip } from "./world.ts";

export const SPY_COST = 30;
export const FREIGHTER_COST = 40; // per batch of 2 freighters
export const MAX_QUEUE = 7;
const STATIONS = ["star_base", "battlestation", "star_fortress"];

export function stationTier(c: Colony): number {
  let t = 0;
  for (const b of c.buildings) t = Math.max(t, BUILDING_BY_ID[b]?.station ?? 0);
  return t;
}

export function canBuildBuilding(s: GameState, c: Colony, b: BuildingDef): boolean {
  const e = empire(s, c.owner);
  if (b.tech === "__never__") return false;
  if (b.tech && !hasTech(e, b.tech)) return false;
  if (c.buildings.includes(b.id)) return false;
  if (c.queue.some((q) => q.kind === "building" && q.id === b.id)) return false;
  if (c.outpost && !b.outpostOk) return false;
  if (b.station && b.station <= stationTier(c)) return false;
  return true;
}

export function availableBuildings(s: GameState, c: Colony): BuildingDef[] {
  return BUILDINGS.filter((b) => canBuildBuilding(s, c, b));
}

export function buildableDesigns(s: GameState, c: Colony) {
  if (c.outpost) return [];
  return s.designs.filter((d) => d.owner === c.owner && !d.obsolete && d.role !== "monster");
}

export function itemCost(s: GameState, c: Colony, item: BuildItem): number {
  switch (item.kind) {
    case "building":
      return BUILDING_BY_ID[item.id]?.cost ?? 0;
    case "ship":
      return designStats(s.designs[item.designId], empire(s, c.owner)).cost;
    case "spy":
      return SPY_COST;
    case "freighters":
      return FREIGHTER_COST;
    case "housing":
    case "tradegoods":
      return 0;
  }
}

export function itemName(s: GameState, item: BuildItem): string {
  switch (item.kind) {
    case "building":
      return BUILDING_BY_ID[item.id]?.name ?? item.id;
    case "ship":
      return s.designs[item.designId]?.name ?? "Ship";
    case "spy":
      return "Spy";
    case "freighters":
      return "Freighters (x2)";
    case "housing":
      return "Housing";
    case "tradegoods":
      return "Trade Goods";
  }
}

export function isContinuous(item: BuildItem): boolean {
  return item.kind === "housing" || item.kind === "tradegoods";
}

export function enqueue(s: GameState, c: Colony, item: BuildItem): string | null {
  if (c.queue.length >= MAX_QUEUE) return "build queue is full";
  if (c.outpost && !(item.kind === "building" && BUILDING_BY_ID[item.id]?.outpostOk)) return "outposts cannot build that";
  if (item.kind === "building") {
    const b = BUILDING_BY_ID[item.id];
    if (!b || !canBuildBuilding(s, c, b)) return "building not available";
  }
  if (item.kind === "ship") {
    const d = s.designs[item.designId];
    if (!d || d.owner !== c.owner || d.obsolete) return "design not available";
  }
  if (isContinuous(item) && c.queue.some((q) => q.kind === item.kind)) return "already queued";
  c.queue.push(item);
  return null;
}

export function dequeue(c: Colony, index: number): void {
  if (index < 0 || index >= c.queue.length) return;
  c.queue.splice(index, 1);
  if (index === 0) c.progress = 0;
}

export function moveQueueItem(c: Colony, from: number, to: number): void {
  if (from < 0 || from >= c.queue.length || to < 0 || to >= c.queue.length || from === to) return;
  const [it] = c.queue.splice(from, 1);
  c.queue.splice(to, 0, it);
  if (from === 0 || to === 0) c.progress = 0;
}

export function buyCost(s: GameState, c: Colony): number {
  const head = c.queue[0];
  if (!head || isContinuous(head)) return 0;
  const cost = itemCost(s, c, head);
  const remaining = Math.max(0, cost - c.progress);
  if (remaining <= 0) return 0;
  return Math.ceil(remaining * (c.progress > 0 ? 2 : 4));
}

export function buy(s: GameState, c: Colony): string | null {
  const e = empire(s, c.owner);
  const head = c.queue[0];
  if (!head || isContinuous(head)) return "nothing to buy";
  const price = buyCost(s, c);
  if (price <= 0) return "already complete";
  if (e.bc < price) return "not enough BC";
  e.bc -= price;
  c.progress = itemCost(s, c, head);
  return null;
}

function complete(s: GameState, c: Colony, e: Empire, item: BuildItem): void {
  const name = colonyName(s, c);
  switch (item.kind) {
    case "building":
      if (!c.buildings.includes(item.id)) {
        if (BUILDING_BY_ID[item.id]?.station) c.buildings = c.buildings.filter((b) => !STATIONS.includes(b));
        c.buildings.push(item.id);
      }
      msg(s, e.id, "production", `${name} completed ${itemName(s, item)}.`, { starId: c.starId, colonyId: c.id });
      break;
    case "ship": {
      const sh = newShip(s, item.designId);
      if (c.buildings.includes("space_academy")) sh.xp = 1;
      addShipsAt(s, e.id, c.starId, [sh]);
      msg(s, e.id, "production", `${name} launched a ${itemName(s, item)}.`, { starId: c.starId, colonyId: c.id });
      break;
    }
    case "spy":
      e.spies += 1;
      msg(s, e.id, "production", `${name} trained a spy.`, { colonyId: c.id });
      break;
    case "freighters":
      e.freighters += 2;
      msg(s, e.id, "production", `${name} built 2 freighters.`, { colonyId: c.id });
      break;
    default:
      break;
  }
}

/** Apply a turn of production to a colony. Returns BC generated by trade goods. */
export function processProduction(s: GameState, c: Colony, production: number): number {
  const e = empire(s, c.owner);
  let bc = 0;
  let pp = production;
  for (let guard = 0; guard < 8; guard++) {
    const head = c.queue[0];
    if (!head) {
      // idle production is converted at a poor rate
      bc += pp * 0.25;
      return bc;
    }
    if (head.kind === "tradegoods") {
      bc += pp * 0.5;
      return bc;
    }
    if (head.kind === "housing") return bc;
    c.progress += pp;
    pp = 0;
    const cost = itemCost(s, c, head);
    if (c.progress < cost) return bc;
    c.progress -= cost;
    c.queue.shift();
    complete(s, c, e, head);
    // overflow carries into the next item
    pp = c.progress;
    c.progress = 0;
    if (pp <= 0) return bc;
  }
  c.progress = Math.max(0, pp);
  return bc;
}
