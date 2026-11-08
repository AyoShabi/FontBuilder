/** The right-hand panel: spacing, reshape buttons, selected point, resets. */
import { bbox } from "../font/geometry";
import {
  addGroup,
  currentTarget,
  deleteGroup,
  deletePoints,
  movePts,
  reshapeOp,
  resetAll,
  resetGlyph,
  selectZone,
  setMetric,
  setPoint,
  targetGids,
  updateGroup,
  type Metric,
  type ReshapeKey,
} from "../editor/edits";
import { allGroups, groupChars, type ZoneKey } from "../editor/groups";
import { advOf, baseOutline, contours, editedPts } from "../editor/project";
import { currentGid, font, linkedGids, linkedGroup, proj, state } from "../editor/state";
import type { App } from "./app";
import { $, $input, escapeHtml, hex4 } from "./dom";

const NEW_GROUP = "new";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function renderGroups(): void {
  const f = font();
  const groups = allGroups(f, proj());
  const g = linkedGroup();
  if (state.link && !g) state.link = null;
  const opt = (id: string, label: string) =>
    `<option value="${id}"${id === (state.link || "") ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const isStage = (x: { id: string }) => x.id.startsWith("stage:");
  const auto = groups.filter((x) => x.custom == null && !isStage(x));
  const stage = groups.filter(isStage);
  const mine = groups.filter((x) => x.custom != null);
  $("#linkGroup").innerHTML =
    opt("", "None: edit this glyph only") +
    `<optgroup label="Found in this font">${auto.map((x) => opt(x.id, `${x.name} (${x.gids.length})`)).join("")}</optgroup>` +
    `<optgroup label="Design stages">${stage.map((x) => opt(x.id, `${x.name} (${x.gids.length})`)).join("")}</optgroup>` +
    `<optgroup label="Your groups">${mine.map((x) => opt(x.id, `${x.name} (${x.gids.length})`)).join("")}${opt(NEW_GROUP, "New group…")}</optgroup>`;

  const note = $("#linkNote");
  if (g) {
    const inIt = g.gids.includes(currentGid());
    note.textContent = inIt
      ? `Spacing, reshapes, zone edits and resets apply to all ${g.gids.length}: ${groupChars(f, g)}`
      : `This glyph isn't in ${g.name}, so edits apply to it alone. Pick one of: ${groupChars(f, g)}`;
    note.classList.toggle("warn", !inIt);
    note.hidden = false;
  } else note.hidden = true;

  const custom = g?.custom != null ? proj().groups![g.custom] : null;
  $("#grpForm").hidden = $("#grpBtns").hidden = !custom;
  if (custom) {
    if (document.activeElement !== $input("#grpName")) $input("#grpName").value = custom.name;
    if (document.activeElement !== $input("#grpChars")) $input("#grpChars").value = custom.chars;
  }
}

