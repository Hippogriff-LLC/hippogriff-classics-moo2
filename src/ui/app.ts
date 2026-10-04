// Application shell: screen routing, top bar, modals and the end-of-turn flow.

import type { Battle } from "../engine/combat.ts";
import { runAiUntilHuman } from "../engine/combat.ts";
import type { Empire, GameState } from "../engine/types.ts";
import { autoResolvePending, concludeBattle, endTurn, startPendingBattle } from "../engine/turn.ts";
import { empireSummary } from "../engine/economy.ts";
import { availableTopics, currentTopic, topicCost } from "../engine/research.ts";
import { techName } from "../engine/data/techs.ts";
import { colonyName, humanEmpire, stardate } from "../engine/state.ts";
import { respondToProposal } from "../engine/diplomacy.ts";
import { councilDecision } from "../engine/events.ts";
import { EMPIRE_COLORS } from "../engine/data/races.ts";
import { assets } from "../import/assets.ts";
import { h, button, clear, fmt, signed } from "./dom.ts";
import { AUTOSAVE, writeSave } from "./saves.ts";

export type Screen = "menu" | "import" | "newgame" | "saves" | "about" | "galaxy" | "colonies" | "colony" | "research" | "design" | "fleets" | "races" | "info" | "combat" | "gameover";

export type ScreenFn = (app: App) => HTMLElement;

export interface Selection {
  starId: number | null;
  fleetId: number | null;
}

const IN_GAME: Screen[] = ["galaxy", "colonies", "colony", "research", "design", "fleets", "races", "info"];

export class App {
  root: HTMLElement;
  screens: Partial<Record<Screen, ScreenFn>> = {};
  screen: Screen = "menu";
  game: GameState | null = null;
  sel: Selection = { starId: null, fleetId: null };
  colonyId: number | null = null;
  battle: Battle | null = null;
  private modals: HTMLElement[] = [];
  private toastTimer = 0;
  /** screen to return to from sub-screens */
  back: Screen = "galaxy";
  busy = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  get me(): Empire {
    return humanEmpire(this.game!)!;
  }

  go(screen: Screen): void {
    if (IN_GAME.includes(screen) && this.game?.winner) screen = "gameover";
    this.screen = screen;
    this.closeAllModals();
    this.render();
  }

  render(): void {
    const scroll = this.root.querySelector(".screen")?.scrollTop ?? 0;
    clear(this.root);
    const fn = this.screens[this.screen];
    const inGame = this.game && IN_GAME.includes(this.screen);
    if (inGame) this.root.appendChild(this.topBar());
    const body = fn ? fn(this) : h("div", null, `missing screen ${this.screen}`);
    body.classList.add("screen", `screen-${this.screen}`);
    this.root.appendChild(body);
    body.scrollTop = scroll;
    for (const m of this.modals) this.root.appendChild(m);
    this.root.dataset.screen = this.screen;
  }

  /** Re-render the current screen in place (after a state change). */
  refresh(): void {
    this.render();
  }

