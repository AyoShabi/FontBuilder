/**
 * The SVG point editor: drawing, zoom and pan, dragging (Shift keeps it straight), box-select and
 * the Illustrator-style keyboard shortcuts.
 */
import { bbox, contourD } from "../font/geometry";
import { addPoint, bendLine, canEditPoints, deletePoints, movePts } from "../editor/edits";
import { pushUndo } from "../editor/history";
import { hitSegment, type SegmentHit } from "../editor/outline";
import { advOf, baseOutline, cleanEdit, contours, editedOutline, editedPts, newHeights } from "../editor/project";
import { currentGid, glyphEdit, proj, state, type Tool } from "../editor/state";
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
  /** The undo step is taken on the first real movement, so a plain click doesn't leave an empty step. */
  needUndo: boolean;
  moved: boolean;
  /** Shift-click on a selected point removes it from the selection, if the pointer doesn't move. */
  unselect: number | null;
}
interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Selection to keep (Shift held when the box started). */
  add: Set<number>;
}
interface Pan {
  x: number;
  y: number;
}

let drag: Drag | null = null;
let marq: Marquee | null = null;
let panning: Pan | null = null;
/** Space is held: dragging pans the view, as in Illustrator. */
let spaceDown = false;
/** Where a click would add a point, shown while the Add point tool (or Alt) is active. */
let hover: SegmentHit | null = null;
/** Font units per screen pixel at the last render. */
let upp = 1;
/** How close to the outline, in screen pixels, a click has to be to add a point. */
const HIT_PX = 10;

/**
 * The view: `zoom` is relative to fitting the whole letter; `cx`/`cy` is the centre in SVG units (y down).
 * Until the user zooms or pans (`free`), the view follows the letter as it changes size.
 */
const view = { zoom: 1, cx: 0, cy: 0, free: false, gid: -1, slug: "" };
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 64;

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
  const fx0 = Math.min(0, box[0]) - pad;
  const fx1 = Math.max(adv, box[2], font.upm * 0.5) + pad;

  // A new letter (or font) starts fitted.
  if (gid !== view.gid || state.store.slug !== view.slug) {
    view.gid = gid;
    view.slug = state.store.slug;
    view.free = false;
  }
  if (!view.free) {
    view.zoom = 1;
    view.cx = (fx0 + fx1) / 2;
    view.cy = (-top + -bot) / 2;
  }
  const W = el.clientWidth || 800;
  const H = el.clientHeight || 560;
  const fitUpp = Math.max((fx1 - fx0) / W, (top - bot) / H);
  upp = fitUpp / view.zoom;
  const vb = [view.cx - (W * upp) / 2, view.cy - (H * upp) / 2, W * upp, H * upp];
  el.setAttribute("viewBox", vb.join(" "));
  const r = 5.5 * upp;
  const far = (Math.abs(vb[0]) + vb[2] + Math.abs(vb[1]) + vb[3]) * 4;

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
    h += `<line class="metric ${c || ""}" x1="${-far}" x2="${far}" y1="${-y}" y2="${-y}"/><text class="mlabel" x="${vb[0] + 6 * upp}" y="${-y - 5 * upp}" style="font-size:${11 * upp}px">${l} ${y}</text>`;
  }
  h += `<line class="adv" x1="0" x2="0" y1="${-far}" y2="${far}"/><line class="adv" x1="${adv}" x2="${adv}" y1="${-far}" y2="${far}"/>`;
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
  el.dataset.tool = spaceDown || panning ? "hand" : state.tool;
  $("#zoomPct").textContent = Math.round(view.zoom * 100) + "%";
}

/** Zooms by `factor`, keeping the point under the pointer (or the middle of the view) still. */
export function zoomBy(factor: number, clientX?: number, clientY?: number): void {
  const el = svg();
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  if (next === view.zoom) return;
  const rect = el.getBoundingClientRect();
  const px = clientX == null ? rect.width / 2 : clientX - rect.left;
  const py = clientY == null ? rect.height / 2 : clientY - rect.top;
  // The SVG point under the pointer, before and after: keep it fixed.
  const ax = view.cx + (px - rect.width / 2) * upp;
  const ay = view.cy + (py - rect.height / 2) * upp;
  const ratio = view.zoom / next;
  view.cx = ax - (ax - view.cx) * ratio;
  view.cy = ay - (ay - view.cy) * ratio;
  view.zoom = next;
  view.free = true;
  renderEditor();
}

