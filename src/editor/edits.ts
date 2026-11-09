/**
 * Operations that change the current glyph. Each records an undo step before it changes anything
 * and returns whether it changed the project, so the UI knows to re-render.
 */
import { bbox } from "../font/geometry";
import type { BBox, Font, Point } from "../font/types";
import { ZONES, zonePts, type CustomGroup, type Zone } from "./groups";
import { pushUndo } from "./history";
import { applyOp, deleteOps, isLine, shapeOp, splitIndex, type Outline, type OutlineOp } from "./outline";
import { advOf, baseOutline, cleanEdit, contours, editedPts, heightMapper, trackingShift } from "./project";
import { currentGid, font, glyphEdit, linkedGids, proj, state } from "./state";

export type PointMap = (q: Point, box: BBox) => { x: number; y: number };

/** What a reshape acts on: the selected points, a zone, or the whole glyph. */
export type Target = { kind: "points"; idx: number[] } | { kind: "zone"; zone: Zone } | { kind: "all" };

/**
 * The current target. A zone counts only while the selection is still exactly that zone's points,
 * so selecting points by hand afterwards goes back to a plain point edit.
 */
export function currentTarget(): Target {
  const sel = state.selPts;
  if (!sel.size) return { kind: "all" };
  if (state.zone) {
    const zone = ZONES[state.zone];
    const zp = zonePts(font(), currentGid(), zone, proj());
    if (zp.length === sel.size && zp.every((i) => sel.has(i))) return { kind: "zone", zone };
  }
  return { kind: "points", idx: [...sel] };
}

/** Selects the picked zone's points in the current glyph. */
export function selectZone(): void {
  state.selPts = state.zone && state.font ? new Set(zonePts(state.font, currentGid(), ZONES[state.zone], proj())) : new Set();
}

/**
 * Glyphs the current target applies to. Hand-picked points apply to the current glyph only,
 * because point numbers don't match between glyphs.
 */
export function targetGids(t = currentTarget()): number[] {
  return t.kind === "points" ? [currentGid()] : linkedGids();
}

function movePtsOf(f: Font, gid: number, idx: number[], fn: PointMap): void {
  if (!idx.length) return;
  const pts = editedPts(f, gid, proj());
  const e = glyphEdit(gid);
  e.pts = e.pts || {};
  const bx = bbox(idx.map((i) => pts[i]))!;
  for (const i of idx) {
    const q = pts[i];
    const n = fn(q, bx);
    const d = e.pts[i] || [0, 0];
    e.pts[i] = [d[0] + Math.round(n.x - q.x), d[1] + Math.round(n.y - q.y)];
  }
  cleanEdit(e);
}

/**
 * Moves the selected points, or every point when none are selected. With a linked group, a
 * whole-glyph or zone edit runs on every simple glyph in the group as one undo step.
 */
export function movePts(fn: PointMap, t = currentTarget()): boolean {
  const f = font();
  if (f.glyphs[currentGid()].type !== "simple") return false;
  pushUndo();
  for (const gid of targetGids(t)) {
    const base = baseOutline(f, gid, proj());
    if (!base?.fits) continue;
    const n = base.pts.length;
    const idx =
      t.kind === "points" ? t.idx.filter((i) => i < n) : t.kind === "zone" ? zonePts(f, gid, t.zone, proj()) : base.pts.map((_, i) => i);
    movePtsOf(f, gid, idx, fn);
  }
  return true;
}

export type ReshapeKey = "sx-" | "sx+" | "sy-" | "sy+" | "sk+" | "sk-" | "up" | "dn";

const SCALE_STEP = 0.04;
const SLANT = Math.tan((2 * Math.PI) / 180);

/**
 * The inspector's reshape buttons. Horizontal scaling is about the selection's centre.
 * Vertical scaling is about the selection's centre, or the baseline for the whole glyph, or
 * `anchorY` when given (a zone's edge).
 */
