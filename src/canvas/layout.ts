/**
 * Lays out the Illustrator canvas for a font: one artboard per letter, grouped in rows by design
 * stage. Each artboard is exactly as wide as the letter's advance width, so its left and right
 * edges are the letter's side bearings, and its baseline sits at a fixed height inside it.
 *
 * Coordinates are Illustrator scripting coordinates in points, with y going up. The host script
 * shifts the whole layout onto the middle of the canvas, so only relative positions matter here.
 */
import type { Font } from "../font/types";
import { glyphContours } from "../font/outline";
import { STAGES, stageChars } from "../stages";
import { contourToAnchors, type Anchor } from "./curves";

/** Height of the em (one font unit times the units per em) on the canvas, in points. */
export const EM_POINTS = 500;
/** Space between artboards in a row. */
const GAP_X = 60;
/** Space between rows, which also leaves room for the stage title above a row. */
const GAP_Y = 120;
/** Rows wrap once they are this wide. Illustrator's canvas is 16383 pt square. */
const ROW_WIDTH = 7000;
/** Extra room above the ascender and below the descender inside each artboard, as a share of the em. */
const PAD = 0.12;

export type Rect = [left: number, top: number, right: number, bottom: number];

export interface Cell {
  char: string;
  /** Artboard name: the character, or a readable name for ones that can't be shown alone. */
  name: string;
  gid: number;
  stage: string;
  rect: Rect;
  /** Where the letter's origin (left side bearing on the baseline) sits. */
  ox: number;
  oy: number;
  /** Outline already scaled and placed, as Illustrator anchors. */
  contours: Anchor[][];
}

export interface GuideLine {
  y: number;
  x1: number;
  x2: number;
}

export interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface CanvasSpec {
  title: string;
  /** Points per font unit. */
  scale: number;
  cells: Cell[];
  guides: GuideLine[];
  labels: Label[];
  /** Bounds of everything: [left, top, right, bottom]. */
  bounds: Rect;
  /** Saved inside the document, so FontBuilder can find the source font and scale again on export. */
  meta: CanvasMeta;
}

export interface CanvasMeta {
  app: "FontBuilder";
  version: 1;
  source: { family: string; style: string; path: string | null };
  upm: number;
  scale: number;
  metrics: { asc: number; desc: number; xh: number; cap: number };
  glyphs: { name: string; char: string; gid: number }[];
}

const NAMES: Record<string, string> = {
  " ": "space",
  ".": "period",
  ",": "comma",
  ":": "colon",
  ";": "semicolon",
  "'": "quotesingle",
  '"': "quotedbl",
  "-": "hyphen",
  "(": "parenleft",
  ")": "parenright",
};

export function artboardName(ch: string): string {
  return NAMES[ch] || ch;
}

/** Distance in points from an artboard's top edge down to the baseline, for a canvas's saved data. */
export function baselineFromTop(meta: Pick<CanvasMeta, "metrics" | "upm" | "scale">): number {
  return (meta.metrics.asc + PAD * meta.upm) * meta.scale;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface LayoutOptions {
  /** Which design stages to lay out, by index into STAGES. Defaults to all. */
  stages?: number[];
  source: { family: string; style: string; path: string | null };
}

export function layoutCanvas(f: Font, opts: LayoutOptions): CanvasSpec {
  const s = EM_POINTS / f.upm;
  const asc = f.asc;
  const desc = f.desc; // negative
  const pad = PAD * f.upm;
  const above = (asc + pad) * s; // baseline to artboard top
  const below = (-desc + pad) * s; // baseline to artboard bottom
  const rowH = above + below;

  const cells: Cell[] = [];
  const guides: GuideLine[] = [];
  const labels: Label[] = [];
  // Lines the font doesn't define (a zero x-height, say) are left out; the baseline always stays.
  const metricLines = (
    [
      ["ascender", asc],
      ["cap height", f.cap],
      ["x-height", f.xh],
      ["baseline", 0],
      ["descender", desc],
    ] as [string, number][]
  ).filter(([name, v]) => v !== 0 || name === "baseline");

  let top = 0;
  const stages = opts.stages ?? STAGES.map((_, i) => i);
  let maxRight = 0;
  for (const si of stages) {
    const stage = STAGES[si];
    const chars = stageChars(si).filter((ch) => {
      const g = f.cmap.get(ch.codePointAt(0)!);
      return g != null && f.glyphs[g] && f.glyphs[g].type !== "empty";
    });
    if (!chars.length) continue;
    labels.push({ text: `${si + 1}. ${stage.title}`, x: 0, y: top + 60, size: 36 });

    let x = 0;
    let rowTop = top;
    const rows: { top: number; right: number }[] = [];
    for (const ch of chars) {
      const gid = f.cmap.get(ch.codePointAt(0)!)!;
      const w = Math.max(1, f.adv[gid]) * s;
      if (x > 0 && x + w > ROW_WIDTH) {
        rows.push({ top: rowTop, right: x - GAP_X });
        x = 0;
        rowTop -= rowH + GAP_Y;
      }
      const oy = rowTop - above;
      const rect: Rect = [r2(x), r2(rowTop), r2(x + w), r2(rowTop - rowH)];
      const contours = glyphContours(f, gid)
        .map((c) => contourToAnchors(c))
        .filter((c) => c.length > 1)
        .map((c) =>
          c.map((a) => ({
            x: r2(x + a.x * s),
            y: r2(oy + a.y * s),
            ix: r2(x + a.ix * s),
            iy: r2(oy + a.iy * s),
            ox: r2(x + a.ox * s),
            oy: r2(oy + a.oy * s),
            smooth: a.smooth,
          })),
        );
      cells.push({ char: ch, name: artboardName(ch), gid, stage: stage.id, rect, ox: r2(x), oy: r2(oy), contours });
      for (const [, v] of metricLines) guides.push({ y: r2(oy + v * s), x1: rect[0], x2: rect[2] });
      x += w + GAP_X;
    }
    rows.push({ top: rowTop, right: x - GAP_X });
    for (const row of rows) {
      const oy = row.top - above;
      for (const [name, v] of metricLines) labels.push({ text: name, x: -150, y: r2(oy + v * s + 4), size: 14 });
      maxRight = Math.max(maxRight, row.right);
    }
    top = rows[rows.length - 1].top - rowH - GAP_Y - 80;
  }

  const meta: CanvasMeta = {
    app: "FontBuilder",
    version: 1,
    source: opts.source,
    upm: f.upm,
    scale: s,
    metrics: { asc, desc, xh: f.xh, cap: f.cap },
    glyphs: cells.map((c) => ({ name: c.name, char: c.char, gid: c.gid })),
  };
  return {
    title: `${opts.source.family} ${opts.source.style}`.trim(),
    scale: s,
    cells,
    guides,
    labels,
    bounds: [-160, 100, r2(maxRight), r2(top + GAP_Y + 80)],
    meta,
  };
}
