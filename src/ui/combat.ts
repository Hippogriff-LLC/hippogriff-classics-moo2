// Tactical combat screen: the human commands their side unit by unit; the computer plays the other side.

import type { App } from "./app.ts";
import type { Battle, CombatUnit } from "../engine/combat.ts";
import { GRID_H, GRID_W, activeUnit, autoResolve, canFireAt, endActivation, fireAt, isHumanTurn, moveUnit, reachable, retreat, runAiUntilHuman } from "../engine/combat.ts";
import { WEAPON_BY_ID } from "../engine/data/ships.ts";
import { EMPIRE_COLORS } from "../engine/data/races.ts";
import { h, button } from "./dom.ts";
import { backdrop, drawStarDisc, shipImage } from "./art.ts";

const CELL = 44;

function sideName(app: App, b: Battle, side: 0 | 1): string {
  const o = b.owners[side];
  return o < 0 ? "Monsters" : app.game!.empires[o].name;
}

function unitColor(app: App, u: CombatUnit): string {
  return u.owner < 0 ? "#c050ff" : EMPIRE_COLORS[app.game!.empires[u.owner].color];
}

function drawBattle(app: App, b: Battle, ctx: CanvasRenderingContext2D, hover: { x: number; y: number } | null): void {
  const s = app.game!;
  const W = GRID_W * CELL;
  const H = GRID_H * CELL;
  ctx.drawImage(backdrop(W, H, "space", b.starId + 7), 0, 0);
  drawStarDisc(ctx, s.stars[b.starId], W - 30, 30, 60);
  ctx.strokeStyle = "rgba(120,160,255,0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= GRID_W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= GRID_H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(W, y * CELL + 0.5);
    ctx.stroke();
  }
  const act = activeUnit(b);
  const human = isHumanTurn(b);
  if (act && human) {
    ctx.fillStyle = "rgba(80,200,120,0.18)";
    for (const c of reachable(b, act)) ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
  }
  for (const u of b.units) {
    if (!u.alive || u.retreated) continue;
    const px = u.x * CELL;
    const py = u.y * CELL;
    if (act && human && u.side !== act.side && canFireAt(b, act, u)) {
      ctx.fillStyle = "rgba(230,60,60,0.28)";
      ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
    }
    if (u.kind === "defense") {
      ctx.fillStyle = unitColor(app, u);
      ctx.beginPath();
      ctx.arc(px + CELL / 2, py + CELL / 2, CELL * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    } else {
      const d = s.designs[u.designId!];
      const owner = u.owner < 0 ? 0 : s.empires[u.owner].color;
      const img = shipImage(d, owner, CELL);
      ctx.save();
      if (u.side === 1) {
        ctx.translate(px + CELL, py);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 2, 2, CELL - 4, CELL - 4);
      } else ctx.drawImage(img, px + 2, py + 2, CELL - 4, CELL - 4);
      ctx.restore();
    }
    // health bar and side marker
    const frac = (u.structure + u.armor) / Math.max(1, u.maxStructure + u.maxArmor);
    ctx.fillStyle = "#300";
    ctx.fillRect(px + 4, py + CELL - 6, CELL - 8, 3);
    ctx.fillStyle = frac > 0.5 ? "#4c4" : frac > 0.25 ? "#cc4" : "#c44";
    ctx.fillRect(px + 4, py + CELL - 6, (CELL - 8) * frac, 3);
    ctx.fillStyle = unitColor(app, u);
    ctx.fillRect(px + 2, py + 2, 5, 5);
    if (act && u.uid === act.uid) {
      ctx.strokeStyle = "#ffe060";
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
      ctx.lineWidth = 1;
    }
  }
  if (hover) {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.strokeRect(hover.x * CELL + 1.5, hover.y * CELL + 1.5, CELL - 3, CELL - 3);
  }
}

function unitInfo(u: CombatUnit | null, title: string): HTMLElement {
  if (!u) return h("div", { class: "unit-info muted" }, title);
  return h(
    "div",
    { class: "unit-info" },
    h("strong", null, u.name),
    h("div", null, `Structure ${Math.ceil(u.structure)}/${u.maxStructure} · Armor ${Math.ceil(u.armor)}/${u.maxArmor}`),
    h("div", null, `Shield ${u.shield} · Attack ${u.attack} · Defense ${u.defense} · Moves ${u.moves}/${u.speed}`),
    h(
      "ul",
      { class: "weapons" },
      ...u.weapons.map((w) => {
        const wd = WEAPON_BY_ID[w.weaponId];
        return h("li", { class: w.fired || w.ammo === 0 ? "muted" : "" }, `${w.count}× ${wd.name} (r${wd.range}${w.ammo >= 0 ? `, ${w.ammo} left` : ""})${w.fired ? " — fired" : ""}`);
      }),
    ),
  );
}