export function reshapeOp(k: ReshapeKey, upm: number, hasSelection: boolean, anchorY?: number): PointMap {
  const cx = (bx: BBox) => (bx[0] + bx[2]) / 2;
  const cy = (bx: BBox) => (anchorY != null ? anchorY : hasSelection ? (bx[1] + bx[3]) / 2 : 0);
  const sx = (s: number): PointMap => (q, bx) => ({ x: cx(bx) + (q.x - cx(bx)) * s, y: q.y });
  const sy = (s: number): PointMap => (q, bx) => ({ x: q.x, y: cy(bx) + (q.y - cy(bx)) * s });
  const ops: Record<ReshapeKey, PointMap> = {
    "sx-": sx(1 - SCALE_STEP),
    "sx+": sx(1 + SCALE_STEP),
    "sy-": sy(1 - SCALE_STEP),
    "sy+": sy(1 + SCALE_STEP),
    "sk+": (q) => ({ x: q.x + q.y * SLANT, y: q.y }),
    "sk-": (q) => ({ x: q.x - q.y * SLANT, y: q.y }),
    up: (q) => ({ x: q.x, y: q.y + upm * 0.01 }),
    dn: (q) => ({ x: q.x, y: q.y - upm * 0.01 }),
  };
  return ops[k];
}

export type Metric = "lsb" | "rsb" | "adv";

/** Sets a side bearing or the advance width of the current glyph, or of every glyph in the linked group, to `val`. */
export function setMetric(which: Metric, val: number): boolean {
  if (!Number.isFinite(val)) return false;
  const f = font();
  const p = proj();
  pushUndo();
  for (const gid of linkedGids()) {
    const box = bbox(contours(f, gid, p).flat());
    const adv = advOf(f, gid, p);
    const e = glyphEdit(gid);
    if (which === "lsb" && box && f.glyphs[gid].type === "simple") {
      e.shift = (e.shift || 0) + Math.round(val - box[0]);
    } else if (which === "rsb") {
      const cur = box ? adv - box[2] : adv;
      e.adv = (e.adv || 0) + Math.round(val - cur);
    } else if (which === "adv") {
      e.adv = (e.adv || 0) + Math.round(val - adv);
    }
  }
  return true;
}

/** Moves point `i` of the current glyph to (x, y). */
export function setPoint(i: number, x: number, y: number): void {
  const q = editedPts(font(), currentGid(), proj())[i];
  const e = glyphEdit();
  e.pts = e.pts || {};
  pushUndo();
  const d = e.pts[i] || [0, 0];
  e.pts[i] = [d[0] + Math.round(x - q.x), d[1] + Math.round(y - q.y)];
  cleanEdit(e);
}

/** Can points be added to or removed from glyph `gid`? Only simple glyphs whose edits fit this font. */
export function canEditPoints(gid = currentGid()): boolean {
  return !!baseOutline(font(), gid, proj())?.fits;
}

/** The outline with points moved but not shifted, so new offsets come out as edited minus base. */
function moved(base: Outline, d: Record<number, [number, number]> | undefined): Outline {
  return { ends: base.ends, pts: base.pts.map((q, i) => ({ x: q.x + (d?.[i]?.[0] || 0), y: q.y + (d?.[i]?.[1] || 0), on: q.on })) };
}

/**
 * Applies add/remove steps to the current glyph. Each step runs on both the unmoved outline and
 * the moved one, and the new offsets are the difference, so moved points stay where they are.
 */
function applyStructural(ops: OutlineOp[]): boolean {
  const gid = currentGid();
  const p = proj();
  const start = baseOutline(font(), gid, p);
  if (!start?.fits || !ops.length) return false;
  let base: Outline | null = start;
  let ed: Outline | null = moved(base, p.edits[gid]?.pts);
  for (const op of ops) {
    base = applyOp(base, op);
    ed = applyOp(ed!, op);
    if (!base || !ed || base.pts.length !== ed.pts.length) return false;
  }
  pushUndo();
  const e = glyphEdit(gid);
  e.ops = [...(e.ops || []), ...ops];
  const pts: Record<number, [number, number]> = {};
  base.pts.forEach((q, i) => {
    const dx = Math.round(ed!.pts[i].x - q.x);
    const dy = Math.round(ed!.pts[i].y - q.y);
    if (dx || dy) pts[i] = [dx, dy];
  });
  e.pts = pts;
  cleanEdit(e);
  return true;
}

