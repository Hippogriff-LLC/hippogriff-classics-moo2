// Page shell for the port: collects the user's installation and their private build of the recompiled
// program, starts the worker that runs it, forwards keyboard and mouse input, and draws its frames.
//
// Nothing proprietary ships with the page. The user supplies their own Master of Orion II folder and a
// moo2.wasm built from their own Orion2.exe (see docs/research/RECOMPILATION.md); both stay in this
// browser's IndexedDB. A development server started with --dev-install/--dev-build can provide them too.
//
// Independently authored; Apache-2.0.

import { createFrameBuffer, createInputBuffer, FrameReader, InputWriter, scanBytes } from "./input.ts";
import { BUILD, GAME, SAVES, getAll, put, remove, replaceAll } from "./store.ts";
import type { GameSource, StartMessage, WorkerMessage } from "./worker.ts";

const BUILD_FILES = ["moo2.wasm", "image.bin", "entry.txt"] as const;
type State = "setup" | "loading" | "running" | "exited" | "error";

interface Status {
  state: State;
  frames: number;
  guestMs: number;
  width: number;
  height: number;
  log: string[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

const fmtMb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const baseName = (f: File) => f.name.toUpperCase();
const depth = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split("/").length;

/** Top-level files of a picked folder (the shallowest file for each name). */
function topLevel(files: FileList): File[] {
  const all = Array.from(files);
  const min = Math.min(...all.map(depth));
  const best = new Map<string, File>();
  for (const f of all) if (depth(f) === min && !best.has(baseName(f))) best.set(baseName(f), f);
  return [...best.values()];
}

async function devJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path);
    return r.status === 200 ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function bootShell(root: HTMLElement): Promise<void> {
  const status: Status = { state: "setup", frames: 0, guestMs: 0, width: 0, height: 0, log: [] };
  (window as unknown as { __moo2: Status }).__moo2 = status;
  const setState = (s: State) => {
    status.state = s;
    root.dataset.state = s;
  };

  root.replaceChildren();
  const head = el("header", { class: "port-head" });
  head.append(el("h1", {}, "Master of Orion II"), el("p", { class: "muted" }, "The original DOS program, recompiled from your own copy into WebAssembly and run in this tab."));
  const setup = el("section", { class: "port-setup", "data-testid": "port-setup" });
  const gameInfo = el("p", { "data-testid": "port-game-status" });
  const buildInfo = el("p", { "data-testid": "port-build-status" });
  const pickGame = el("input", { type: "file", "data-testid": "port-pick-game", webkitdirectory: "", hidden: "" });
  const pickBuild = el("input", { type: "file", "data-testid": "port-pick-build", webkitdirectory: "", hidden: "" });
  const gameBtn = el("button", { type: "button" }, "Choose Master of Orion II folder…");
  const buildBtn = el("button", { type: "button" }, "Choose build folder…");
  const startBtn = el("button", { type: "button", class: "primary", "data-testid": "port-start", disabled: "" }, "Start");
  const isolation = el("p", { class: "warn", "data-testid": "port-isolation", hidden: "" }, "This page is not cross-origin isolated, so the game cannot run (it needs SharedArrayBuffer). Serve it with COOP/COEP headers, e.g. tools/serve.mjs.");
  setup.append(
    isolation,
    gameInfo,
    el("div", { class: "row" }),
    buildInfo,
    el("div", { class: "row" }),
    startBtn,
    el("p", { class: "muted small" }, "Keyboard and mouse go to the game while it has focus. Your files stay in this browser."),
    el("p", { class: "muted small" }, ""),
  );
  setup.children[2].append(gameBtn, pickGame);
  setup.children[4].append(buildBtn, pickBuild);
  const proto = setup.lastElementChild!;
  proto.append("The first-run TypeScript prototype (an approximation, superseded by this port) is still available ", el("a", { href: "./prototype.html" }, "here"), ".");
  const screen = el("div", { class: "port-screen" });
  const canvas = el("canvas", { width: "640", height: "480", tabindex: "0", "data-testid": "port-canvas" });
  screen.append(canvas);
  const footer = el("p", { class: "muted small", "data-testid": "port-status" });
  root.append(head, setup, screen, footer);
  setState("setup");

  if (!crossOriginIsolated) isolation.hidden = false;

  // ---------------------------------------------------------------- sources
  let game: GameSource[] = [];
  let build: Partial<Record<(typeof BUILD_FILES)[number], Blob>> = {};
  let gameOrigin = "";
  let buildOrigin = "";

  const refresh = () => {
    const total = game.reduce((a, g) => a + ("blob" in g ? g.blob.size : g.size), 0);
    const hasExe = game.some((g) => g.name.toUpperCase() === "ORION2.EXE");
    gameInfo.textContent = game.length
      ? `Installation: ${game.length} files, ${fmtMb(total)} (${gameOrigin})${hasExe ? "" : " — ORION2.EXE not found"}`
      : "Installation: not chosen yet.";
    const missing = BUILD_FILES.filter((n) => !build[n]);
    buildInfo.textContent = missing.length
      ? `Build: ${missing.length === 3 ? "not chosen yet" : `missing ${missing.join(", ")}`}. Build it from your Orion2.exe with tools/re/recompile.ts and runtime/wasm.mk.`
      : `Build: moo2.wasm ${fmtMb(build["moo2.wasm"]!.size)} (${buildOrigin})`;
    startBtn.disabled = !(game.length && hasExe && !missing.length && crossOriginIsolated);
  };

  const stored = await getAll<Blob>(GAME).catch(() => [] as [string, Blob][]);
  if (stored.length) {
    game = stored.map(([name, blob]) => ({ name, blob }));
    gameOrigin = "imported into this browser";
  }
  const storedBuild = await getAll<Blob>(BUILD).catch(() => [] as [string, Blob][]);
  for (const [n, b] of storedBuild) if ((BUILD_FILES as readonly string[]).includes(n)) build[n as (typeof BUILD_FILES)[number]] = b;
  if (storedBuild.length) buildOrigin = "imported into this browser";

  // development server: installation streamed on demand, build fetched once
  if (!game.length) {
    const idx = await devJson<{ files: { name: string; size: number }[] }>("./__dev_install/index.json");
    if (idx?.files.length) {
      // absolute: the worker would resolve a relative URL against its own script location
      game = idx.files.map((f) => ({ name: f.name, url: new URL(`./__dev_install/files/${encodeURIComponent(f.name)}`, location.href).href, size: f.size }));
      gameOrigin = "development server";
    }
  }
  if (BUILD_FILES.some((n) => !build[n])) {
    const idx = await devJson<{ files: string[] }>("./__dev_build/index.json");
    if (idx && BUILD_FILES.every((n) => idx.files.includes(n))) {
      const blobs = await Promise.all(BUILD_FILES.map(async (n) => (await fetch(`./__dev_build/${n}`)).blob()));
      build = Object.fromEntries(BUILD_FILES.map((n, i) => [n, blobs[i]]));
      buildOrigin = "development server";
    }
  }
  refresh();

  gameBtn.onclick = () => pickGame.click();
  buildBtn.onclick = () => pickBuild.click();
  pickGame.onchange = async () => {
    if (!pickGame.files?.length) return;
    const files = topLevel(pickGame.files);
    gameInfo.textContent = `Importing ${files.length} files…`;
    await replaceAll(GAME, files.map((f) => [baseName(f), f]));
    game = files.map((f) => ({ name: baseName(f), blob: f }));
    gameOrigin = "imported into this browser";
    refresh();
  };
  pickBuild.onchange = async () => {
    if (!pickBuild.files?.length) return;
    const found = new Map(Array.from(pickBuild.files).map((f) => [f.name.toLowerCase(), f]));
    const next: typeof build = {};
    for (const n of BUILD_FILES) if (found.has(n)) next[n] = found.get(n);
    await replaceAll(BUILD, Object.entries(next));
    build = next;
    buildOrigin = "imported into this browser";
    refresh();
  };

  // ---------------------------------------------------------------- run
  const ctx = canvas.getContext("2d", { alpha: false })!;
  let img: ImageData | null = null;
  const imageFor = (w: number, h: number) => {
    if (!img || img.width !== w || img.height !== h) {
      canvas.width = w;
      canvas.height = h;
      img = new ImageData(w, h);
    }
    return img;
  };

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    setState("loading");
    footer.textContent = "Loading…";
    try {
      const saves = (await getAll<Uint8Array>(SAVES)).map(([n, d]) => [n, d] as [string, Uint8Array]);
      const [wasm, image, entry] = await Promise.all([build["moo2.wasm"]!.arrayBuffer(), build["image.bin"]!.arrayBuffer(), build["entry.txt"]!.text()]);
      const input = createInputBuffer();
      const frame = createFrameBuffer();
      // sources are served as .ts in development and as .js from the build
      const workerFile = import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js";
      const worker = new Worker(new URL(workerFile, import.meta.url), { type: "module" });
      const frames = new FrameReader(frame);
      const writer = new InputWriter(input);
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const m = ev.data;
        if (m.type === "status") {
          status.frames = m.frames;
          status.guestMs = m.guestMs;
          footer.textContent = `Running · ${(m.guestMs / 1000).toFixed(0)} s · ${m.frames} frames`;
        } else if (m.type === "save") {
          void (m.data ? put(SAVES, m.name, m.data) : remove(SAVES, m.name));
        } else if (m.type === "log") {
          status.log.push(m.message);
          if (status.log.length > 200) status.log.shift();
        } else if (m.type === "exit") {
          setState("exited");
          footer.textContent = `The game exited (code ${m.code}).`;
          worker.terminate();
        } else if (m.type === "error") {
          setState("error");
          footer.textContent = `Stopped: ${m.message.split("\n")[0]}`;
          console.error(m.message);
          worker.terminate();
        }
      };
      worker.onerror = (e) => {
        setState("error");
        footer.textContent = `Worker failed: ${e.message}`;
      };
      const msg: StartMessage = { type: "start", wasm, image, entry, game, saves, input, frame };
      worker.postMessage(msg, [wasm, image]);
      setup.hidden = true;
      setState("running");
      attachInput(canvas, writer, frames);
      canvas.focus();
      const draw = () => {
        const f = frames.take(imageFor);
        if (f) {
          ctx.putImageData(f, 0, 0);
          status.width = f.width;
          status.height = f.height;
        }
        if (status.state === "running") requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    } catch (err) {
      setState("error");
      footer.textContent = `Could not start: ${(err as Error).message}`;
      startBtn.disabled = false;
    }
  };
  root.dataset.ready = "1";
}