export function combatScreen(app: App): HTMLElement {
  const b = app.battle;
  if (!b) return h("div", { class: "page" }, h("p", null, "No battle in progress."), button("Back to galaxy", () => app.go("galaxy")));
  const s = app.game!;
  const canvas = h("canvas", { width: GRID_W * CELL, height: GRID_H * CELL, class: "battle-canvas", "data-testid": "battle-canvas" }) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  let hover: { x: number; y: number } | null = null;
  let hoverUnit: CombatUnit | null = null;
  const info = h("div", null);
  const logEl = h("div", { class: "battle-log", "data-testid": "battle-log" });
  const controls = h("div", { class: "row wrap" });
  const status = h("div", { class: "battle-status", "data-testid": "battle-status" });

  const update = () => {
    drawBattle(app, b, ctx, hover);
    const act = activeUnit(b);
    info.replaceChildren(unitInfo(act, "—"), unitInfo(hoverUnit && hoverUnit !== act ? hoverUnit : null, "Hover a unit for details."));
    logEl.replaceChildren(...b.log.slice(-40).map((l) => h("div", null, l)));
    logEl.scrollTop = logEl.scrollHeight;
    const alive = (side: 0 | 1) => b.units.filter((u) => u.side === side && u.alive && !u.retreated).length;
    status.textContent = b.over
      ? `Battle over: ${b.winnerSide === null ? "no decisive winner" : `${sideName(app, b, b.winnerSide)} ${b.winnerSide === b.humanSide ? "(you) " : ""}win`}.`
      : `Round ${b.round} · ${sideName(app, b, 0)} ${alive(0)} vs ${sideName(app, b, 1)} ${alive(1)} · ${isHumanTurn(b) ? `Your move: ${act?.name}` : "Enemy acting…"}`;
    if (b.over) {
      controls.replaceChildren(button("Continue", () => app.finishBattle(), { cls: "primary", testid: "battle-continue" }));
    } else {
      const acts = [
        button("End unit turn", () => { endActivation(b); runAiUntilHuman(b); update(); }, { cls: "primary", testid: "battle-next", title: "Space" }),
        button("Auto-resolve", () => { autoResolve(b); update(); }, { testid: "battle-autoresolve" }),
        b.humanSide !== null ? button("Retreat", () => app.confirm("Retreat", "Withdraw all your ships from this battle? Bases stay and fight on.", () => { retreat(b, b.humanSide!); runAiUntilHuman(b); update(); }, "Retreat"), { cls: "danger", testid: "battle-retreat" }) : null,
      ];
      controls.replaceChildren(...acts.filter((x): x is HTMLButtonElement => x !== null));
    }
  };
  const cellAt = (ev: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - r.left) / r.width) * GRID_W);
    const y = Math.floor(((ev.clientY - r.top) / r.height) * GRID_H);
    return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H ? { x, y } : null;
  };
  canvas.addEventListener("mousemove", (ev) => {
    hover = cellAt(ev);
    hoverUnit = hover ? b.units.find((u) => u.alive && !u.retreated && u.x === hover!.x && u.y === hover!.y) ?? null : null;
    update();
  });
  canvas.addEventListener("click", (ev) => {
    const c = cellAt(ev);
    const act = activeUnit(b);
    if (!c || !act || !isHumanTurn(b)) return;
    const target = b.units.find((u) => u.alive && !u.retreated && u.x === c.x && u.y === c.y);
    let err: string | null;
    if (target && target.side !== act.side) err = fireAt(b, act.uid, target.uid);
    else if (!target) err = moveUnit(b, act.uid, c.x, c.y);
    else err = target.uid === act.uid ? null : "occupied by a friendly unit";
    if (err) app.toast(err, "error");
    // auto-advance once the unit has nothing left to do
    if (!b.over && act.moves === 0 && !b.units.some((t) => canFireAt(b, act, t))) {
      endActivation(b);
      runAiUntilHuman(b);
    }
    update();
  });
  const onKey = (ev: KeyboardEvent) => {
    if (!canvas.isConnected) return document.removeEventListener("keydown", onKey);
    if (ev.key === " " && !b.over && isHumanTurn(b)) {
      ev.preventDefault();
      endActivation(b);
      runAiUntilHuman(b);
      update();
    }
  };
  document.addEventListener("keydown", onKey);
  update();
  const where = s.stars[b.starId].name;
  return h(
    "div",
    { class: "page wide combat" },
    h("h1", null, `Battle at ${where}`),
    status,
    h("div", { class: "combat-layout" }, h("div", { class: "battle-wrap" }, canvas), h("div", { class: "combat-side" }, info, controls, logEl)),
    h("p", { class: "muted" }, "Click a green square to move the highlighted ship, click a red-tinted enemy to fire every weapon that reaches it. Space ends the unit's turn. Distance uses the larger of the horizontal and vertical offsets."),
  );
}
