// Out-of-game screens: main menu, original-data import, new game, save/load, about, game over.

import type { App } from "./app.ts";
import type { GameSettings } from "../engine/types.ts";
import { newGame, DEFAULT_SETTINGS } from "../engine/newgame.ts";
import { RACES, EMPIRE_COLORS, EMPIRE_COLOR_NAMES, race } from "../engine/data/races.ts";
import type { RaceDef } from "../engine/data/races.ts";
import { empireSummary } from "../engine/economy.ts";
import { assets } from "../import/assets.ts";
import { forgetInstallation, importInstallation, sourcesFromDevServer, sourcesFromDirectoryHandle, sourcesFromFileList, REQUIRED_FILES } from "../import/install.ts";
import type { SourceFile } from "../import/install.ts";
import { h, button, select, fmt } from "./dom.ts";
import { backdrop, portrait, resetArt } from "./art.ts";
import { AUTOSAVE, deleteSave, downloadSave, listSaves, readSave, readSaveFile, writeSave } from "./saves.ts";

function hero(kind: "title" | "space", seed = 1): HTMLElement {
  const c = backdrop(640, 480, kind, seed);
  const img = h("canvas", { class: "backdrop", width: c.width, height: c.height });
  img.getContext("2d")!.drawImage(c, 0, 0);
  return img;
}

export function menuScreen(app: App): HTMLElement {
  const cont = button("Continue", async () => {
    try {
      app.startGame(await readSave(AUTOSAVE));
    } catch {
      app.toast("No autosave found", "error");
    }
  }, { testid: "menu-continue" });
  const el = h(
    "div",
    { class: "menu" },
    hero("title"),
    h(
      "div",
      { class: "menu-panel" },
      h("h1", null, "Hippogriff Classics · MOO2"),
      h("p", { class: "muted" }, "Browser-native strategy engine. Original game data is optional and only ever read from your own installation."),
      app.game && !app.game.winner ? button("Return to Game", () => app.go("galaxy"), { cls: "primary", testid: "menu-return" }) : null,
      cont,
      button("New Game", () => app.go("newgame"), { cls: app.game ? "" : "primary", testid: "menu-new" }),
      button("Load Game", () => {
        app.back = "menu";
        app.go("saves");
      }, { testid: "menu-load" }),
      button("Import Original Data", () => app.go("import"), { testid: "menu-import" }),
      button("About", () => app.go("about"), { testid: "menu-about" }),
      h("p", { class: "status", "data-testid": "asset-status" }, app.importedLabel()),
    ),
  );
  void listSaves().then((l) => {
    const a = l.find((x) => x.slot === AUTOSAVE);
    cont.disabled = !a?.header;
    if (a?.header) cont.title = `${a.header.empire} — turn ${a.header.turn}`;
  });
  cont.disabled = true;
  return el;
}

// Messages from the last import survive the screen re-render that follows a successful import.
let importMessages: [string, string][] = [];

