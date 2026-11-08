import { describe, expect, it } from "vitest";
import { contourToAnchors, cubicAt } from "../src/canvas/curves";
import { glyphContours } from "../src/font/outline";
import type { Point } from "../src/font/types";
import { FAMILIES, loadFont } from "./helpers";

/** Point on the TrueType contour's segment from on-curve a, via optional control q, to on-curve b. */
function quadAt(a: Point, q: Point | null, b: Point, t: number) {
  if (!q) {
    // A straight line drawn as a cubic with its handles on the anchors (as Illustrator does) moves
    // along the line at this rate, so compare at the matching place.
    const s = 3 * t * t - 2 * t * t * t;
    return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
  }
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * q.x + t * t * b.x, y: u * u * a.y + 2 * u * t * q.y + t * t * b.y };
}

/** The TrueType contour as (start, control, end) segments, implied points added. */
function quadSegments(c: Point[]) {
  const pts: Point[] = [];
  c.forEach((p, i) => {
    const n = c[(i + 1) % c.length];
    pts.push(p);
    if (!p.on && !n.on) pts.push({ x: (p.x + n.x) / 2, y: (p.y + n.y) / 2, on: true });
  });
  const s = pts.findIndex((p) => p.on);
  const r = [...pts.slice(s), ...pts.slice(0, s)];
  const segs: [Point, Point | null, Point][] = [];
  for (let i = 0; i < r.length; i++) {
    if (!r[i].on) continue;
    const n = r[(i + 1) % r.length];
    if (n.on) segs.push([r[i], null, n]);
    else segs.push([r[i], n, r[(i + 2) % r.length]]);
  }
  // Zero-length segments are merged away by the converter.
  return segs.filter(([a, q, b]) => !(a.x === b.x && a.y === b.y && (!q || (q.x === a.x && q.y === a.y))));
}

describe("quadratic to cubic", () => {
  it("handles lines, curves and implied on-curve points", () => {
    const c: Point[] = [
      { x: 0, y: 0, on: true },
      { x: 0, y: 100, on: false },
      { x: 100, y: 100, on: false },
      { x: 100, y: 0, on: true },
    ];
    const a = contourToAnchors(c);
    expect(a.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [50, 100],
      [100, 0],
    ]);
    // The implied point between two controls is smooth.
    expect(a[1].smooth).toBe(true);
    expect(a[0].smooth).toBe(false);
  });

  it("is exact on every letter of every bundled font", () => {
    for (const fam of FAMILIES) {
      const f = loadFont(fam);
      for (const ch of "nonoHOHOhamburgefonstivQ&@8") {
        const gid = f.cmap.get(ch.codePointAt(0)!)!;
        for (const c of glyphContours(f, gid)) {
          const anchors = contourToAnchors(c);
          const segs = quadSegments(c);
          expect(anchors.length).toBe(segs.length);
          segs.forEach(([a, q, b], i) => {
            for (const t of [0.1, 0.33, 0.5, 0.8]) {
              const want = quadAt(a, q, b, t);
              const got = cubicAt(anchors[i], anchors[(i + 1) % anchors.length], t);
              expect(Math.abs(got.x - want.x)).toBeLessThan(1e-6);
              expect(Math.abs(got.y - want.y)).toBeLessThan(1e-6);
            }
          });
        }
      }
    }
  });
});
