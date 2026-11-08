/** The SVG point editor: drawing, dragging, box-select and keyboard shortcuts. */
import { bbox, contourD } from "../font/geometry";
import { addPoint, bendLine, canEditPoints, deletePoints, movePts } from "../editor/edits";
import { pushUndo } from "../editor/history";
import { hitSegment, type SegmentHit } from "../editor/outline";
import { advOf, baseOutline, cleanEdit, contours, editedOutline, editedPts, newHeights } from "../editor/project";
import { currentGid, glyphEdit, proj, state } from "../editor/state";
import type { App } from "./app";
import { $, $input } from "./dom";
import { scheduleLive } from "./live";

const svg = () => $<SVGSVGElement>("#stage");

interface Drag {
  start: { x: number; y: number };
  /** Offsets of each dragged point when the drag began. */
  base: Map<number, [number, number]>;
  /** How far the points move per unit of pointer movement. A new curve's control moves twice as far, so the curve follows the pointer. */
  gain: number;
}
interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Selection to keep (Shift held when the box started). */
  add: Set<number>;
}

let drag: Drag | null = null;
let marq: Marquee | null = null;
/** Where a click would add a point, shown while the Add point tool (or Alt) is active. */
let hover: SegmentHit | null = null;
/** Font units per screen pixel at the last render. */
let upp = 1;
/** How close to the outline, in screen pixels, a click has to be to add a point. */
const HIT_PX = 10;

const isSimple = () => !!state.font && state.font.glyphs[currentGid()].type === "simple";

export function renderEditor(): void {
  const font = state.font;
  if (!font) return;
  const el = svg();
  const gid = currentGid();
  const G = font.glyphs[gid];
  const p = proj();
  const adv = advOf(font, gid, p);
  const pad = font.upm * 0.12;
  const top = Math.max(font.asc, font.upm * 0.8) + pad;
  const bot = Math.min(font.desc, -font.upm * 0.2) - pad;
  const cs = contours(font, gid, p);
  const box = bbox(cs.flat()) || [0, 0, adv, 0];
  const x0 = Math.min(0, box[0]) - pad;
  const x1 = Math.max(adv, box[2], font.upm * 0.5) + pad;
  const vb = [x0, -top, x1 - x0, top - bot];
  el.setAttribute("viewBox", vb.join(" "));
  const W = el.clientWidth || 800;
  const H = el.clientHeight || 560;
  upp = Math.max(vb[2] / W, vb[3] / H); // font units per screen pixel
  const r = 5.5 * upp;

  let h = "";
  const k = newHeights(font, p);
  const lines = (
    [
      [0, "baseline", "base"],
      [k.xh, "x-height"],
      [k.cap, "cap height"],
      [k.asc, "ascender"],
      [k.desc, "descender"],
    ] as [number, string, string?][]
  ).filter((l, i) => l[0] || i === 0);
  for (const [y, l, c] of lines) {
    h += `<line class="metric ${c || ""}" x1="${x0 - 1e4}" x2="${x1 + 1e4}" y1="${-y}" y2="${-y}"/><text class="mlabel" x="${x0 + 6 * upp}" y="${-y - 5 * upp}" style="font-size:${11 * upp}px">${l} ${y}</text>`;
  }
  h += `<line class="adv" x1="0" x2="0" y1="${-top - 1e4}" y2="${-bot + 1e4}"/><line class="adv" x1="${adv}" x2="${adv}" y1="${-top - 1e4}" y2="${-bot + 1e4}"/>`;
  if ($input("#showGhost").checked) {
    h += `<path class="ghost" d="${contours(font, gid, p, 0, true).map(contourD).join("")}"/>`;
  }
  h += `<path class="shape" fill-rule="nonzero" d="${cs.map(contourD).join("")}"/>`;

  if (G.type === "simple") {
    let hd = "";
    for (const c of cs) {
      const n = c.length;
      for (let i = 0; i < n; i++) {
        const a = c[i];
        const b = c[(i + 1) % n];
        if (!a.on || !b.on) hd += `M${a.x} ${-a.y}L${b.x} ${-b.y}`;
      }
    }
    h += `<path class="handles" d="${hd}"/><g class="pts">`;
    const sel = state.selPts;
    editedPts(font, gid, p).forEach((q, i) => {
      const cls = `p ${q.on ? "on" : "off"}${sel.has(i) ? " sel" : ""}`;
      h += q.on
        ? `<circle class="${cls}" data-i="${i}" cx="${q.x}" cy="${-q.y}" r="${sel.has(i) ? r * 1.2 : r}"/>`
        : `<rect class="${cls}" data-i="${i}" x="${q.x - r * 0.8}" y="${-q.y - r * 0.8}" width="${r * 1.6}" height="${r * 1.6}" transform="rotate(45 ${q.x} ${-q.y})"/>`;
    });
    h += "</g>";
    if (hover) h += `<circle class="addpv" cx="${hover.at.x}" cy="${-hover.at.y}" r="${r * 1.3}"/>`;
  }
  if (marq) {
    h += `<rect class="marq" x="${Math.min(marq.x0, marq.x1)}" y="${-Math.max(marq.y0, marq.y1)}" width="${Math.abs(marq.x1 - marq.x0)}" height="${Math.abs(marq.y1 - marq.y0)}"/>`;
  }
  el.innerHTML = h;
  el.classList.toggle("solid", $input("#solid").checked);
  el.classList.toggle("adding", state.tool !== "select");
}

