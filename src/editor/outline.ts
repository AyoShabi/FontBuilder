/**
 * Adding and removing points.
 *
 * Point moves are stored as offsets from the source outline, keyed by point number, so they
 * carry over to every weight and width of a family (all cuts share the same points). Adding or
 * removing a point changes the point numbers, so those changes are stored as a list of steps
 * ("split the curve controlled by point 7 at 40%", "remove point 12") that is replayed on the
 * source outline of whatever cut is loaded. Offsets then key into the outline after the steps.
 *
 * A split is worked out in the same proportions on every cut, so a point added in the Regular
 * lands in the matching place on the Bold.
 */
import type { Point } from "../font/types";

export interface Outline {
  /** Index of the last point of each contour. */
  ends: number[];
  pts: Point[];
}

export type OutlineOp =
  /** Split the segment at point `split` at fraction `t`: the curve it controls if it's off-curve, or the line from it to the next point. */
  | { split: number; t: number }
  /** Remove point `del`. With `join`, an on-curve point between two off-curves is removed and the two curves merged into one. */
  | { del: number; join?: boolean }
  /** Turn the straight line from on-curve point `bend` to the next on-curve point into a curve, with its control point halfway along. */
  | { bend: number };

type XY = { x: number; y: number };
const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const on = (q: XY): Point => ({ x: q.x, y: q.y, on: true });
const off = (q: XY): Point => ({ x: q.x, y: q.y, on: false });

/** First and last index of the contour holding point i, or null if i isn't in the outline. */
export function contourOf(o: Outline, i: number): [number, number] | null {
  let s = 0;
  for (const e of o.ends) {
    if (i >= s && i <= e) return [s, e];
    s = e + 1;
  }
  return null;
}

function neighbours(o: Outline, i: number): { prev: number; next: number } | null {
  const c = contourOf(o, i);
  if (!c) return null;
  const [s, e] = c;
  return { prev: i === s ? e : i - 1, next: i === e ? s : i + 1 };
}

/** Replaces point i with `seq`, keeping contour ends right. */
function replace(o: Outline, i: number, seq: Point[]): Outline {
  const c = contourOf(o, i)!;
  const grow = seq.length - 1;
  const pts = [...o.pts.slice(0, i), ...seq, ...o.pts.slice(i + 1)];
  const ends: number[] = [];
  for (const e of o.ends) {
    if (e < c[0]) ends.push(e);
    else if (e === c[1]) {
      if (c[1] - c[0] + 1 + grow > 0) ends.push(e + grow);
    } else ends.push(e + grow);
  }
  return { ends, pts };
}

/**
 * Splits a segment. Off-curve point i: the quadratic curve it controls is cut at t, which keeps
 * its shape exactly. Where the curve starts or ends at an implied on-curve point (between two
 * off-curves), that point is written out first so the neighbouring curves keep their shape too.
 * On-curve point i followed by an on-curve point: a point is put on the line at t.
 */
function split(o: Outline, i: number, t: number): Outline | null {
  const n = neighbours(o, i);
  if (!n || !(t > 0 && t < 1) || n.next === i) return null;
  const P = o.pts;
  const c = P[i];
  if (c.on) {
    if (!P[n.next].on) return null;
    return replace(o, i, [c, on(lerp(c, P[n.next], t))]);
  }
  const a = P[n.prev];
  const b = P[n.next];
  if (n.prev === n.next && !a.on) return null;
  const p0 = a.on ? a : lerp(a, c, 0.5);
  const p2 = b.on ? b : lerp(c, b, 0.5);
  const c1 = lerp(p0, c, t);
  const c2 = lerp(c, p2, t);
  const seq = [off(c1), on(lerp(c1, c2, t)), off(c2)];
  if (!a.on) seq.unshift(on(p0));
  if (!b.on) seq.push(on(p2));
  return replace(o, i, seq);
}