/** Fits the whole letter in the view again. */
export function zoomFit(): void {
  view.free = false;
  renderEditor();
}

function panBy(dxPx: number, dyPx: number): void {
  view.cx -= dxPx * upp;
  view.cy -= dyPx * upp;
  view.free = true;
  renderEditor();
}

const TOOL_BUTTONS: Record<Tool, string> = { select: "#toolSelect", add: "#toolAdd", remove: "#toolRemove", bend: "#toolBend" };

/** Switches between the Select, Add point, Delete point and Curve tools. */
export function setTool(tool: Tool): void {
  state.tool = tool;
  hover = null;
  for (const [t, sel] of Object.entries(TOOL_BUTTONS)) $(sel).setAttribute("aria-pressed", String(t === tool));
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

function startDrag(at: { x: number; y: number }, record: boolean, gain = 1, unselect: number | null = null): void {
  const e = glyphEdit();
  e.pts = e.pts || {};
  const pts = e.pts;
  drag = {
    start: at,
    gain,
    needUndo: record,
    moved: false,
    unselect,
    base: new Map([...state.selPts].map((k) => [k, (pts[k] || [0, 0]).slice() as [number, number]])),
  };
  svg().style.cursor = "grabbing";
}

/**
 * Shift keeps a move horizontal, vertical or at 45 degrees, as in Illustrator: the movement is
 * projected onto the nearest of those directions.
 */
export function constrain(dx: number, dy: number): [number, number] {
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = dx * Math.cos(a) + dy * Math.sin(a);
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return [r(len * Math.cos(a)), r(len * Math.sin(a))];
}

/** Pointer position in font units (y up). */
function toFont(ev: PointerEvent | MouseEvent): { x: number; y: number } {
  const el = svg();
  const pt = el.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const q = pt.matrixTransform(el.getScreenCTM()!.inverse());
  return { x: q.x, y: -q.y };
}

/** True when a key press belongs to a text box or list, not the editor. */
function typing(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  const tag = (t?.tagName || "").toLowerCase();
  return tag === "input" || tag === "select" || tag === "textarea";
}

export function bindStage(app: App): void {
  const el = svg();

  el.addEventListener("pointerdown", (ev) => {
    el.focus({ preventScroll: true });
    // Space-drag, middle-drag: move the view.
    if (spaceDown || ev.button === 1) {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      panning = { x: ev.clientX, y: ev.clientY };
      renderEditor();
      return;
    }
    if (ev.button !== 0 || !isSimple() || $input("#solid").checked) return;
    el.setPointerCapture(ev.pointerId);
    const t = (ev.target as Element).closest<SVGElement>(".p");
    const at = toFont(ev);
    const sel = state.selPts;
    if (t && state.tool === "remove") {
      if (deletePoints([+t.dataset.i!])) app.changed();
      return;
    }
    if (t) {
      const i = +t.dataset.i!;
      let unselect: number | null = null;
      if (ev.shiftKey) {
        if (sel.has(i)) unselect = i;
        else sel.add(i);
      } else if (!sel.has(i)) {
        sel.clear();
        sel.add(i);
      }
      startDrag(at, true, 1, unselect);
      app.renderAll();
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
    if (panning) {
      const dx = ev.clientX - panning.x;
      const dy = ev.clientY - panning.y;
      panning = { x: ev.clientX, y: ev.clientY };
      panBy(dx, dy);
      return;
    }
    if (!drag && !marq) {
      const want = isSimple() && !$input("#solid").checked && !spaceDown && (state.tool === "add" || state.tool === "bend" || ev.altKey);
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
      let dx = at.x - drag.start.x;
      let dy = at.y - drag.start.y;
      if (ev.shiftKey) [dx, dy] = constrain(dx, dy);
      dx = Math.round(dx * drag.gain);
      dy = Math.round(dy * drag.gain);
      if (!drag.moved) {
        if (!dx && !dy) return;
        drag.moved = true;
        if (drag.needUndo) pushUndo();
      }
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
    if (panning) {
      panning = null;
      renderEditor();
    }
    if (drag) {
      const d = drag;
      drag = null;
      el.style.cursor = "";
      if (!d.moved && d.unselect != null) state.selPts.delete(d.unselect);
      cleanEdit(glyphEdit());
      if (d.moved || !d.needUndo) app.changed();
      else app.renderAll();
    }
    if (marq) {
      marq = null;
      app.renderAll();
    }
  };
  el.addEventListener("pointerup", endPtr);
  el.addEventListener("pointercancel", endPtr);
  el.addEventListener("pointerleave", () => {
    if (hover) {
      hover = null;
      renderEditor();
    }
  });
  // Middle-click would otherwise start the browser's autoscroll.
  el.addEventListener("mousedown", (ev) => {
    if (ev.button === 1) ev.preventDefault();
  });

  // Alt+wheel zooms (as in Illustrator); Ctrl+wheel and trackpad pinch zoom too. Plain wheel scrolls, Shift+wheel scrolls sideways.
  el.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      const dx = ev.deltaX * unit;
      const dy = ev.deltaY * unit;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) zoomBy(Math.exp(-(dy || dx) * 0.002), ev.clientX, ev.clientY);
      else if (ev.shiftKey) panBy(-(dx || dy), 0);
      else panBy(-dx, -dy);
    },
    { passive: false },
  );

  for (const [t, sel] of Object.entries(TOOL_BUTTONS)) $(sel).onclick = () => setTool(t as Tool);
  $("#zoomIn").onclick = () => zoomBy(1.5);
  $("#zoomOut").onclick = () => zoomBy(1 / 1.5);
  $("#zoomFit").onclick = zoomFit;

  $input("#showGhost").onchange = renderEditor;
  $input("#solid").onchange = renderEditor;
  window.addEventListener("resize", () => renderEditor());

  document.addEventListener("keyup", (ev) => {
    if (ev.key === "Alt" && hover && state.tool === "select") {
      hover = null;
      renderEditor();
    }
    if (ev.key === " " && spaceDown) {
      spaceDown = false;
      renderEditor();
    }
  });
  window.addEventListener("blur", () => {
    spaceDown = false;
  });

  document.addEventListener("keydown", (ev) => {
    if (typing(ev.target)) {
      // Range sliders keep their arrows, but undo still works from them.
      const range = (ev.target as HTMLInputElement).type === "range";
      if (!(range && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z")) return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();

    // View: Space-drag pans; Ctrl + and Ctrl - zoom; Ctrl 0 fits the letter.
    if (ev.key === " ") {
      ev.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        hover = null;
        renderEditor();
      }
      return;
    }
    if (mod && (key === "=" || key === "+")) {
      ev.preventDefault();
      zoomBy(1.5);
      return;
    }
    if (mod && (key === "-" || key === "_")) {
      ev.preventDefault();
      zoomBy(1 / 1.5);
      return;
    }
    if (mod && key === "0") {
      ev.preventDefault();
      zoomFit();
      return;
    }
    // Ctrl+Y: Outline/Preview, as in Illustrator.
    if (mod && key === "y") {
      ev.preventDefault();
      $input("#solid").checked = !$input("#solid").checked;
      renderEditor();
      return;
    }
    if (mod && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) app.redo();
      else app.undo();
      return;
    }
    if (!isSimple()) return;
    if (mod && key === "a") {
      ev.preventDefault();
      if (ev.shiftKey) state.selPts.clear();
      else {
        const o = baseOutline(state.font!, currentGid(), proj());
        if (o) state.selPts = new Set(o.pts.map((_, i) => i));
      }
      app.renderAll();
      return;
    }
    if (!mod && !ev.altKey) {
      // Illustrator's letters: V/A select, P pen (adds points), + add anchor, - delete anchor, Shift+C anchor point (curves).
      const tool: Tool | null =
        key === "v" || key === "a"
          ? "select"
          : key === "p" || key === "+" || key === "="
            ? "add"
            : key === "-" || key === "_"
              ? "remove"
              : key === "c"
                ? "bend"
                : null;
      if (tool) {
        ev.preventDefault();
        setTool(tool);
        return;
      }
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
