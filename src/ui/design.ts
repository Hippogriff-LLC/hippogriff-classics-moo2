// Ship design workshop: hull, systems, weapons and specials with live stats and validation.

import type { App } from "./app.ts";
import type { ShipDesign } from "../engine/types.ts";
import { ARMORS, COMPUTERS, DRIVES, HULLS, SHIELDS, SPECIALS, WEAPONS, WEAPON_BY_ID } from "../engine/data/ships.ts";
import { addDesign, autoDesign, availableHulls, blankDesign, designStats, designsOf, specialSpace, validateDesign, hullSpace } from "../engine/designs.ts";
import { hasTech } from "../engine/state.ts";
import { h, button, select, fmt } from "./dom.ts";
import { shipImage } from "./art.ts";

let draft: { gameId: string; d: ShipDesign } | null = null;

const ROLES: [ShipDesign["role"], string, string | null][] = [
  ["combat", "Warship", null],
  ["colony", "Colony ship", "colony_ship"],
  ["outpost", "Outpost ship", "outpost_ship"],
  ["transport", "Troop transport", "transport"],
  ["scout", "Scout", null],
];

export function designScreen(app: App): HTMLElement {
  const s = app.game!;
  const e = app.me;
  if (!draft || draft.gameId !== s.id) draft = { gameId: s.id, d: autoDesign(e, 1, "New Design") };
  const d = draft.d;
  const st = designStats(d, e);
  const errs = validateDesign(d, e);
  const upd = () => app.refresh();
  const own = <T extends { id: string }>(list: T[]) => list.filter((x) => hasTech(e, x.id));
  const nameIn = h("input", { value: d.name, maxlength: 24, "data-testid": "design-name" }) as HTMLInputElement;
  nameIn.addEventListener("change", () => { d.name = nameIn.value; upd(); });

  const weaponRows = d.weapons.map((w, i) => {
    const wd = WEAPON_BY_ID[w.weaponId];
    return h(
      "div",
      { class: "weapon-row" },
      h("span", null, `${wd.name} (${wd.kind}, ${wd.min}-${wd.max} dmg, range ${wd.range}${wd.ammo ? `, ${wd.ammo} volleys` : ""})`),
      button("−", () => { w.count--; if (w.count <= 0) d.weapons.splice(i, 1); upd(); }),
      h("strong", null, `×${w.count}`),
      button("+", () => { w.count++; upd(); }),
    );
  });
  const addWeapon = select("", [["", "Add weapon…"], ...own(WEAPONS).map((w) => [w.id, `${w.name} — ${w.space} space, ${w.cost} BC`] as [string, string])], (id) => {
    if (!id) return;
    const ex = d.weapons.find((w) => w.weaponId === id);
    if (ex) ex.count++;
    else d.weapons.push({ weaponId: id, count: 1 });
    upd();
  }, { "data-testid": "design-add-weapon" });
  const specials = own(SPECIALS).map((sp) => {
    const cb = h("input", { type: "checkbox", checked: d.specials.includes(sp.id) }) as HTMLInputElement;
    cb.addEventListener("change", () => {
      d.specials = cb.checked ? [...d.specials, sp.id] : d.specials.filter((x) => x !== sp.id);
      upd();
    });
    return h("label", { class: "check", title: sp.desc }, cb, `${sp.name} (${specialSpace(sp.id, hullSpace(d))} sp) — ${sp.desc}`);
  });
  const preview = h("canvas", { width: 96, height: 90 });
  preview.getContext("2d")!.drawImage(shipImage(d, e.color, 96), 0, 0, 96, 90);
  const existing = designsOf(s, e, true).map((x) => {
    const xs = designStats(x, e);
    return h(
      "tr",
      { class: x.obsolete ? "muted" : "" },
      h("td", null, x.name),
      h("td", null, HULLS[x.hull].name),
      h("td", null, x.role),
      h("td", null, String(xs.cost)),
      h("td", null, `${xs.attack}/${xs.defense}/${xs.shield}`),
      h("td", null, fmt(xs.firepower)),
      h("td", null, button("Copy", () => { draft = { gameId: s.id, d: { ...x, id: -1, name: `${x.name} II`, weapons: x.weapons.map((w) => ({ ...w })), specials: [...x.specials], obsolete: false } }; upd(); }), button(x.obsolete ? "Restore" : "Obsolete", () => { x.obsolete = !x.obsolete; upd(); })),
    );
  });
  const save = () => {
    if (errs.length) return app.toast(errs[0], "error");
    if (designsOf(s, e).some((x) => x.name === d.name)) return app.toast("A design with that name already exists", "error");
    addDesign(s, { ...d, owner: e.id });
    app.toast(`Design ${d.name} saved; it can now be built at colonies.`);
    draft = { gameId: s.id, d: { ...d, name: `${d.name} II`, weapons: d.weapons.map((w) => ({ ...w })), specials: [...d.specials] } };
    upd();
  };
  return h(
    "div",
    { class: "page wide design" },
    h("h1", null, "Ship Design"),
    h(
      "div",
      { class: "cols" },
      h(
        "div",
        { class: "form" },
        h("label", null, "Name", nameIn),
        h("label", null, "Hull", select(d.hull, availableHulls(e).map((i) => [i, `${HULLS[i].name} (${HULLS[i].space} space)`] as [number, string]), (v) => { d.hull = v; d.imageIndex = v * 8 + (d.imageIndex % 8); upd(); }, { "data-testid": "design-hull" })),
        h("label", null, "Role", select(d.role, ROLES.filter(([, , t]) => !t || hasTech(e, t)).map(([r, n]) => [r, n] as [ShipDesign["role"], string]), (v) => {
          const nd = blankDesign(e, d.hull, v, d.name);
          draft = { gameId: s.id, d: v === "combat" ? { ...nd, weapons: d.weapons, specials: d.specials } : nd };
          upd();
        })),
        h("label", null, "Computer", select(d.computer ?? "", [["", "None"], ...own(COMPUTERS).map((c) => [c.id, c.name] as [string, string])], (v) => { d.computer = v || null; upd(); })),
        h("label", null, "Shield", select(d.shield ?? "", [["", "None"], ...own(SHIELDS).map((c) => [c.id, c.name] as [string, string])], (v) => { d.shield = v || null; upd(); })),
        h("label", null, "Armor", select(d.armor, ARMORS.filter((a, i) => i === 0 || hasTech(e, a.id)).map((a) => [a.id, a.name] as [string, string]), (v) => { d.armor = v; upd(); })),
        h("label", null, "Drive", select(d.drive, own(DRIVES).map((a) => [a.id, a.name] as [string, string]), (v) => { d.drive = v; upd(); })),
        h("label", null, "Style", h("span", null, button("◀", () => { d.imageIndex = d.hull * 8 + ((d.imageIndex + 7) % 8); upd(); }), button("▶", () => { d.imageIndex = d.hull * 8 + ((d.imageIndex + 1) % 8); upd(); }))),
        h("div", { class: "row" }, button("Auto-design warship", () => { draft = { gameId: s.id, d: autoDesign(e, d.hull, d.name) }; upd(); }), button("Missile boat", () => { draft = { gameId: s.id, d: autoDesign(e, d.hull, d.name, "missile") }; upd(); }), button("Bomber", () => { draft = { gameId: s.id, d: autoDesign(e, d.hull, d.name, "mixed", true) }; upd(); })),
      ),
      h(
        "div",
        null,
        h("h3", null, "Weapons"),
        ...weaponRows,
        addWeapon,
        h("h3", null, "Specials"),
        h("div", { class: "specials" }, ...(specials.length ? specials : [h("p", { class: "muted" }, "No specials researched yet.")])),
      ),
      h(
        "div",
        { class: "stats-card" },
        preview,
        h("table", { class: "grid small" }, ...[
          ["Space", `${st.spaceUsed}/${st.space}`],
          ["Cost", `${st.cost} PP`],
          ["Beam attack", String(st.attack)],
          ["Beam defense", String(st.defense)],
          ["Structure / armor", `${st.structure} / ${st.armor}`],
          ["Shield", String(st.shield)],
          ["Speed (map / combat)", `${st.speed} / ${st.combatSpeed}`],
          ["Firepower", fmt(st.firepower)],
          ["Troops", String(st.troops)],
        ].map(([k, v]) => h("tr", null, h("th", null, k), h("td", { class: k === "Space" && st.spaceUsed > st.space ? "bad" : "" }, v)))),
        errs.length ? h("ul", { class: "bad" }, ...errs.map((x) => h("li", null, x))) : h("p", { class: "good" }, "Design is valid."),
        button("Save design", save, { cls: "primary", disabled: errs.length > 0, testid: "design-save" }),
      ),
    ),
    h("h3", null, "Existing designs"),
    h("table", { class: "grid" }, h("tr", null, ...["Name", "Hull", "Role", "Cost", "Att/Def/Shd", "Firepower", ""].map((t) => h("th", null, t))), ...existing),
  );
}