export function renderInspector(): void {
  const f = font();
  const p = proj();
  const gid = currentGid();
  const G = f.glyphs[gid];
  const c = f.rev.get(gid);
  const sel = state.selPts;

  $("#inspChar").textContent = c != null ? (c === 32 ? "␠" : String.fromCodePoint(c)) : "·";
  $("#inspName").textContent = c != null ? hex4(c) : "glyph " + gid;

  const box = bbox(contours(f, gid, p).flat());
  const adv = advOf(f, gid, p);
  $input("#lsb").value = String(box ? Math.round(box[0]) : 0);
  $input("#rsb").value = String(box ? Math.round(adv - box[2]) : adv);
  $input("#advw").value = String(adv);

  const simple = G.type === "simple";
  $input("#lsb").disabled = !simple;
  document.querySelectorAll<HTMLButtonElement>("[data-xf]").forEach((b) => (b.disabled = !simple));
  document.querySelectorAll<HTMLButtonElement>("[data-zone]").forEach((b) => {
    b.disabled = !simple;
    b.setAttribute("aria-pressed", String(b.dataset.zone === state.zone));
  });

  renderGroups();
  const t = currentTarget();
  const n = targetGids(t).length;
  const across = n > 1 ? ` in ${n} glyphs` : "";
  $("#xfLabel").textContent =
    t.kind === "zone"
      ? `Reshape ${t.zone.label}${across}`
      : t.kind === "points"
        ? `Reshape ${plural(sel.size, "selected point")}${linkedGids().length > 1 ? " (this letter only)" : ""}`
        : `Reshape whole letter${across}`;
  const m = linkedGids().length;
  $("#spaceLabel").textContent = m > 1 ? `Spacing (font units) · sets all ${m}` : "Spacing (font units)";
  $("#resetGlyph").textContent = m > 1 ? `Reset ${m} letters` : "Reset this letter";

  const cn = $("#compNote");
  if (G.type === "composite") {
    const names = G.comps
      .map((k) => {
        const cc = f.rev.get(k.gi);
        return cc != null ? String.fromCodePoint(cc) : "part";
      })
      .join(" + ");
    cn.textContent = `This glyph is built from ${names}. Edit those glyphs and it follows. You can still change its spacing.`;
    cn.hidden = false;
  } else cn.hidden = true;

  $("#delBox").hidden = !(sel.size && simple);
  // Removing curve control points straightens the curve, so say so.
  const pts = simple ? editedPts(f, gid, p) : [];
  const allOff = sel.size > 0 && [...sel].every((i) => pts[i] && !pts[i].on);
  $("#delPts").textContent = allOff ? "Straighten" : sel.size > 1 ? `Delete ${sel.size} points` : "Delete point";
  const one = sel.size === 1 && simple;
  $("#ptBox").hidden = !one;
  if (one) {
    const q = editedPts(f, gid, p)[[...sel][0]];
    $input("#ptx").value = String(Math.round(q.x));
    $input("#pty").value = String(Math.round(q.y));
  }

  const base = baseOutline(f, gid, p);
  $("#pointInfo").textContent =
    G.type === "simple"
      ? `${plural(base!.pts.length, "point")} · ${plural(base!.ends.length, "contour")}${sel.size ? ` · ${sel.size} selected` : ""}${base!.fits ? "" : " · added points don't fit this font"}`
      : G.type === "composite"
        ? "Composite glyph"
        : "Empty glyph";
}

export function bindInspector(app: App): void {
  $(".insp").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-xf]");
    if (!b) return;
    const t = currentTarget();
    const anchor = t.kind === "zone" ? t.zone.anchor(font()) : undefined;
    const op = reshapeOp(b.dataset.xf as ReshapeKey, font().upm, state.selPts.size > 0, anchor);
    if (movePts(op, t)) app.changed();
  });

  $("#zoneBtns").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-zone]");
    if (!b) return;
    const z = b.dataset.zone as ZoneKey;
    state.zone = state.zone === z ? null : z;
    selectZone();
    app.renderAll();
  });

  $<HTMLSelectElement>("#linkGroup").addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === NEW_GROUP) {
      const c = font().rev.get(currentGid());
      const i = addGroup(`Group ${(proj().groups || []).length + 1}`, c != null ? String.fromCodePoint(c) : "");
      state.link = "custom:" + i;
      app.changed();
      $input("#grpChars").focus();
      return;
    }
    state.link = v || null;
    app.renderAll();
  });

  const groupField = (id: string, key: "name" | "chars") =>
    $input(id).addEventListener("change", (e) => {
      const g = linkedGroup();
      if (g?.custom == null) return;
      updateGroup(g.custom, { [key]: (e.target as HTMLInputElement).value });
      app.changed();
    });
  groupField("#grpName", "name");
  groupField("#grpChars", "chars");

  $("#grpDelete").onclick = () => {
    const g = linkedGroup();
    if (g?.custom == null) return;
    deleteGroup(g.custom);
    state.link = null;
    app.changed();
  };

  const metric = (id: string, which: Metric) =>
    $input(id).addEventListener("change", (e) => {
      if (setMetric(which, +(e.target as HTMLInputElement).value)) app.changed();
    });
  metric("#lsb", "lsb");
  metric("#rsb", "rsb");
  metric("#advw", "adv");

  const onPoint = () => {
    setPoint([...state.selPts][0], +$input("#ptx").value, +$input("#pty").value);
    app.changed();
  };
  $input("#ptx").addEventListener("change", onPoint);
  $input("#pty").addEventListener("change", onPoint);

  $("#delPts").onclick = () => {
    if (deletePoints()) app.changed();
  };

  $("#resetGlyph").onclick = () => {
    resetGlyph();
    app.changed();
  };
  $("#resetAll").onclick = () => {
    $("#confirmAll").hidden = false;
  };
  $("#confirmNo").onclick = () => {
    $("#confirmAll").hidden = true;
  };
  $("#confirmYes").onclick = () => {
    resetAll();
    $input("#track").value = "0";
    $("#trackOut").textContent = "0";
    $("#confirmAll").hidden = true;
    app.changed();
    app.renderGrids();
  };
}
