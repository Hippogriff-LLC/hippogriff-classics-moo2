// Galaxy map: canvas starmap with pan/zoom, fleet movement orders and a context side panel.

import type { App } from "./app.ts";
import type { Fleet, GameState, Planet, Star } from "../engine/types.ts";
import { CLIMATES, MINERALS, PLANET_SIZES, GRAVITIES, MONSTER_OWNER } from "../engine/types.ts";
import { EMPIRE_COLORS, race } from "../engine/data/races.ts";
import { HULLS } from "../engine/data/ships.ts";
import { atWar, coloniesAt, colonyName, fleetsAt, ownerOfStar, planetName } from "../engine/state.ts";
import { canColonize, etaTurns, fleetVisible, fleetRange, inRange, mergeFleets, orderMove, splitFleet, supplyDistance } from "../engine/fleets.ts";
import { designStats } from "../engine/designs.ts";
import { fleetBombs, fleetTroops, garrison, orbitBlocked } from "../engine/ground.ts";
import { cmdBombard, cmdColonize, cmdInvade } from "../engine/commands.ts";
import { maxPopulation } from "../engine/economy.ts";
import { h, button, fmt } from "./dom.ts";
import { drawGalaxyStar, planetImage, shipImage } from "./art.ts";

interface Camera {
  gameId: string;
  cx: number;
  cy: number;
  zoom: number; // pixels per parsec
}

let cam: Camera | null = null;
const splitPick = new Set<number>();

function fleetColor(s: GameState, f: Fleet): string {
  return f.owner === MONSTER_OWNER ? "#c050ff" : EMPIRE_COLORS[s.empires[f.owner].color];
}

