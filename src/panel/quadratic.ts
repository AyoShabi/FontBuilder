/**
 * Turns Illustrator's cubic curves into TrueType's quadratic ones. A cubic can't always be drawn
 * exactly by one quadratic, so each curve is split into as few quadratic pieces as keep every
 * point within the tolerance (one font unit by default, invisible at any size). Curves that came
 * from the font in the first place convert back to one piece each.
 */
import type { Point } from "../font/types";

export interface XY {
  x: number;
  y: number;
}

const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubicPoint(p0: XY, p1: XY, p2: XY, p3: XY, t: number): XY {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function quadPoint(p0: XY, q: XY, p2: XY, t: number): XY {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * q.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * q.y + t * t * p2.y };
}

/** The part of a cubic between t0 and t1, as a cubic. */
function subCubic(p: XY[], t0: number, t1: number): XY[] {
  // de Casteljau split at t1, then split the first part at t0 / t1.
  const split = (c: XY[], t: number): [XY[], XY[]] => {
    const a = lerp(c[0], c[1], t);
    const b = lerp(c[1], c[2], t);
    const d = lerp(c[2], c[3], t);
    const e = lerp(a, b, t);
    const f = lerp(b, d, t);
    const g = lerp(e, f, t);
    return [
      [c[0], a, e, g],
      [g, f, d, c[3]],
    ];
  };
  const first = t1 < 1 ? split(p, t1)[0] : p;
  return t0 > 0 ? split(first, t0 / t1)[1] : first;
}

/** Distance from point p to segment ab. */
function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when the cubic is straight: both handles lie on the line between its ends. */
export function isStraight(p0: XY, p1: XY, p2: XY, p3: XY, tol: number): boolean {
  return distToSegment(p1, p0, p3) <= tol && distToSegment(p2, p0, p3) <= tol;
}

/**
 * The quadratic pieces for one cubic, as TrueType points after p0: off-curve controls, with an
 * on-curve point between pieces, ending with p3 on-curve.
 */
export function cubicToQuadratic(p0: XY, p1: XY, p2: XY, p3: XY, tol = 1): Point[] {
  if (isStraight(p0, p1, p2, p3, tol / 2)) return [{ x: p3.x, y: p3.y, on: true }];
  const cubic = [p0, p1, p2, p3];
  for (let n = 1; n <= 16; n++) {
    const out: Point[] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const [a, b, c, d] = subCubic(cubic, i / n, (i + 1) / n);
      // The quadratic that matches the cubic's ends and midpoint.
      const q = { x: (3 * (b.x + c.x) - (a.x + d.x)) / 4, y: (3 * (b.y + c.y) - (a.y + d.y)) / 4 };
      for (const t of [0.15, 0.3, 0.5, 0.7, 0.85]) {
        const e = cubicPoint(a, b, c, d, t);
        const f = quadPoint(a, q, d, t);
        if (Math.hypot(e.x - f.x, e.y - f.y) > tol) {
          ok = false;
          break;
        }
      }
      out.push({ x: q.x, y: q.y, on: false }, { x: d.x, y: d.y, on: true });
    }
    if (ok) return out;
  }
  // Very tight curves: fall back to straight pieces through the curve.
  const out: Point[] = [];
  for (let i = 1; i <= 32; i++) {
    const p = cubicPoint(p0, p1, p2, p3, i / 32);
    out.push({ x: p.x, y: p.y, on: true });
  }
  return out;
}