/** Where the tangent lines out of a and b (towards ca and cb) meet, if they meet ahead of both. */
function meet(a: XY, ca: XY, b: XY, cb: XY): XY | null {
  const d1 = { x: ca.x - a.x, y: ca.y - a.y };
  const d2 = { x: cb.x - b.x, y: cb.y - b.y };
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / den;
  const v = ((b.x - a.x) * d1.y - (b.y - a.y) * d1.x) / den;
  if (u < 1 || v < 1 || u > 50 || v > 50) return null;
  return { x: a.x + d1.x * u, y: a.y + d1.y * u };
}

/** Is on-curve point i between two curves (on, off, [i], off, on) that a removal could merge? */
function joinShape(o: Outline, i: number): boolean {
  const n = neighbours(o, i);
  if (!n || !o.pts[i].on) return false;
  const P = o.pts;
  const pp = neighbours(o, n.prev)!.prev;
  const nn = neighbours(o, n.next)!.next;
  const c = contourOf(o, i)!;
  return c[1] - c[0] + 1 >= 5 && !P[n.prev].on && !P[n.next].on && P[pp].on && P[nn].on;
}

/** Merge only where the two curves flow into each other, so removing the point keeps the shape. */
function joinable(o: Outline, i: number): boolean {
  if (!joinShape(o, i)) return false;
  const P = o.pts;
  const n = neighbours(o, i)!;
  return !!meet(P[neighbours(o, n.prev)!.prev], P[n.prev], P[neighbours(o, n.next)!.next], P[n.next]);
}

function del(o: Outline, i: number, join: boolean): Outline | null {
  if (!contourOf(o, i)) return null;
  if (!join) return replace(o, i, []);
  if (!joinShape(o, i)) return null;
  const n = neighbours(o, i)!;
  const P = o.pts;
  const pp = neighbours(o, n.prev)!.prev;
  const nn = neighbours(o, n.next)!.next;
  const m = meet(P[pp], P[n.prev], P[nn], P[n.next]);
  // Where the tangents don't meet ahead (possible on another cut), use the control that keeps
  // the curve passing through the removed point. Either way the steps leave the same points.
  const c = m || { x: 2 * P[i].x - (P[pp].x + P[nn].x) / 2, y: 2 * P[i].y - (P[pp].y + P[nn].y) / 2 };
  // Put the merged control point where the first one was, then drop the point and the second control.
  let r = replace(o, Math.max(i, n.next), []);
  r = replace(r, Math.min(i, n.next), []);
  const at = n.prev - (i < n.prev ? 1 : 0) - (n.next < n.prev ? 1 : 0);
  return replace(r, at, [off(c)]);
}

/** Index of the on-curve point a split adds. */
export function splitIndex(o: Outline, i: number): number {
  if (o.pts[i].on) return i + 1;
  return i + (o.pts[neighbours(o, i)!.prev].on ? 1 : 2);
}

/** Puts a control point halfway along the line after on-curve point i. The shape doesn't change until it's moved. */
function bend(o: Outline, i: number): Outline | null {
  const n = neighbours(o, i);
  if (!n || n.next === i) return null;
  const a = o.pts[i];
  const b = o.pts[n.next];
  if (!a.on || !b.on) return null;
  return replace(o, i, [a, off(lerp(a, b, 0.5))]);
}

/** Can the segment starting at point i be bent into a curve? (It's a straight line.) */
export function isLine(o: Outline, i: number): boolean {
  const n = neighbours(o, i);
  return !!n && n.next !== i && o.pts[i].on && o.pts[n.next].on;
}

export function applyOp(o: Outline, op: OutlineOp): Outline | null {
  if ("split" in op) return split(o, op.split, op.t);
  if ("bend" in op) return bend(o, op.bend);
  return del(o, op.del, !!op.join);
}