export function importScreen(app: App): HTMLElement {
  const log = h("div", { class: "import-log", "data-testid": "import-log" });
  const say = (t: string, cls = "") => {
    importMessages.push([t, cls]);
    log.appendChild(h("div", { class: cls }, t));
  };
  for (const [t, cls] of importMessages) log.appendChild(h("div", { class: cls }, t));
  const run = async (sources: SourceFile[] | null, source: "folder" | "dev") => {
    log.textContent = "";
    importMessages = [];
    if (!sources || !sources.length) {
      say("No files selected.", "bad");
      return;
    }
    say(`Scanning ${sources.length} files…`);
    const bar = h("progress", { max: REQUIRED_FILES.length, value: 0 });
    log.appendChild(bar);
    try {
      const rep = await importInstallation(sources, source, (d, _t, name) => {
        bar.value = d;
        if (name) bar.title = name;
      });
      if (!rep.ok) {
        if (rep.missing.length) say(`Missing: ${rep.missing.join(", ")}`, "bad");
        for (const e of rep.errors) say(e, "bad");
        return;
      }
      await assets.load();
      resetArt();
      say(`Imported ${rep.info!.files.length} archives${rep.info!.version ? ` (version ${rep.info!.version})` : ""}. Stored only in this browser.`, "good");
      say(`Decoded ${assets.starNames.length} star names, ${assets.shipNames.length} ship names, ${assets.techNames.length} technology names.`);
      app.refresh();
    } catch (err) {
      say(`Import failed: ${(err as Error).message}`, "bad");
    }
  };
  const fileInput = h("input", { type: "file", webkitdirectory: true, directory: true, multiple: true, hidden: true, "data-testid": "import-input" }) as HTMLInputElement;
  fileInput.addEventListener("change", () => void run(fileInput.files ? sourcesFromFileList(fileInput.files) : null, "folder"));
  const pick = async () => {
    const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> };
    if (w.showDirectoryPicker) {
      try {
        const dir = await w.showDirectoryPicker({ mode: "read" });
        await run(await sourcesFromDirectoryHandle(dir), "folder");
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    fileInput.click();
  };
  const devBtn = button("Use development installation", async () => run(await sourcesFromDevServer(), "dev"), { testid: "import-dev" });
  devBtn.hidden = true;
  void sourcesFromDevServer().then((s) => (devBtn.hidden = !s));
  const info = assets.info;
  const sample = h("div", { class: "asset-preview" });
  if (assets.available) {
    for (let i = 0; i < 13; i++) {
      const c = portrait(RACES[i].id);
      const cv = h("canvas", { width: 58, height: 64, title: RACES[i].name });
      cv.getContext("2d")!.drawImage(c, 0, 0, 58, 64);
      sample.appendChild(cv);
    }
  }
  return h(
    "div",
    { class: "page" },
    h("h1", null, "Import original data"),
    h("p", null, "If you own Master of Orion II, select your installation folder (the one containing the .LBX archives). The archives the client uses are validated and stored in this browser's IndexedDB. Nothing is uploaded and nothing is bundled with this application."),
    h("p", { class: "muted" }, `Required archives: ${REQUIRED_FILES.join(", ")}.`),
    h("div", { class: "row" }, button("Choose installation folder…", () => void pick(), { cls: "primary", testid: "import-pick" }), devBtn, fileInput),
    h("p", { class: "status", "data-testid": "import-status" }, info ? `Currently imported: version ${info.version ?? "unknown"}, ${info.files.length} archives, ${new Date(info.importedAt).toLocaleString()} (${info.source}).` : "Nothing imported. The game uses built-in procedural artwork and names."),
    sample,
    log,
    h(
      "div",
      { class: "row" },
      info ? button("Forget imported data", async () => {
        await forgetInstallation();
        assets.unload();
        resetArt();
        app.refresh();
      }) : null,
      button("Back", () => {
        importMessages = [];
        app.go("menu");
      }),
    ),
  );
}

const SIZES: [GameSettings["galaxySize"], string][] = [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["huge", "Huge"]];
const AGES: [GameSettings["galaxyAge"], string][] = [["young", "Young (mineral rich)"], ["average", "Average"], ["old", "Old (more habitable)"]];
const DIFFS: [GameSettings["difficulty"], string][] = [["tutor", "Tutor"], ["easy", "Easy"], ["average", "Average"], ["hard", "Hard"], ["impossible", "Impossible"]];

function traitList(r: RaceDef): string[] {
  const t = r.traits;
  const out: string[] = [];
  const add = (v: number, name: string, unit = "") => {
    if (v) out.push(`${v > 0 ? "+" : ""}${v}${unit} ${name}`);
  };
  add(t.food, "food");
  add(t.industry, "industry");
  add(t.research, "research");
  add(t.money, "BC/pop");
  add(t.growth * 100, "% growth");
  add(t.shipAttack, "ship attack");
  add(t.shipDefense, "ship defense");
  add(t.ground, "ground combat");
  add(t.spying, "spying");
  if (t.gravity !== "normal") out.push(`${t.gravity}-G world`);
  for (const k of ["aquatic", "subterranean", "lithovore", "telepathic", "tolerant", "creative", "uncreative", "charismatic", "repulsive", "lucky", "cybernetic", "omniscient", "stealthy", "warlord", "artifacts"] as const) if (t[k]) out.push(k);
  out.push(t.government);
  return out;
}

export function newGameScreen(app: App): HTMLElement {
  const st: GameSettings = { ...DEFAULT_SETTINGS };
  let seed = (Math.random() * 0x7fffffff) | 0;
  const raceGrid = h("div", { class: "race-grid", "data-testid": "race-grid" });
  const detail = h("div", { class: "race-detail" });
  const drawRaces = () => {
    raceGrid.textContent = "";
    for (const r of RACES) {
      const c = portrait(r.id);
      const cv = h("canvas", { width: 72, height: 80 });
      cv.getContext("2d")!.drawImage(c, 0, 0, 72, 80);
      raceGrid.appendChild(
        h("button", { class: `race-card ${st.playerRace === r.id ? "active" : ""}`, "data-testid": `race-${r.id}`, onclick: () => { st.playerRace = r.id; drawRaces(); } }, cv, h("span", null, r.name)),
      );
    }
    const r = race(st.playerRace);
    detail.textContent = "";
    detail.appendChild(h("h3", null, r.name));
    detail.appendChild(h("p", null, traitList(r).join(" · ")));
  };
  drawRaces();
  const nameInput = h("input", { value: st.playerName, maxlength: 20 }) as HTMLInputElement;
  const seedInput = h("input", { value: String(seed), inputmode: "numeric", "data-testid": "seed" }) as HTMLInputElement;
  const events = h("input", { type: "checkbox", checked: st.events }) as HTMLInputElement;
  const colors = select(st.playerColor, EMPIRE_COLORS.map((_, i) => [i, EMPIRE_COLOR_NAMES[i]] as [number, string]), (v) => (st.playerColor = v));
  const start = () => {
    st.playerName = nameInput.value.trim() || "Commander";
    st.events = events.checked;
    seed = Number(seedInput.value) >>> 0;
    const importedNames = assets.available ? { stars: assets.starNames, ships: assets.shipNames } : undefined;
    app.startGame(newGame({ settings: st, seed, importedNames }));
  };
  return h(
    "div",
    { class: "page newgame" },
    h("h1", null, "New Game"),
    h("div", { class: "cols" }, h("div", null, h("h3", null, "Choose your race"), raceGrid, detail), h(
      "div",
      { class: "form" },
      h("label", null, "Leader name", nameInput),
      h("label", null, "Banner colour", colors),
      h("label", null, "Galaxy size", select(st.galaxySize, SIZES, (v) => (st.galaxySize = v), { "data-testid": "galaxy-size" })),
      h("label", null, "Galaxy age", select(st.galaxyAge, AGES, (v) => (st.galaxyAge = v))),
      h("label", null, "Opponents", select(st.opponents, [1, 2, 3, 4, 5, 6, 7].map((n) => [n, String(n)] as [number, string]), (v) => (st.opponents = v))),
      h("label", null, "Difficulty", select(st.difficulty, DIFFS, (v) => (st.difficulty = v))),
      h("label", { class: "check" }, events, "Random events"),
      h("label", null, "Seed", seedInput),
      h("p", { class: "muted" }, assets.available ? "Star and ship names come from your imported data." : "Names are generated procedurally."),
      h("div", { class: "row" }, button("Back", () => app.go("menu")), button("Start Game", start, { cls: "primary", testid: "start-game" })),
    )),
  );
}

export function savesScreen(app: App): HTMLElement {
  const list = h("div", { class: "save-list", "data-testid": "save-list" }, "Loading…");
  const labelInput = h("input", { placeholder: "Save label", maxlength: 40 }) as HTMLInputElement;
  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true }) as HTMLInputElement;
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      app.startGame(await readSaveFile(f));
      app.toast("Save imported");
    } catch (err) {
      app.toast(`Could not load file: ${(err as Error).message}`, "error");
    }
  });
  const load = async () => {
    const slots = await listSaves();
    list.textContent = "";
    for (const sl of slots) {
      const hd = sl.header;
      list.appendChild(
        h(
          "div",
          { class: "save-row" },
          h("strong", null, sl.slot === AUTOSAVE ? "Autosave" : sl.slot.replace("slot", "Slot ")),
          h("span", null, hd ? `${hd.label} — ${hd.empire}, turn ${hd.turn} (${new Date(hd.savedAt).toLocaleString()})` : sl.error ? `Unreadable: ${sl.error}` : "Empty"),
          app.game && sl.slot !== AUTOSAVE
            ? button("Save here", async () => {
                await writeSave(sl.slot, app.game!, labelInput.value.trim() || `Turn ${app.game!.turn}`);
                app.toast("Game saved");
                void load();
              }, { testid: `save-${sl.slot}` })
            : null,
          hd ? button("Load", async () => {
            try {
              app.startGame(await readSave(sl.slot));
              app.toast("Game loaded");
            } catch (err) {
              app.toast(`Load failed: ${(err as Error).message}`, "error");
            }
          }, { testid: `load-${sl.slot}` }) : null,
          hd && sl.slot !== AUTOSAVE ? button("Delete", async () => {
            await deleteSave(sl.slot);
            void load();
          }) : null,
        ),
      );
    }
  };
  void load();
  return h(
    "div",
    { class: "page" },
    h("h1", null, "Save / Load"),
    app.game ? h("div", { class: "row" }, labelInput, button("Export to file", () => downloadSave(app.game!, labelInput.value.trim()))) : null,
    list,
    h("div", { class: "row" }, button("Import from file…", () => fileInput.click()), fileInput, button("Back", () => app.go(app.game && app.back !== "menu" ? app.back : "menu"))),
  );
}

