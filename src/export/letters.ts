/**
 * Turns the letters read off the Illustrator canvas into TrueType outlines and advance widths.
 */
import type { Point } from "../font/types";
import type { CanvasMeta } from "../canvas/layout";
import { cubicToQuadratic } from "./quadratic";

/**
 * One Illustrator path point as host.jsx returns it, relative to the letter's origin (artboard's
 * left edge, on the baseline), in points: [anchor x, y, in-handle x, y, out-handle x, y].
 */
export type PathPoint = [number, number, number, number, number, number];

/** One Illustrator shape: a path on its own, or the paths of one compound path. */
export interface DrawnShape {
  /** The compound path's fill rule: even-odd, or Illustrator's default non-zero. */
  evenodd: boolean;
  paths: PathPoint[][];
}

export interface DrawnLetter {
  /** Artboard name. */
  name: string;
  /** Artboard width in points: the letter's advance width. */
  width: number;
  shapes: DrawnShape[];
}

export interface LetterOutline {
  gid: number;
  advance: number;
  ends: number[];
  pts: Point[];
}

/** Signed area of a closed polygon; positive is anticlockwise with y up. */
function area(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function inside(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** One Illustrator path as a TrueType contour in font units. */
export function pathToContour(path: PathPoint[], scale: number, tol = 1): Point[] {
  const k = 1 / scale;
  const pts: Point[] = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    const p0 = { x: a[0] * k, y: a[1] * k };
    if (i === 0) pts.push({ ...p0, on: true });
    const seg = cubicToQuadratic(p0, { x: a[4] * k, y: a[5] * k }, { x: b[2] * k, y: b[3] * k }, { x: b[0] * k, y: b[1] * k }, tol);
    // The last segment ends back at the first point, which is already in the contour.
    pts.push(...(i === n - 1 ? seg.slice(0, -1) : seg));
  }
  return tidy(pts.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y), on: q.on })));
}

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Drops on-curve points that land on the one before after rounding, and on-curve points in the middle of a straight line. */
function tidy(pts: Point[]): Point[] {
  let out: Point[] = [];
  for (const q of pts) {
    const p = out[out.length - 1];
    if (p && q.on && p.on && same(p, q)) continue;
    out.push(q);
  }
  while (out.length > 1 && out[0].on && out[out.length - 1].on && same(out[0], out[out.length - 1])) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const collinear = (b.x - a.x) * (c.y - a.y) === (c.x - a.x) * (b.y - a.y);
      const between = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
      if (a.on && b.on && c.on && collinear && between) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * For an even-odd compound path: sets each contour's direction from how deeply it is nested,
 * outlines clockwise (TrueType's convention), holes anticlockwise, islands inside holes clockwise
 * again. Contours that only overlap keep the same direction, so they fill as one.
 */
export function orientContours(cs: Point[][]): Point[][] {
  return cs.map((c, i) => {
    // Nested means wholly inside: every point of this contour is within the other. Shapes that
    // only overlap (a stem and a diagonal, say) aren't nested, so they stay solid where they cross.
    const depth = cs.reduce((d, o, j) => d + (j !== i && Math.abs(area(o)) > Math.abs(area(c)) && c.every((q) => inside(q, o)) ? 1 : 0), 0);
    const clockwise = area(c) < 0;
    const want = depth % 2 === 0;
    return clockwise === want ? c : reverse(c);
  });
}

const reverse = (c: Point[]): Point[] => {
  const r = [...c].reverse();
  const s = r.findIndex((q) => q.on);
  return [...r.slice(s), ...r.slice(0, s)];
};

/**
 * One shape's contours, turned so the font fills them as Illustrator shows them. Illustrator
 * fills a non-zero compound path by its paths' directions, so those are kept, and the whole shape
 * is turned if needed so its biggest contour runs clockwise. Separate shapes then all run the same
 * way and add up where they overlap, as they look on the canvas.
 */
export function shapeContours(sh: DrawnShape, scale: number, tol = 1): Point[][] {
  const cs = sh.paths.filter((p) => p.length >= 2).map((p) => pathToContour(p, scale, tol)).filter((c) => c.length >= 3);
  if (!cs.length) return cs;
  if (sh.evenodd) return orientContours(cs);
  const biggest = cs.reduce((a, c) => (Math.abs(area(c)) > Math.abs(area(a)) ? c : a));
  return area(biggest) > 0 ? cs.map(reverse) : cs;
}

/** Every drawn letter as a glyph outline, matched to its glyph through the canvas data. */
export function lettersToOutlines(letters: DrawnLetter[], meta: CanvasMeta, tol = 1): LetterOutline[] {
  const byName = new Map(meta.glyphs.map((g) => [g.name, g.gid]));
  const out: LetterOutline[] = [];
  for (const l of letters) {
    const gid = byName.get(l.name);
    if (gid == null) continue;
    const cs = l.shapes.flatMap((sh) => shapeContours(sh, meta.scale, tol));
    const pts = cs.flat();
    const ends: number[] = [];
    let n = 0;
    for (const c of cs) {
      n += c.length;
      ends.push(n - 1);
    }
    out.push({ gid, advance: Math.max(0, Math.round(l.width / meta.scale)), ends, pts });
  }
  return out;
}
