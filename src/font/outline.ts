import type { Font, Point } from "./types";

/**
 * Every contour of a glyph in font units, with composite glyphs (accented letters and the like)
 * resolved into plain contours by applying each component's offset and transform.
 */
export function glyphContours(f: Font, gid: number, depth = 0): Point[][] {
  const g = f.glyphs[gid];
  if (!g || depth > 8) return [];
  if (g.type === "simple") {
    const out: Point[][] = [];
    let s = 0;
    for (const e of g.ends) {
      out.push(g.pts.slice(s, e + 1).map((q) => ({ ...q })));
      s = e + 1;
    }
    return out;
  }
  if (g.type === "composite") {
    const out: Point[][] = [];
    for (const c of g.comps) {
      const [xx, xy, yx, yy] = c.m;
      for (const con of glyphContours(f, c.gi, depth + 1)) {
        out.push(con.map((q) => ({ x: q.x * xx + q.y * yx + c.dx, y: q.x * xy + q.y * yy + c.dy, on: q.on })));
      }
    }
    return out;
  }
  return [];
}