export function aboutScreen(app: App): HTMLElement {
  return h(
    "div",
    { class: "page" },
    h("h1", null, "About"),
    h("p", null, "Hippogriff Classics MOO2 is an independent, browser-native reimplementation of the strategy game Master of Orion II. The simulation, rendering and asset cache all run in your browser."),
    h("p", null, "The project's own source code is licensed under Apache-2.0. That licence does not cover Master of Orion II, its data, artwork, text or other original content, none of which is distributed with this application. If you own the game you may import your installation locally to use its artwork and names."),
    h("p", null, "Game rules are reconstructed approximations; see docs/research/RULES.md in the repository."),
    h("p", { class: "muted" }, app.importedLabel()),
    button("Back", () => app.go("menu")),
  );
}

export function gameOverScreen(app: App): HTMLElement {
  const s = app.game!;
  const w = s.winner;
  const me = app.me;
  const won = w && w.empire === me.id && w.kind !== "defeat";
  const title = !w ? "Game over" : won ? (w.kind === "council" ? "Elected High Master!" : "Total victory!") : w.kind === "defeat" ? "Defeat" : `${s.empires[w.empire].name} wins`;
  const rows = s.empires.map((e) => {
    const m = empireSummary(s, e);
    return h("tr", null, h("td", null, e.name), h("td", null, e.alive ? "alive" : `eliminated turn ${e.eliminatedTurn}`), h("td", null, String(m.colonies)), h("td", null, fmt(m.population)), h("td", null, String(e.techs.length)));
  });
  return h(
    "div",
    { class: "page gameover", "data-testid": "game-over" },
    h("h1", null, title),
    h("p", null, `Turn ${s.turn}. ${s.council.lastResult ? s.council.lastResult.split("\n")[0] : ""}`),
    h("table", { class: "grid" }, h("tr", null, h("th", null, "Empire"), h("th", null, "Status"), h("th", null, "Colonies"), h("th", null, "Pop"), h("th", null, "Techs")), ...rows),
    h("div", { class: "row" }, button("Main Menu", () => app.go("menu"), { cls: "primary" }), button("New Game", () => app.go("newgame"))),
  );
}