/** Switches between the Select, Add point and Curve tools. */
export function setTool(tool: "select" | "add" | "bend"): void {
  state.tool = tool;
  hover = null;
  $("#toolSelect").setAttribute("aria-pressed", String(tool === "select"));
  $("#toolAdd").setAttribute("aria-pressed", String(tool === "add"));
  $("#toolBend").setAttribute("aria-pressed", String(tool === "bend"));
  renderEditor();
}

/** The segment under the pointer, if adding a point (or, with the Curve tool, bending a straight line) is possible there. */
function segmentAt(at: { x: number; y: number }): SegmentHit | null {
  const font = state.font;
  if (!font || !canEditPoints()) return null;
  const o = editedOutline(font, currentGid(), proj());
  const hit = hitSegment(o, at, HIT_PX * upp);
  if (hit && state.tool === "bend" && !o.pts[hit.i].on) return null;
  return hit;
}

function startDrag(at: { x: number; y: number }, record: boolean, gain = 1): void {
  const e = glyphEdit();
  e.pts = e.pts || {};
  if (record) pushUndo();
  const pts = e.pts;
  drag = { start: at, gain, base: new Map([...state.selPts].map((k) => [k, (pts[k] || [0, 0]).slice() as [number, number]])) };
  svg().style.cursor = "grabbing";
}

/** Pointer position in font units (y up). */
function toFont(ev: PointerEvent): { x: number; y: number } {
  const el = svg();
  const pt = el.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const q = pt.matrixTransform(el.getScreenCTM()!.inverse());
  return { x: q.x, y: -q.y };
}