  toast(text: string, kind: "info" | "error" = "info"): void {
    let t = document.getElementById("toast");
    if (!t) {
      t = h("div", { id: "toast", role: "status" });
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = `show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t!.classList.remove("show"), 3200);
  }

  modal(title: string, content: HTMLElement | (HTMLElement | string)[], actions: HTMLElement[] = [], opts: { wide?: boolean; testid?: string } = {}): HTMLElement {
    const m = h(
      "div",
      { class: "modal-backdrop", "data-testid": opts.testid ?? "modal" },
      h("div", { class: `modal ${opts.wide ? "wide" : ""}`, role: "dialog", "aria-label": title }, h("h2", null, title), h("div", { class: "modal-body" }, ...(Array.isArray(content) ? content : [content])), h("div", { class: "modal-actions" }, ...actions)),
    );
    this.modals.push(m);
    this.root.appendChild(m);
    return m;
  }

  closeModal(m: HTMLElement): void {
    this.modals = this.modals.filter((x) => x !== m);
    m.remove();
  }

  closeAllModals(): void {
    for (const m of this.modals) m.remove();
    this.modals = [];
  }

  confirm(title: string, text: string, onYes: () => void, yesLabel = "OK"): void {
    const m = this.modal(title, h("p", null, text), [
      button("Cancel", () => this.closeModal(m)),
      button(yesLabel, () => {
        this.closeModal(m);
        onYes();
      }, { cls: "primary" }),
    ]);
  }

  startGame(s: GameState): void {
    this.game = s;
    this.battle = null;
    this.sel = { starId: this.me.capitalStarId, fleetId: null };
    this.colonyId = null;
    this.go(s.winner ? "gameover" : "galaxy");
    if (s.phase === "battles") this.showBattles();
    else this.startOfTurn();
  }

  private topBar(): HTMLElement {
    const s = this.game!;
    const e = this.me;
    const m = empireSummary(s, e);
    const t = currentTopic(e);
    const tcost = t ? topicCost(s, e, t) : 0;
    const nav = (label: string, screen: Screen, key: string) =>
      button(label, () => this.go(screen), { cls: this.screen === screen || (screen === "colonies" && this.screen === "colony") ? "nav active" : "nav", title: `${label} (${key})`, testid: `nav-${screen}` });
    return h(
      "header",
      { class: "topbar" },
      h("div", { class: "empire-chip", style: `border-color:${EMPIRE_COLORS[e.color]}` }, h("strong", null, e.name), h("span", null, `Stardate ${stardate(s.turn)} · Turn ${s.turn}`)),
      h(
        "div",
        { class: "stats" },
        h("span", { title: "Treasury (net income per turn)", "data-testid": "stat-bc" }, `💰 ${fmt(e.bc)} BC (${signed(m.net, 1)})`),
        h("span", { title: "Food produced / needed", class: m.food < m.foodNeed ? "bad" : "" }, `🌾 ${fmt(m.food)}/${fmt(m.foodNeed)}`),
        h("span", { title: "Industry" }, `⚙ ${fmt(m.industry)}`),
        h("span", { title: "Research" }, `🔬 ${fmt(m.research)} ${t ? `→ ${techName(e.research.targetTech!)} ${fmt(Math.min(100, (100 * e.research.progress) / tcost))}%` : "(no project)"}`),
        h("span", { title: "Command points used / available", class: m.commandUsed > m.commandMax ? "bad" : "" }, `⚑ ${m.commandUsed}/${m.commandMax}`),
        h("span", { title: "Population" }, `👥 ${fmt(m.population)}M`),
      ),
      h(
        "nav",
        null,
        nav("Galaxy", "galaxy", "G"),
        nav("Colonies", "colonies", "C"),
        nav("Research", "research", "R"),
        nav("Design", "design", "D"),
        nav("Fleets", "fleets", "F"),
        nav("Races", "races", "A"),
        nav("Info", "info", "I"),
        button("Game", () => this.gameMenu(), { cls: "nav", testid: "nav-game" }),
        button(s.phase === "battles" ? "Battles…" : "End Turn", () => this.endTurnClicked(), { cls: "primary end-turn", testid: "end-turn", disabled: this.busy }),
      ),
    );
  }

  gameMenu(): void {
    const m = this.modal("Game", h("p", null, "Your game is autosaved at the start of every turn."), [
      button("Save / Load", () => {
        this.closeModal(m);
        this.back = this.screen;
        this.go("saves");
      }, { testid: "menu-saves" }),
      button("Main Menu", () => {
        this.closeModal(m);
        this.go("menu");
      }),
      button("Close", () => this.closeModal(m), { cls: "primary" }),
    ]);
  }

  endTurnClicked(): void {
    const s = this.game!;
    if (this.busy || s.winner) return;
    if (s.phase === "battles") {
      this.showBattles();
      return;
    }
    if (!this.me.research.targetTech && this.anyResearchAvailable()) {
      this.confirm("No research project", "You have not chosen a research project; research points will accumulate unused (up to a cap). End the turn anyway?", () => this.doEndTurn(), "End Turn");
      return;
    }
    this.doEndTurn();
  }

  private anyResearchAvailable(): boolean {
    return availableTopics(this.me).length > 0;
  }

  private doEndTurn(): void {
    const s = this.game!;
    this.busy = true;
    const turnBefore = s.turn;
    try {
      const r = endTurn(s);
      this.busy = false;
      if (r.phase === "battles") {
        this.render();
        this.showBattles();
        return;
      }
      this.afterTurn(turnBefore);
    } catch (err) {
      this.busy = false;
      console.error(err);
      this.toast(`Turn processing failed: ${(err as Error).message}`, "error");
    }
  }

  /** Pending battles involving the player: fight tactically or auto-resolve. */
  showBattles(): void {
    const s = this.game!;
    if (!s.pendingBattles.length) {
      const turnBefore = s.turn;
      endTurn(s);
      this.afterTurn(turnBefore);
      return;
    }
    const meId = this.me.id;
    const rows = s.pendingBattles.map((pb) => {
      const enemy = pb.attacker === meId ? pb.defender : pb.attacker;
      const enemyName = enemy < 0 ? "Space monsters" : s.empires[enemy].name;
      const where = s.stars[pb.starId].name;
      const role = pb.attacker === meId ? "We attack" : "We are attacked by";
      return h(
        "div",
        { class: "battle-row" },
        h("span", null, `${where}: ${role} ${enemyName}`),
        button("Command", () => {
          this.closeAllModals();
          const b = startPendingBattle(s, pb.id);
          if (!b) {
            this.showBattles();
            return;
          }
          runAiUntilHuman(b);
          this.battle = b;
          this.go("combat");
        }, { cls: "primary", testid: "battle-command" }),
        button("Auto-resolve", () => {
          this.closeAllModals();
          const b = autoResolvePending(s, pb.id);
          if (b) this.toast(b.log[b.log.length - 1] ?? "Battle resolved");
          this.showBattles();
        }, { testid: "battle-auto" }),
      );
    });
    this.modal("Combat!", rows, [
      button("Auto-resolve all", () => {
        this.closeAllModals();
        for (const pb of [...s.pendingBattles]) autoResolvePending(s, pb.id);
        this.showBattles();
      }, { testid: "battle-auto-all" }),
    ], { testid: "battles-modal" });
  }

  /** Called by the combat screen when the player leaves a finished (or abandoned) battle. */
  finishBattle(): void {
    const s = this.game!;
    if (this.battle) concludeBattle(s, this.battle);
    this.battle = null;
    this.go("galaxy");
    this.showBattles();
  }

  private afterTurn(turnBefore: number): void {
    const s = this.game!;
    this.sel.fleetId = this.sel.fleetId !== null && s.fleets[this.sel.fleetId] ? this.sel.fleetId : null;
    void writeSave(AUTOSAVE, s, `Autosave turn ${s.turn}`).catch(() => this.toast("Autosave failed", "error"));
    if (s.winner) {
      this.go("gameover");
      return;
    }
    this.render();
    const news = s.messages.filter((x) => x.empire === this.me.id && x.turn >= turnBefore);
    if (news.length) {
      const list = h("ul", { class: "news" }, ...news.map((n) => h("li", { class: `msg-${n.kind}` }, n.text)));
      const m = this.modal(`Turn ${turnBefore} report`, list, [
        button("Continue", () => {
          this.closeModal(m);
          this.startOfTurn();
        }, { cls: "primary", testid: "report-continue" }),
      ], { testid: "turn-report" });
    } else this.startOfTurn();
  }

  /** Prompts that must be handled at the start of the player's turn. */
  startOfTurn(): void {
    const s = this.game!;
    if (s.council.pendingDecision) {
      const w = s.empires[s.council.pendingDecision.winner];
      const m = this.modal("The Galactic Council", [h("pre", { class: "council" }, s.council.lastResult ?? ""), h("p", null, `${w.name} has been elected High Master. Accept the Council's decision (you lose), or defy it and face war with the galaxy?`)], [
        button("Defy the Council", () => {
          this.closeModal(m);
          councilDecision(s, false);
          this.render();
          this.startOfTurn();
        }),
        button("Accept", () => {
          this.closeModal(m);
          councilDecision(s, true);
          this.go("gameover");
        }, { cls: "primary" }),
      ]);
      return;
    }
    const prop = s.proposals.find((p) => p.to === this.me.id);
    if (prop) {
      const from = s.empires[prop.from];
      const what: Record<string, string> = {
        peace: "a peace treaty",
        nap: "a non-aggression pact",
        alliance: "an alliance",
        trade: "a trade agreement",
        research: "a research agreement",
        tribute: `a tribute of ${prop.amount ?? 0} BC`,
      };
      const m = this.modal(`Message from the ${from.name}`, h("p", null, `${from.leaderName} of the ${from.name} proposes ${what[prop.kind]}.`), [
        button("Reject", () => {
          this.closeModal(m);
          respondToProposal(s, prop.id, false);
          this.render();
          this.startOfTurn();
        }),
        button("Accept", () => {
          this.closeModal(m);
          respondToProposal(s, prop.id, true);
          this.render();
          this.startOfTurn();
        }, { cls: "primary" }),
      ], { testid: "proposal" });
      return;
    }
    if (!this.me.research.targetTech && s.turn > 1 && this.screen === "galaxy") {
      this.toast("Choose a new research project (Research screen).");
    }
  }

  describeColony(id: number): string {
    const c = this.game!.colonies[id];
    return c ? colonyName(this.game!, c) : "?";
  }

  importedLabel(): string {
    return assets.available ? `Original data v${assets.info?.version ?? "?"} (imported)` : "Built-in artwork (no original data imported)";
  }
}