/** Replays steps on an outline. Null if a step doesn't fit, e.g. on a font with different points. */
export function applyOps(o: Outline, ops: OutlineOp[] | undefined): Outline | null {
  let r: Outline | null = o;
  for (const op of ops || []) {
    r = applyOp(r, op);
    if (!r) return null;
  }
  return r;
}

/**
 * The steps that remove the given points. On-curve points between two curves are removed by
 * merging the curves, so the outline keeps roughly its shape. A contour left with fewer than
 * three points can't enclose anything, so it goes entirely. */
export function deleteOps(o: Outline, idx: Iterable<number>): OutlineOp[] {
  const gone = new Set<number>();
  for (const i of idx) if (i >= 0 && i < o.pts.length) gone.add(i);
  let s = 0;
  for (const e of o.ends) {
    let left = 0;
    for (let k = s; k <= e; k++) if (!gone.has(k)) left++;
    if (left < 3) for (let k = s; k <= e; k++) gone.add(k);
    s = e + 1;
  }
  const ops: OutlineOp[] = [];
  let cur = o;
  // Source index of each point still in `cur`.
  let ids = o.pts.map((_, k) => k);
  for (;;) {
    let i = -1;
    for (let k = ids.length - 1; k >= 0 && i < 0; k--) if (gone.has(ids[k])) i = k;
    if (i < 0) break;
    const n = neighbours(cur, i)!;
    // Only merge when both controls stay, otherwise the merge would keep a point meant to go.
    const join = joinable(cur, i) && !gone.has(ids[n.prev]) && !gone.has(ids[n.next]);
    const op: OutlineOp = join ? { del: i, join: true } : { del: i };
    ops.push(op);
    cur = applyOp(cur, op)!;
    const removed = join ? [i, n.next] : [i];
    ids = ids.filter((_, k) => !removed.includes(k));
  }
  return ops;
}

/** Squared distance from p to the quadratic or straight segment, sampled; returns the best t too. */
function nearestOnSegment(p: XY, pts: XY[], steps = 48): { t: number; d2: number; at: XY } {
  const at = (t: number): XY => {
    if (pts.length === 2) return lerp(pts[0], pts[1], t);
    return lerp(lerp(pts[0], pts[1], t), lerp(pts[1], pts[2], t), t);
  };
  let best = { t: 0.5, d2: Infinity, at: at(0.5) };
  const check = (t: number) => {
    const q = at(t);
    const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d2 < best.d2) best = { t, d2, at: q };
  };
  for (let k = 1; k < steps; k++) check(k / steps);
  // Refine around the best sample.
  let h = 1 / steps;
  for (let r = 0; r < 12; r++) {
    h /= 2;
    const t0 = best.t;
    check(Math.max(1e-4, t0 - h));
    check(Math.min(1 - 1e-4, t0 + h));
  }
  return best;
}

export interface SegmentHit {
  /** The split step's point: the off-curve control, or the on-curve start of a line. */
  i: number;
  t: number;
  /** Where the new point goes. */
  at: XY;
  dist: number;
}

/** The segment nearest to p within `maxDist`, and where on it, for adding a point there. */
export function hitSegment(o: Outline, p: XY, maxDist: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  let s = 0;
  for (const e of o.ends) {
    for (let i = s; i <= e; i++) {
      const n = neighbours(o, i)!;
      const q = o.pts[i];
      let seg: XY[];
      if (q.on) {
        if (!o.pts[n.next].on || n.next === i) continue;
        seg = [q, o.pts[n.next]];
      } else {
        const a = o.pts[n.prev];
        const b = o.pts[n.next];
        seg = [a.on ? a : lerp(a, q, 0.5), q, b.on ? b : lerp(q, b, 0.5)];
      }
      const h = nearestOnSegment(p, seg);
      const dist = Math.sqrt(h.d2);
      if (dist <= maxDist && (!best || dist < best.dist)) best = { i, t: h.t, at: h.at, dist };
    }
    s = e + 1;
  }
  return best;
}
