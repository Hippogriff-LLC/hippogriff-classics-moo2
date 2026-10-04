// Browser entry point: load any imported original data, register screens and show the main menu.

import { App } from "./ui/app.ts";
import type { Screen } from "./ui/app.ts";
import { assets } from "./import/assets.ts";
import { resetArt } from "./ui/art.ts";
import { aboutScreen, gameOverScreen, importScreen, menuScreen, newGameScreen, savesScreen } from "./ui/menus.ts";
import { galaxyScreen } from "./ui/galaxy.ts";
import { colonyScreen, coloniesScreen } from "./ui/colony.ts";
import { researchScreen } from "./ui/research.ts";
import { designScreen } from "./ui/design.ts";
import { fleetsScreen, infoScreen, racesScreen } from "./ui/empire.ts";
import { combatScreen } from "./ui/combat.ts";

const KEYS: Record<string, Screen> = { g: "galaxy", c: "colonies", r: "research", d: "design", f: "fleets", a: "races", i: "info" };

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  const app = new App(root);
  Object.assign(app.screens, {
    menu: menuScreen,
    import: importScreen,
    newgame: newGameScreen,
    saves: savesScreen,
    about: aboutScreen,
    gameover: gameOverScreen,
    galaxy: galaxyScreen,
    colonies: coloniesScreen,
    colony: colonyScreen,
    research: researchScreen,
    design: designScreen,
    fleets: fleetsScreen,
    races: racesScreen,
    info: infoScreen,
    combat: combatScreen,
  });
  try {
    await assets.load();
  } catch (err) {
    console.warn("Imported data unavailable:", (err as Error).message);
  }
  resetArt();
  document.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (!app.game || app.game.winner || app.screen === "combat" || document.querySelector(".modal")) return;
    const k = ev.key.toLowerCase();
    if (KEYS[k] && app.screen !== "menu" && app.screen !== "newgame") {
      app.go(KEYS[k]);
    } else if (k === "enter" && ev.shiftKey) {
      app.endTurnClicked();
    }
  });
  app.go("menu");
  root.dataset.ready = "1";
  (window as unknown as { hippogriff: App }).hippogriff = app;
}

void boot();