function attachInput(canvas: HTMLCanvasElement, input: InputWriter, frames: FrameReader): void {
  const down = new Set<string>();
  const key = (ev: KeyboardEvent, release: boolean) => {
    const bytes = scanBytes(ev.code, release);
    if (!bytes) return;
    ev.preventDefault();
    // auto-repeat arrives as further keydowns and is sent as further make codes, as the keyboard does
    if (release) down.delete(ev.code);
    else down.add(ev.code);
    for (const b of bytes) input.push({ type: 1, code: b });
  };
  canvas.addEventListener("keydown", (ev) => key(ev, false));
  canvas.addEventListener("keyup", (ev) => key(ev, true));
  canvas.addEventListener("blur", () => {
    for (const code of down) for (const b of scanBytes(code, true) ?? []) input.push({ type: 1, code: b });
    down.clear();
  });
  let buttons = 0;
  const mouse = (ev: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const w = frames.width || canvas.width,
      h = frames.height || canvas.height;
    const x = Math.floor(((ev.clientX - r.left) / r.width) * w);
    const y = Math.floor(((ev.clientY - r.top) / r.height) * h);
    // DOM and PC mouse drivers agree: bit 0 left, bit 1 right, bit 2 middle
    buttons = ev.buttons & 7;
    input.push({ type: 2, x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)), buttons });
  };
  canvas.addEventListener("mousemove", mouse);
  canvas.addEventListener("mousedown", (ev) => {
    canvas.focus();
    ev.preventDefault();
    mouse(ev);
  });
  canvas.addEventListener("mouseup", mouse);
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
}
