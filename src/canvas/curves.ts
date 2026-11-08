/**
 * Converts TrueType contours (quadratic curves) into the cubic anchor-and-handle points that
 * Illustrator draws with. Every quadratic curve has an exact cubic equivalent, so the letters
 * arrive on the canvas exactly as the font draws them.
 */
import type { Point } from "../font/types";

/** One Illustrator anchor point. `in` is the handle arriving at the anchor, `out` the one leaving it. */
export interface Anchor {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  /** True when both handles line up through the anchor (Illustrator's smooth point). */
  smooth: boolean;
}

/** The contour's on-curve points, with the implied on-curve points between two off-curve points added. */
function expand(c: Point[]): Point[] {
  const out: Point[] = [];
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const a = c[i];
    const b = c[(i + 1) % n];
    out.push(a);
    if (!a.on && !b.on) out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  }
  if (!out.some((q) => q.on) && out.length) {
    // A contour of only off-curve points (rare, e.g. a perfect circle): every midpoint is on-curve.
    return expand(c.map((q) => ({ ...q, on: false })));
  }
  return out;
}

/** Converts one closed TrueType contour into Illustrator anchors, in the same direction. */
export function contourToAnchors(c: Point[]): Anchor[] {
  if (c.length < 2) return [];
  const seq = expand(c);
  const start = seq.findIndex((q) => q.on);
  const rot = [...seq.slice(start), ...seq.slice(0, start)];
  const anchors: Anchor[] = [];
  for (const q of rot) if (q.on) anchors.push({ x: q.x, y: q.y, ix: q.x, iy: q.y, ox: q.x, oy: q.y, smooth: false });

  // Walk the segments: on -> on is a line, on -> off -> on is a quadratic curve.
  let k = 0;
  for (let i = 0; i < rot.length; i++) {
    const q = rot[i];
    if (!q.on) continue;
    const a = anchors[k];
    const b = anchors[(k + 1) % anchors.length];
    const next = rot[(i + 1) % rot.length];
    if (!next.on) {
      // Exact quadratic-to-cubic: each handle is two thirds of the way to the control point.
      a.ox = a.x + (2 / 3) * (next.x - a.x);
      a.oy = a.y + (2 / 3) * (next.y - a.y);
      b.ix = b.x + (2 / 3) * (next.x - b.x);
      b.iy = b.y + (2 / 3) * (next.y - b.y);
    }
    k++;
  }
  const clean = dropZeroLength(anchors);
  for (const a of clean) a.smooth = isSmooth(a);
  return clean;
}

const same = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9;

/**
 * Some fonts (Tilt Warp, for one) contain zero-length curves: several points stacked in one spot.
 * In Illustrator they'd be stray anchors on top of each other, so merge them into one anchor.
 */
function dropZeroLength(anchors: Anchor[]): Anchor[] {
  const out = anchors.slice();
  for (let i = 0; out.length > 1 && i < out.length; ) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    if (same(a.x, a.y, b.x, b.y) && same(a.ox, a.oy, a.x, a.y) && same(b.ix, b.iy, b.x, b.y)) {
      a.ox = b.ox;
      a.oy = b.oy;
      out.splice((i + 1) % out.length, 1);
    } else i++;
  }
  return out;
}

function isSmooth(a: Anchor): boolean {
  const ux = a.x - a.ix;
  const uy = a.y - a.iy;
  const vx = a.ox - a.x;
  const vy = a.oy - a.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return false;
  const cross = (ux * vy - uy * vx) / (lu * lv);
  const dot = ux * vx + uy * vy;
  return dot > 0 && Math.abs(cross) < 0.02;
}

/** Point on a cubic segment at t, used by tests to check the conversion is exact. */
export function cubicAt(a: Anchor, b: Anchor, t: number): { x: number; y: number } {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * a.x + w1 * a.ox + w2 * b.ix + w3 * b.x, y: w0 * a.y + w1 * a.oy + w2 * b.iy + w3 * b.y };
}
