import type { OutlineSource } from "../font/writer";
import type { Font, Point } from "../font/types";
import type { CustomGroup } from "./groups";
import { applyOps, type Outline, type OutlineOp } from "./outline";

/**
 * One glyph's edits. Points are stored as offsets from the source outline, not absolute positions,
 * so the same edits apply when the user switches to another weight or width of the family.
 */
export interface GlyphEdit {
  /**
   * Points added or removed, as steps replayed on the source outline of whichever cut is loaded.
   * Point numbers in `pts` refer to the outline after these steps.
   */
  ops?: OutlineOp[];
  /** Point index -> [dx, dy] in font units. */
  pts?: Record<number, [number, number]>;
  /** Horizontal shift of the whole glyph (changes the left side bearing). */
  shift?: number;
  /** Extra advance width. */
  adv?: number;
}

/** Changes to the font's key heights, in font units (positive is taller or deeper). */
export interface Heights {
  xh?: number;
  cap?: number;
  asc?: number;
  desc?: number;
}

export interface Project {
  edits: Record<number, GlyphEdit>;
  tracking: number;
  family: string;
  /** Style name of the exported font, e.g. "Regular", "Bold", "Black". */
  style?: string;
  heights?: Heights;
  /** Glyph groups the user made. */
  groups?: CustomGroup[];
  /** Index of the design stage being worked on (see stages.ts). */
  stage?: number;
  /** Characters the user has marked as reviewed, stored as characters so they survive other cuts. */
  reviewed?: string;
}

export const DEFAULT_FAMILY = "Brand Display";

export function newProject(): Project {
  return { edits: {}, tracking: 0, family: DEFAULT_FAMILY };
}

/** Tracking is split evenly either side of each glyph. */
export const trackingShift = (p: Project) => Math.round((p.tracking || 0) / 2);

/**
 * A simple glyph's outline with points added and removed but not moved. Null for other glyph
 * types. If the steps don't fit this font (an uploaded font with different points), the source
 * outline is returned with `fits: false` and the glyph's point moves are ignored.
 */
export function baseOutline(font: Font, gid: number, p: Project): (Outline & { fits: boolean }) | null {
  const G = font.glyphs[gid];
  if (G.type !== "simple") return null;
  const src = { ends: G.ends, pts: G.pts };
  const ops = p.edits[gid]?.ops;
  if (!ops?.length) return { ...src, fits: true };
  const r = applyOps(src, ops);
  return r ? { ...r, fits: true } : { ...src, fits: false };
}

export interface KeyHeights {
  xh: number;
  cap: number;
  /** Top of the lowercase ascenders (l, h, d...). */
  asc: number;
  /** Bottom of the lowercase descenders (p, q...). */
  desc: number;
}

const keyCache = new WeakMap<Font, KeyHeights>();

/** The font's own key heights, measured from its letters where the font's tables don't say. */
export function keyHeights(font: Font): KeyHeights {
  let k = keyCache.get(font);
  if (k) return k;
  const ext = (chars: string, top: boolean, fallback: number) => {
    for (const ch of chars) {
      const g = font.cmap.get(ch.codePointAt(0)!);
      const G = g != null ? font.glyphs[g] : null;
      if (G?.type === "simple" && G.pts.length) return top ? Math.max(...G.pts.map((q) => q.y)) : Math.min(...G.pts.map((q) => q.y));
    }
    return fallback;
  };
  k = {
    xh: font.xh || ext("xzvw", true, Math.round(font.upm * 0.5)),
    cap: font.cap || ext("HIEL", true, Math.round(font.upm * 0.7)),
    asc: ext("lhdkb", true, font.asc),
    desc: ext("pqgy", false, font.desc),
  };
  keyCache.set(font, k);
  return k;
}

/** The key heights after the project's height changes. */
export function newHeights(font: Font, p: Project): KeyHeights {
  const k = keyHeights(font);
  const h = p.heights || {};
  return { xh: k.xh + (h.xh || 0), cap: k.cap + (h.cap || 0), asc: k.asc + (h.asc || 0), desc: k.desc - (h.desc || 0) };
}

export const hasHeights = (p: Project) => !!p.heights && Object.values(p.heights).some((v) => v);

/** Piecewise-linear map through (from[i] -> to[i]), shifting by the end deltas beyond the ends. */
function remap(y: number, from: number[], to: number[]): number {
  const n = from.length;
  if (y <= from[0]) return y + to[0] - from[0];
  if (y >= from[n - 1]) return y + to[n - 1] - from[n - 1];
  for (let i = 1; i < n; i++) {
    if (y <= from[i]) {
      const a = from[i - 1];
      const b = from[i];
      return b === a ? to[i] : to[i - 1] + ((y - a) * (to[i] - to[i - 1])) / (b - a);
    }
  }
  return y;
}

