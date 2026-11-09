/**
 * Merging shapes: overlapping contours become one clean outline, like Illustrator's Unite.
 * Holes (shapes cut out with the opposite direction) stay holes, because the result follows the
 * font's non-zero fill. Paper.js does the path maths on cubic curves; TrueType's quadratics go in
 * exactly and come back within one font unit.
 */
// paper-core: the path maths without the canvas or scripting parts.
import paperCore from "paper/dist/paper-core.js";
const paper = paperCore as unknown as typeof import("paper");
import type { Point } from "../font/types";
import { contourToAnchors } from "../panel/curves";
import { cubicToQuadratic } from "../panel/quadratic";
import { signedArea, type Outline } from "./outline";

let ready = false;
function setup(): void {
  if (ready) return;
  paper.setup(new paper.Size(1, 1));
  ready = true;
}

/** A closed TrueType contour as a Paper.js path (quadratics become their exact cubics). */
function toPath(c: Point[]): paper.Path {
  const path = new paper.Path({ insert: false, closed: true });
  for (const a of contourToAnchors(c)) {
    path.add(new paper.Segment(new paper.Point(a.x, a.y), new paper.Point(a.ix - a.x, a.iy - a.y), new paper.Point(a.ox - a.x, a.oy - a.y)));
  }
  return path;
}

/** A Paper.js path back as a TrueType contour. */
function fromPath(path: paper.Path): Point[] {
  const out: Point[] = [];
  for (const cv of path.curves) {
    const p0 = { x: cv.point1.x, y: cv.point1.y };
    const p3 = { x: cv.point2.x, y: cv.point2.y };
    const p1 = { x: p0.x + cv.handle1.x, y: p0.y + cv.handle1.y };
    const p2 = { x: p3.x + cv.handle2.x, y: p3.y + cv.handle2.y };
    out.push(...cubicToQuadratic(p0, p1, p2, p3, 1));
  }
  // Round to font units and drop points that land on the one before.
  const r = out.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y), on: q.on }));
  const clean = r.filter((q, i) => {
    const p = r[(i - 1 + r.length) % r.length];
    return !(q.on && p.on && p.x === q.x && p.y === q.y);
  });
  return clean;
}

const contoursOf = (o: Outline): Point[][] => {
  const out: Point[][] = [];
  let s = 0;
  for (const e of o.ends) {
    out.push(o.pts.slice(s, e + 1));
    s = e + 1;
  }
  return out;
};

/**
 * Merges the contours numbered in `which` (all of them when empty) into clean outlines; the
 * others are kept as they are. Null when there's nothing to merge.
 */
export function mergeContours(o: Outline, which: number[]): Outline | null {
  setup();
  const all = contoursOf(o);
  const pick = which.length ? which : all.map((_, i) => i);
  if (!pick.length) return null;
  // Which way filled shapes run in this letter, so the result keeps the font's direction.
  let big = 0;
  for (const i of pick) {
    const a = signedArea(all[i]);
    if (Math.abs(a) > Math.abs(big)) big = a;
  }
  const cp = new paper.CompoundPath({ insert: false, fillRule: "nonzero" });
  for (const i of pick) cp.addChild(toPath(all[i]));
  const res = (cp as unknown as { resolveCrossings(): { reorient(nz: boolean, cw: boolean): paper.PathItem } }).resolveCrossings().reorient(true, true);
  const paths: paper.Path[] = res instanceof paper.CompoundPath ? (res.children as paper.Path[]) : [res as paper.Path];
  let merged = paths.map(fromPath).filter((c) => c.length >= 3);
  // reorient() decides direction in its own terms; flip everything if the biggest shape runs the wrong way.
  let mbig = 0;
  for (const c of merged) {
    const a = signedArea(c);
    if (Math.abs(a) > Math.abs(mbig)) mbig = a;
  }
  if (Math.sign(mbig) !== Math.sign(big)) merged = merged.map((c) => [...c].reverse());
  const keep = all.filter((_, i) => !pick.includes(i));
  const cs = [...keep, ...merged];
  const ends: number[] = [];
  let n = 0;
  for (const c of cs) ends.push((n += c.length) - 1);
  return { ends, pts: cs.flat() };
}