/**
 * Adds an on-curve point to the current glyph on the segment at point `i` (see SegmentHit),
 * at fraction `t` along it. Curves keep their shape. Returns the new point's index.
 */
export function addPoint(i: number, t: number): number | null {
  const base = baseOutline(font(), currentGid(), proj());
  if (!base?.fits || i < 0 || i >= base.pts.length) return null;
  const at = splitIndex(base, i);
  if (!applyStructural([{ split: i, t: Math.round(t * 1e4) / 1e4 }])) return null;
  state.selPts = new Set([at]);
  return at;
}

/**
 * Turns the straight line starting at on-curve point `i` of the current glyph into a curve, by
 * adding a control point halfway along it. Returns the control point's index, selected.
 */
export function bendLine(i: number): number | null {
  const base = baseOutline(font(), currentGid(), proj());
  if (!base?.fits || !isLine(base, i)) return null;
  if (!applyStructural([{ bend: i }])) return null;
  state.selPts = new Set([i + 1]);
  return i + 1;
}

/**
 * Adds a closed shape to the current glyph: filled, or cutting a hole where it overlaps.
 * The new shape's points are selected, so it can be moved straight away. Returns false if the glyph can't take it.
 */
export function addShape(pts: Point[], cut: boolean): boolean {
  const base = baseOutline(font(), currentGid(), proj());
  if (!base?.fits || pts.length < 3) return false;
  const gid = currentGid();
  const p = proj();
  const first = base.pts.length;
  const op = shapeOp(base, pts, cut);
  if (!applyStructural([op])) return false;
  // The shape is stored where it was drawn, before the letter's shift and height changes are
  // applied; offsets put it back exactly under the pointer.
  const sh = (p.edits[gid]?.shift || 0) + trackingShift(p);
  const my = heightMapper(font(), gid, p);
  const e = glyphEdit(gid);
  e.pts = e.pts || {};
  for (let k = 0; k < op.shape.length / 3; k++) {
    const y = op.shape[k * 3 + 1];
    const dx = -sh;
    const dy = my ? Math.round(y - my(y)) : 0;
    if (dx || dy) e.pts[first + k] = [dx, dy];
  }
  cleanEdit(e);
  state.selPts = new Set(pts.map((_, k) => first + k));
  return true;
}

/** Removes the selected points of the current glyph. */
export function deletePoints(idx: Iterable<number> = state.selPts): boolean {
  const gid = currentGid();
  const p = proj();
  const base = baseOutline(font(), gid, p);
  if (!base?.fits) return false;
  // Decide merges on the outline as the user sees it.
  const ok = applyStructural(deleteOps(moved(base, p.edits[gid]?.pts), idx));
  if (ok) state.selPts = new Set();
  return ok;
}

/** Number of points in the current glyph's outline. */
export function pointCount(): number {
  return state.font ? (baseOutline(state.font, currentGid(), proj())?.pts.length ?? 0) : 0;
}

/** Resets the current glyph, or every glyph in the linked group. */
export function resetGlyph(): void {
  pushUndo();
  for (const gid of linkedGids()) delete proj().edits[gid];
  state.selPts.clear();
}

export function resetAll(): void {
  pushUndo();
  const p = proj();
  p.edits = {};
  p.tracking = 0;
  state.selPts.clear();
}

/** Adds a user group and returns its index. */
export function addGroup(name: string, chars: string): number {
  pushUndo();
  const p = proj();
  p.groups = p.groups || [];
  p.groups.push({ name, chars });
  return p.groups.length - 1;
}

export function updateGroup(i: number, patch: Partial<CustomGroup>): void {
  const g = proj().groups?.[i];
  if (!g) return;
  pushUndo();
  Object.assign(g, patch);
}

export function deleteGroup(i: number): void {
  const p = proj();
  if (!p.groups?.[i]) return;
  pushUndo();
  p.groups.splice(i, 1);
}