export function fleetLabel(s: GameState, f: Fleet): string {
  const counts = new Map<string, number>();
  for (const sh of f.ships) {
    const n = s.designs[sh.designId].name;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(", ");
}

function planetLine(s: GameState, app: App, p: Planet, star: Star): HTMLElement {
  const meId = app.me.id;
  const icon = h("canvas", { width: 28, height: 28, class: "picon" });
  const img = planetImage(p, 13);
  icon.getContext("2d")!.drawImage(img, 0, 0, 28, 28);
  const name = planetName(s, p);
  let desc: string;
  if (p.kind === "asteroids") desc = "Asteroid belt";
  else if (p.kind === "gasgiant") desc = "Gas giant";
  else desc = `${PLANET_SIZES[p.size]} ${CLIMATES[p.climate]}, ${MINERALS[p.minerals]}, ${GRAVITIES[p.gravity]}`;
  if (p.special !== "none") desc += ` · ${p.special}`;
  const c = p.colonyId !== null ? s.colonies[p.colonyId] : null;
  const parts: (HTMLElement | string)[] = [icon, h("div", { class: "pinfo" }, h("strong", null, name), h("span", { class: "muted" }, desc))];
  if (c) {
    const owner = s.empires[c.owner];
    parts.push(h("span", { class: "owner", style: `color:${EMPIRE_COLORS[owner.color]}` }, c.outpost ? `${owner.name} outpost` : `${race(c.raceId).name} · ${c.pop}M`));
    if (c.owner === meId) parts.push(button("Open", () => { app.colonyId = c.id; app.back = "galaxy"; app.go("colony"); }, { testid: `open-colony-${c.id}` }));
  } else if (p.kind === "habitable") {
    parts.push(h("span", { class: "muted" }, `max ${maxPopulation(s, null, app.me.raceId, p, app.me)}M`));
  }
  // colonise from any of our fleets here
  if (!c) {
    for (const f of fleetsAt(s, star.id).filter((x) => x.owner === meId)) {
      if (canColonize(s, f, p) === null) {
        parts.push(button("Settle", () => {
          const err = cmdColonize(s, f.id, p.id, p.kind !== "habitable");
          if (err) app.toast(err, "error");
          else {
            app.toast(`Founded a new ${p.kind === "habitable" ? "colony" : "outpost"} at ${name}`);
            app.sel.fleetId = null;
          }
          app.refresh();
        }, { cls: "primary", testid: `settle-${p.id}` }));
        break;
      }
    }
  }
  return h("div", { class: "planet-line" }, ...parts);
}

function starPanel(app: App, st: Star): HTMLElement {
  const s = app.game!;
  const meId = app.me.id;
  const explored = st.exploredBy.includes(meId);
  const owner = ownerOfStar(s, st.id);
  const parts: (HTMLElement | null)[] = [
    h("h2", null, st.name),
    h("p", { class: "muted" }, `${st.color === "blackhole" ? "Black hole" : `${st.color[0].toUpperCase()}${st.color.slice(1)} star`}${st.special === "orion" ? " · Orion" : ""}${st.wormholeTo !== null ? ` · wormhole to ${s.stars[st.wormholeTo].name}` : ""}${owner !== null && explored ? ` · ${s.empires[owner].name}` : ""}`),
  ];
  if (!explored) parts.push(h("p", null, "Unexplored. Send a ship to survey this system."));
  else if (!st.planetIds.length) parts.push(h("p", null, "No planets."));
  else parts.push(h("div", { class: "planets" }, ...st.planetIds.map((pid) => planetLine(s, app, s.planets[pid], st))));
  const fl = fleetsAt(s, st.id).filter((f) => fleetVisible(s, meId, f));
  if (fl.length) {
    parts.push(h("h3", null, "Fleets"));
    for (const f of fl) {
      parts.push(
        h(
          "div",
          { class: "fleet-line" },
          h("span", { class: "swatch", style: `background:${fleetColor(s, f)}` }),
          h("span", null, `${f.owner === MONSTER_OWNER ? "Monster" : s.empires[f.owner].name}: ${f.owner === meId ? f.name + " — " : ""}${fleetLabel(s, f)}`),
          f.owner === meId ? button("Select", () => { app.sel.fleetId = f.id; splitPick.clear(); app.refresh(); }, { testid: `select-fleet-${f.id}` }) : null,
        ),
      );
    }
  }
  return h("div", { class: "panel-inner" }, ...parts);
}

function fleetPanel(app: App, f: Fleet): HTMLElement {
  const s = app.game!;
  const e = app.me;
  const here = f.starId !== null ? s.stars[f.starId] : null;
  const dest = f.destStarId !== null ? s.stars[f.destStarId] : null;
  const parts: (HTMLElement | null)[] = [h("h2", null, f.name), h("p", { class: "muted" }, `${here ? `At ${here.name}` : "In transit"}${dest ? ` → ${dest.name} (${etaTurns(s, f, dest.id)} turns)` : ""} · range ${fleetRange(s, f) === Infinity ? "unlimited" : `${fmt(fleetRange(s, f))} pc`}`)];
  const shipRows = f.ships.map((sh) => {
    const d = s.designs[sh.designId];
    const st = designStats(d, e);
    const cv = h("canvas", { width: 32, height: 30 });
    cv.getContext("2d")!.drawImage(shipImage(d, e.color, 48), 0, 0, 32, 30);
    const cb = h("input", { type: "checkbox", checked: splitPick.has(sh.id) }) as HTMLInputElement;
    cb.addEventListener("change", () => (cb.checked ? splitPick.add(sh.id) : splitPick.delete(sh.id)));
    const hpNow = sh.hp.structure + sh.hp.armor;
    const hpMax = st.structure + st.armor;
    const hp = hpNow < hpMax ? ` · ${Math.round((100 * hpNow) / Math.max(1, hpMax))}% hull` : "";
    return h("label", { class: "ship-line" }, cb, cv, h("span", null, `${sh.name} (${d.name}, ${HULLS[d.hull].name})`), h("span", { class: "muted" }, `att ${st.attack} · def ${st.defense} · shd ${st.shield}${hp}${sh.xp ? ` · xp ${sh.xp}` : ""}`));
  });
  parts.push(h("div", { class: "ships" }, ...shipRows));
  const actions: HTMLElement[] = [];
  if (dest) actions.push(button("Stop", () => { f.destStarId = null; app.refresh(); }));
  if (f.ships.length > 1)
    actions.push(button("Split selected", () => {
      if (!splitPick.size || splitPick.size === f.ships.length) return app.toast("Tick some (not all) ships to split off", "error");
      const nf = splitFleet(s, f.id, [...splitPick]);
      splitPick.clear();
      if (nf) app.sel.fleetId = nf.id;
      app.refresh();
    }));
  if (here) {
    const others = fleetsAt(s, here.id).filter((x) => x.owner === e.id && x.id !== f.id && x.destStarId === null);
    if (others.length && f.destStarId === null)
      actions.push(button("Merge fleets here", () => {
        for (const o of others) mergeFleets(s, f.id, o.id);
        app.refresh();
      }));
    for (const c of coloniesAt(s, here.id)) {
      if (c.owner === e.id || !atWar(s, e.id, c.owner)) continue;
      const blocked = orbitBlocked(s, f, c);
      const troops = fleetTroops(s, f);
      if (troops > 0)
        actions.push(button(`Invade ${colonyName(s, c)} (${troops} vs ~${garrison(c)})`, () => {
          const r = cmdInvade(s, f.id, c.id);
          if (typeof r === "string") app.toast(r, "error");
          else app.toast(r.success ? `Captured ${colonyName(s, c)}!` : `Invasion failed (${r.attackersLost} troops lost)`);
          if (!s.fleets[f.id]) app.sel.fleetId = null;
          app.refresh();
        }, { disabled: !!blocked, title: blocked ?? "", cls: "primary" }));
      if (fleetBombs(s, f) > 0)
        actions.push(button(`Bombard ${colonyName(s, c)}`, () => {
          app.toast(cmdBombard(s, f.id, c.id));
          app.refresh();
        }, { disabled: !!blocked, title: blocked ?? "" }));
    }
  }
  actions.push(button("Deselect", () => { app.sel.fleetId = null; splitPick.clear(); app.refresh(); }));
  parts.push(h("div", { class: "actions" }, ...actions));
  parts.push(h("p", { class: "hint" }, "Click a star on the map to send this fleet there. Systems out of fuel range are dimmed."));
  if (here) parts.push(starPanel(app, here));
  return h("div", { class: "panel-inner" }, ...parts);
}

export function galaxyScreen(app: App): HTMLElement {
  const s = app.game!;
  const meId = app.me.id;
  if (!cam || cam.gameId !== s.id) {
    const home = s.stars[app.me.capitalStarId];
    cam = { gameId: s.id, cx: home.x, cy: home.y, zoom: 14 };
  }
  const c = cam;
  const canvas = h("canvas", { class: "galaxy-canvas", "data-testid": "galaxy-canvas", tabindex: 0 }) as HTMLCanvasElement;
  const wrap = h("div", { class: "map-wrap" }, canvas);
  const selFleet = app.sel.fleetId !== null ? s.fleets[app.sel.fleetId] : undefined;
  if (app.sel.fleetId !== null && (!selFleet || selFleet.owner !== meId)) app.sel.fleetId = null;
  const panel = h("aside", { class: "side-panel", "data-testid": "side-panel" });
  if (selFleet && selFleet.owner === meId) panel.appendChild(fleetPanel(app, selFleet));
  else if (app.sel.starId !== null) panel.appendChild(starPanel(app, s.stars[app.sel.starId]));

  const toScreen = (x: number, y: number): [number, number] => [(x - c.cx) * c.zoom + canvas.width / 2, (y - c.cy) * c.zoom + canvas.height / 2];
  const toWorld = (px: number, py: number): [number, number] => [(px - canvas.width / 2) / c.zoom + c.cx, (py - canvas.height / 2) / c.zoom + c.cy];

  const fleetMarks: { f: Fleet; x: number; y: number }[] = [];
  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = "#03040a";
    ctx.fillRect(0, 0, W, H);
    // galaxy bounds
    const [bx0, by0] = toScreen(0, 0);
    const [bx1, by1] = toScreen(s.width, s.height);
    ctx.strokeStyle = "#1a2040";
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    // supply range shading when a fleet is selected
    const f = app.sel.fleetId !== null ? s.fleets[app.sel.fleetId] : undefined;
    const range = f ? fleetRange(s, f) : 0;
    // wormholes
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "#7040a0";
    for (const st of s.stars) {
      if (st.wormholeTo !== null && st.wormholeTo > st.id && (st.exploredBy.includes(meId) || s.stars[st.wormholeTo].exploredBy.includes(meId))) {
        const [ax, ay] = toScreen(st.x, st.y);
        const [cx2, cy2] = toScreen(s.stars[st.wormholeTo].x, s.stars[st.wormholeTo].y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(cx2, cy2);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const starPx = Math.max(3, Math.min(14, c.zoom * 0.45));
    ctx.textAlign = "center";
    ctx.font = `${Math.max(10, Math.min(14, c.zoom * 0.7))}px sans-serif`;
    for (const st of s.stars) {
      const [x, y] = toScreen(st.x, st.y);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      const dim = f && range !== Infinity && supplyDistance(s, app.me, st.x, st.y) > range;
      ctx.globalAlpha = dim ? 0.35 : 1;
      drawGalaxyStar(ctx, st, x, y, starPx);
      const explored = st.exploredBy.includes(meId);
      const owner = explored ? ownerOfStar(s, st.id) : null;
      ctx.fillStyle = owner !== null ? EMPIRE_COLORS[s.empires[owner].color] : explored ? "#c8cce0" : "#6a6e80";
      ctx.fillText(st.name, x, y + starPx * 2 + 10);
      ctx.globalAlpha = 1;
      if (app.sel.starId === st.id) {
        ctx.strokeStyle = "#ffffffaa";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, starPx * 2.2 + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // fleets
    fleetMarks.length = 0;
    const perStar = new Map<number, number>();
    for (const fl of Object.values(s.fleets)) {
      if (!fleetVisible(s, meId, fl)) continue;
      let x: number;
      let y: number;
      if (fl.starId !== null) {
        const k = perStar.get(fl.starId) ?? 0;
        perStar.set(fl.starId, k + 1);
        const st = s.stars[fl.starId];
        [x, y] = toScreen(st.x, st.y);
        x += starPx * 2 + 6 + (k % 3) * 9;
        y += -starPx - 2 + Math.floor(k / 3) * 9;
      } else [x, y] = toScreen(fl.x, fl.y);
      if (fl.destStarId !== null && fl.owner === meId) {
        const [dx, dy] = toScreen(s.stars[fl.destStarId].x, s.stars[fl.destStarId].y);
        ctx.strokeStyle = fl.id === app.sel.fleetId ? "#fff" : "#8a90b0";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(dx, dy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = fleetColor(s, fl);
      ctx.beginPath();
      ctx.moveTo(x + 5, y);
      ctx.lineTo(x - 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.closePath();
      ctx.fill();
      if (fl.id === app.sel.fleetId) {
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(x - 6, y - 6, 12, 12);
      }
      fleetMarks.push({ f: fl, x, y });
    }
  };

  const resize = () => {
    const r = wrap.getBoundingClientRect();
    canvas.width = Math.max(200, Math.floor(r.width));
    canvas.height = Math.max(200, Math.floor(r.height));
    draw();
  };
  new ResizeObserver(resize).observe(wrap);

  let drag: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener("pointerdown", (ev) => {
    drag = { x: ev.offsetX, y: ev.offsetY, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.offsetX - drag.x;
    const dy = ev.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    c.cx -= dx / c.zoom;
    c.cy -= dy / c.zoom;
    drag.x = ev.offsetX;
    drag.y = ev.offsetY;
    draw();
  });
  canvas.addEventListener("pointerup", (ev) => {
    const d = drag;
    drag = null;
    if (!d || d.moved) return;
    click(ev.offsetX, ev.offsetY);
  });
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const [wx, wy] = toWorld(ev.offsetX, ev.offsetY);
    c.zoom = Math.max(4, Math.min(60, c.zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const [nx, ny] = toWorld(ev.offsetX, ev.offsetY);
    c.cx += wx - nx;
    c.cy += wy - ny;
    draw();
  }, { passive: false });

  const click = (px: number, py: number) => {
    const hitFleet = fleetMarks.find((m) => Math.hypot(m.x - px, m.y - py) < 7 && m.f.owner === meId);
    let best: Star | null = null;
    let bd = 18;
    for (const st of s.stars) {
      const [x, y] = toScreen(st.x, st.y);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    const sf = app.sel.fleetId !== null ? s.fleets[app.sel.fleetId] : undefined;
    if (hitFleet && (!best || Math.hypot(hitFleet.x - px, hitFleet.y - py) < bd)) {
      app.sel.fleetId = hitFleet.f.id;
      splitPick.clear();
      app.refresh();
      return;
    }
    if (sf && best && best.id !== sf.starId) {
      if (!inRange(s, sf, best.id)) {
        app.toast(`${best.name} is beyond this fleet's fuel range`, "error");
        return;
      }
      const err = orderMove(s, sf.id, best.id);
      if (err) app.toast(err, "error");
      else app.toast(`${sf.name} → ${best.name}: ${etaTurns(s, sf, best.id)} turns`);
      app.refresh();
      return;
    }
    if (best) {
      app.sel.starId = best.id;
      if (sf && best.id === sf.starId) app.sel.fleetId = sf.id;
      else app.sel.fleetId = null;
    } else app.sel.fleetId = null;
    app.refresh();
  };

  const zoomBtns = h(
    "div",
    { class: "map-controls" },
    button("+", () => { c.zoom = Math.min(60, c.zoom * 1.3); draw(); }, { title: "Zoom in" }),
    button("−", () => { c.zoom = Math.max(4, c.zoom / 1.3); draw(); }, { title: "Zoom out" }),
    button("⌂", () => { const hs = s.stars[app.me.capitalStarId]; c.cx = hs.x; c.cy = hs.y; draw(); }, { title: "Centre on capital" }),
    button("▣", () => { c.cx = s.width / 2; c.cy = s.height / 2; c.zoom = Math.min(canvas.width / (s.width + 4), canvas.height / (s.height + 4)); draw(); }, { title: "Whole galaxy" }),
  );
  wrap.appendChild(zoomBtns);
  return h("div", { class: "galaxy" }, wrap, panel);
}

/** Used by other screens to jump to a star on the map. */
export function focusStar(app: App, starId: number): void {
  const st = app.game!.stars[starId];
  if (cam) {
    cam.cx = st.x;
    cam.cy = st.y;
  }
  app.sel.starId = starId;
  app.sel.fleetId = null;
  app.go("galaxy");
}
