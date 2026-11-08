/** A point in font units. `on` is false for quadratic off-curve control points. */
export interface Point {
  x: number;
  y: number;
  on: boolean;
}

export interface SimpleGlyph {
  type: "simple";
  /** Index of the last point of each contour. */
  ends: number[];
  pts: Point[];
}

/** 2x2 transform [xx, xy, yx, yy] as stored in a composite component. */
export type Matrix = [number, number, number, number];

export interface Component {
  gi: number;
  dx: number;
  dy: number;
  m: Matrix;
}

export interface CompositeGlyph {
  type: "composite";
  comps: Component[];
  /** Original glyf bytes with hinting instructions flagged off; bbox is patched on write. */
  raw: Uint8Array;
}

export interface EmptyGlyph {
  type: "empty";
}

export type Glyph = SimpleGlyph | CompositeGlyph | EmptyGlyph;

/** [xMin, yMin, xMax, yMax] */
export type BBox = [number, number, number, number];

export interface Font {
  upm: number;
  asc: number;
  desc: number;
  /** Number of glyphs. */
  N: number;
  adv: number[];
  lsb: number[];
  glyphs: Glyph[];
  /** Unicode code point -> glyph id. */
  cmap: Map<number, number>;
  /** Glyph id -> first code point that maps to it. */
  rev: Map<number, number>;
  xh: number;
  cap: number;
  /** Windows-platform name records by name id. */
  names: Record<number, string>;
  /** Raw bytes of every table in the source font, so unknown tables (GPOS, GSUB, GDEF…) carry over. */
  tables: Record<string, Uint8Array>;
}