const isLowercase = (font: Font, gid: number) => {
  const c = font.rev.get(gid);
  return c != null && /\p{Ll}/u.test(String.fromCodePoint(c));
};

/**
 * Moves a point of glyph `gid` for the project's height changes. Lowercase letters stretch
 * between the descender, baseline, x-height and ascender; everything else between the
 * descender, baseline and cap height. The baseline never moves.
 */
export function heightMapper(font: Font, gid: number, p: Project): ((y: number) => number) | null {
  if (!hasHeights(p)) return null;
  const k = keyHeights(font);
  const n = newHeights(font, p);
  // Keep the breakpoints in order even if a height is dragged past its neighbour.
  const from = isLowercase(font, gid) ? [k.desc, 0, k.xh, k.asc] : [k.desc, 0, k.cap];
  const to = isLowercase(font, gid) ? [Math.min(n.desc, -1), 0, Math.max(n.xh, 1), Math.max(n.asc, n.xh + 1)] : [Math.min(n.desc, -1), 0, Math.max(n.cap, 1)];
  if (from.some((v, i) => i > 0 && v <= from[i - 1])) return null;
  return (y) => Math.round(remap(y, from, to));
}

/** A simple glyph's outline with every edit applied. Empty for other glyph types. */
export function editedOutline(font: Font, gid: number, p: Project): Outline {
  const base = baseOutline(font, gid, p);
  if (!base) return { ends: [], pts: [] };
  const e = p.edits[gid];
  const d = base.fits ? e?.pts : undefined;
  const sh = (e?.shift || 0) + trackingShift(p);
  const my = heightMapper(font, gid, p);
  return {
    ends: base.ends,
    pts: base.pts.map((q, i) => ({ x: q.x + (d?.[i]?.[0] || 0) + sh, y: (my ? my(q.y) : q.y) + (d?.[i]?.[1] || 0), on: q.on })),
  };
}

/** Points of a simple glyph with the project's edits applied. Empty for other glyph types. */
export function editedPts(font: Font, gid: number, p: Project): Point[] {
  return editedOutline(font, gid, p).pts;
}

export function advOf(font: Font, gid: number, p: Project): number {
  const a = font.adv[gid];
  if (!a) return 0;
  const e = p.edits[gid];
  return Math.max(0, a + ((e && e.shift) || 0) + ((e && e.adv) || 0) + (p.tracking || 0));
}

/**
 * Resolved contours of a glyph, composites flattened through their components.
 * With `orig`, point edits are ignored (tracking still applies) to draw the original outline.
 */
export function contours(font: Font, gid: number, p: Project, depth = 0, orig = false): Point[][] {
  const G = font.glyphs[gid];
  if (!G) return [];
  if (G.type === "simple") {
    const o = orig
      ? { ends: G.ends, pts: G.pts.map((q) => ({ x: q.x + trackingShift(p), y: q.y, on: q.on })) }
      : editedOutline(font, gid, p);
    const pts = o.pts;
    const out: Point[][] = [];
    let s = 0;
    for (const e of o.ends) {
      out.push(pts.slice(s, e + 1));
      s = e + 1;
    }
    return out;
  }
  if (G.type === "composite" && depth < 8) {
    const out: Point[][] = [];
    for (const c of G.comps) {
      for (const ct of contours(font, c.gi, p, depth + 1, orig)) {
        out.push(
          ct.map((q) => ({
            x: q.x * c.m[0] + q.y * c.m[2] + c.dx,
            y: q.x * c.m[1] + q.y * c.m[3] + c.dy,
            on: q.on,
          })),
        );
      }
    }
    return out;
  }
  return [];
}

/** Drops point offsets that have returned to zero. */
export function cleanEdit(e: GlyphEdit): void {
  if (e.pts) for (const k in e.pts) if (!e.pts[k][0] && !e.pts[k][1]) delete e.pts[k];
}

export function isEdited(e: GlyphEdit | undefined): boolean {
  // Height changes apply to every glyph, so they aren't counted as a glyph's own edit.
  return !!(e && ((e.pts && Object.keys(e.pts).length) || e.ops?.length || e.shift || e.adv));
}

/** Adapts a font and project to what the writer needs. */
export function outlineSource(font: Font, p: Project): OutlineSource {
  return {
    outline: (gid) => (font.glyphs[gid].type === "simple" ? editedOutline(font, gid, p) : null),
    contours: (gid) => contours(font, gid, p),
    advance: (gid) => advOf(font, gid, p),
    heights: hasHeights(p) ? newHeights(font, p) : undefined,
  };
}