export function bindStage(app: App): void {
  const el = svg();

  el.addEventListener("pointerdown", (ev) => {
    if (!isSimple() || $input("#solid").checked) return;
    el.focus({ preventScroll: true });
    el.setPointerCapture(ev.pointerId);
    const t = (ev.target as Element).closest<SVGElement>(".p");
    const at = toFont(ev);
    const sel = state.selPts;
    if (t) {
      const i = +t.dataset.i!;
      if (ev.shiftKey) {
        if (sel.has(i)) sel.delete(i);
        else sel.add(i);
        app.renderAll();
        return;
      }
      if (!sel.has(i)) {
        sel.clear();
        sel.add(i);
      }
      startDrag(at, true);
      renderEditor();
    } else if (state.tool === "bend") {
      // Bend a straight line: add a control point halfway along and drag it, as one undo step.
      const hit = segmentAt(at);
      hover = null;
      if (hit && bendLine(hit.i) != null) {
        startDrag(at, false, 2);
        app.renderAll();
        scheduleLive();
      }
    } else if (state.tool === "add" || ev.altKey) {
      // Add a point on the outline and keep dragging it, as one undo step.
      const hit = segmentAt(at);
      hover = null;
      if (hit && addPoint(hit.i, hit.t) != null) {
        startDrag(at, false);
        app.renderAll();
        scheduleLive();
      }
    } else {
      if (!ev.shiftKey) sel.clear();
      marq = { x0: at.x, y0: at.y, x1: at.x, y1: at.y, add: new Set(sel) };
      app.renderAll();
    }
  });

  el.addEventListener("pointermove", (ev) => {
    const font = state.font;
    if (!font) return;
    if (!drag && !marq) {
      const want = isSimple() && !$input("#solid").checked && (state.tool !== "select" || ev.altKey);
      const onPoint = !!(ev.target as Element).closest(".p");
      const next = want && !onPoint ? segmentAt(toFont(ev)) : null;
      if (next || hover) {
        hover = next;
        renderEditor();
      }
      return;
    }
    if (drag) {
      const at = toFont(ev);
      const dx = Math.round((at.x - drag.start.x) * drag.gain);
      const dy = Math.round((at.y - drag.start.y) * drag.gain);
      const e = glyphEdit();
      for (const [k, b] of drag.base) e.pts![k] = [b[0] + dx, b[1] + dy];
      renderEditor();
      scheduleLive();
      if (state.selPts.size === 1) {
        const q = editedPts(font, currentGid(), proj())[[...state.selPts][0]];
        $input("#ptx").value = String(q.x);
        $input("#pty").value = String(q.y);
      }
    } else if (marq) {
      const at = toFont(ev);
      marq.x1 = at.x;
      marq.y1 = at.y;
      const a = Math.min(marq.x0, marq.x1);
      const b = Math.min(marq.y0, marq.y1);
      const c = Math.max(marq.x0, marq.x1);
      const d = Math.max(marq.y0, marq.y1);
      const sel = new Set(marq.add);
      editedPts(font, currentGid(), proj()).forEach((q, i) => {
        if (q.x >= a && q.x <= c && q.y >= b && q.y <= d) sel.add(i);
      });
      state.selPts = sel;
      renderEditor();
    }
  });

  const endPtr = () => {
    if (drag) {
      drag = null;
      el.style.cursor = "";
      cleanEdit(glyphEdit());
      app.changed();
    }
    if (marq) {
      marq = null;
      app.renderAll();
    }
  };
  el.addEventListener("pointerup", endPtr);
  el.addEventListener("pointerleave", () => {
    if (hover) {
      hover = null;
      renderEditor();
    }
  });
  $("#toolSelect").onclick = () => setTool("select");
  $("#toolAdd").onclick = () => setTool("add");
  $("#toolBend").onclick = () => setTool("bend");
  el.addEventListener("pointercancel", endPtr);

  $input("#showGhost").onchange = renderEditor;
  $input("#solid").onchange = renderEditor;
  window.addEventListener("resize", () => renderEditor());

  document.addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLElement;
    const tag = (target.tagName || "").toLowerCase();
    if ((tag === "input" && (target as HTMLInputElement).type !== "range") || tag === "select" || tag === "textarea") return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (mod && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) app.redo();
      else app.undo();
      return;
    }
    if (mod && key === "y") {
      ev.preventDefault();
      app.redo();
      return;
    }
    if (!isSimple()) return;
    if (mod && key === "a" && document.activeElement === el) {
      ev.preventDefault();
      const o = baseOutline(state.font!, currentGid(), proj());
      if (o) state.selPts = new Set(o.pts.map((_, i) => i));
      app.renderAll();
      return;
    }
    if (!mod && !ev.altKey && (key === "v" || key === "p" || key === "c")) {
      setTool(key === "p" ? "add" : key === "c" ? "bend" : "select");
      return;
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && state.selPts.size) {
      ev.preventDefault();
      if (deletePoints()) app.changed();
      return;
    }
    if (ev.key === "Escape") {
      state.selPts.clear();
      app.renderAll();
      return;
    }
    const st = ev.shiftKey ? 10 : 1;
    const dirs = ({ ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] } as Record<string, [number, number]>)[ev.key];
    if (dirs && state.selPts.size) {
      ev.preventDefault();
      if (movePts((q) => ({ x: q.x + dirs[0], y: q.y + dirs[1] }))) app.changed();
    }
  });
}
