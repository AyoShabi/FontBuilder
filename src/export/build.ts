/**
 * Builds the brand font: the source font with every letter from the canvas replaced by what was
 * drawn, spacing taken from the artboard widths, and new names. Everything else in the source
 * font (other glyphs, kerning, features) is kept.
 */
import type { CanvasMeta } from "../canvas/layout";
import type { Font, Point } from "../font/types";
import { buildFont, type FontNaming } from "../font/writer";
import { glyphContours } from "../font/outline";
import { lettersToOutlines, type DrawnLetter, type LetterOutline } from "./letters";

export interface BuildResult {
  bytes: Uint8Array;
  /** Letters that came out empty, so the font will show nothing for them. */
  empty: string[];
}

function split(o: { ends: number[]; pts: Point[] }): Point[][] {
  const out: Point[][] = [];
  let s = 0;
  for (const e of o.ends) {
    out.push(o.pts.slice(s, e + 1));
    s = e + 1;
  }
  return out;
}

export function buildBrandFont(font: Font, meta: CanvasMeta, letters: DrawnLetter[], naming: FontNaming, tol = 1): BuildResult {
  const edited = new Map<number, LetterOutline>(lettersToOutlines(letters, meta, tol).map((o) => [o.gid, o]));
  const contours = (g: number, depth = 0): Point[][] => {
    const e = edited.get(g);
    if (e) return split(e);
    const G = font.glyphs[g];
    if (G?.type === "composite" && depth < 8) {
      return G.comps.flatMap((c) => {
        const [xx, xy, yx, yy] = c.m;
        return contours(c.gi, depth + 1).map((con) => con.map((q) => ({ x: q.x * xx + q.y * yx + c.dx, y: q.x * xy + q.y * yy + c.dy, on: q.on })));
      });
    }
    return glyphContours(font, g);
  };
  const bytes = buildFont(font, naming, {
    outline: (g) => edited.get(g) ?? null,
    contours: (g) => contours(g),
    advance: (g) => edited.get(g)?.advance ?? font.adv[g],
  });
  const empty = meta.glyphs.filter((g) => edited.has(g.gid) && !edited.get(g.gid)!.pts.length).map((g) => g.char);
  return { bytes, empty };
}
