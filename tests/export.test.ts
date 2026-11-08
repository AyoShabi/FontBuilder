import { describe, expect, it } from "vitest";
import { baselineFromTop, layoutCanvas, type CanvasMeta } from "../src/canvas/layout";
import { hostCall } from "../src/canvas/script";
import { buildBrandFont } from "../src/export/build";
import { orientContours, pathToContour, type DrawnLetter, type PathPoint } from "../src/export/letters";
import { cubicToQuadratic } from "../src/export/quadratic";
import { glyphContours } from "../src/font/outline";
import { parseFont } from "../src/font/parser";
import type { Font, Point } from "../src/font/types";
import { fakeIllustrator, makePath } from "./fakeIllustrator";
import { FAMILIES, loadFont } from "./helpers";

/** Dense samples along a TrueType contour. */
function samples(c: Point[], per = 12): { x: number; y: number }[] {
  const pts: Point[] = [];
  c.forEach((p, i) => {
    const n = c[(i + 1) % c.length];
    pts.push(p);
    if (!p.on && !n.on) pts.push({ x: (p.x + n.x) / 2, y: (p.y + n.y) / 2, on: true });
  });
  const s = pts.findIndex((p) => p.on);
  const r = [...pts.slice(s), ...pts.slice(0, s)];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < r.length; i++) {
    if (!r[i].on) continue;
    const a = r[i];
    const q = r[(i + 1) % r.length];
    const b = q.on ? q : r[(i + 2) % r.length];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const u = 1 - t;
      out.push(q.on ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } : { x: u * u * a.x + 2 * u * t * q.x + t * t * b.x, y: u * u * a.y + 2 * u * t * q.y + t * t * b.y });
    }
  }
  return out;
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Largest distance from any point on one glyph's outline to the other's (as a fine polyline). */
function outlineGap(a: Point[][], b: Point[][]): number {
  const sa = a.flatMap((c) => samples(c));
  const polys = b.map((c) => samples(c, 30));
  let worst = 0;
  for (const p of sa) {
    let best = Infinity;
    for (const poly of polys) for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % poly.length]));
    worst = Math.max(worst, best);
  }
  return worst;
}

const area = (c: Point[]) => c.reduce((s, p, i) => s + p.x * c[(i + 1) % c.length].y - c[(i + 1) % c.length].x * p.y, 0) / 2;

/** Builds the canvas in the stand-in Illustrator and reads it back, as the panel does. */
function roundTrip(f: Font, edit?: (il: ReturnType<typeof fakeIllustrator>) => void) {
  const spec = layoutCanvas(f, { source: { family: "Src", style: "Regular", path: null } });
  const il = fakeIllustrator();
  il.run(hostCall("fbBuildCanvas", { ...spec, metaJson: JSON.stringify(spec.meta) }));
  edit?.(il);
  const r = il.run(hostCall("fbReadLetters", baselineFromTop(spec.meta)));
  expect(r.startsWith("ok:")).toBe(true);
  return { spec, il, read: JSON.parse(r.slice(3)) as { letters: DrawnLetter[]; notes: string[]; outside: number } };
}

describe("cubic to quadratic", () => {
  it("turns a straight cubic into a line and a font curve back into one quadratic", () => {
    expect(cubicToQuadratic({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 })).toEqual([{ x: 100, y: 0, on: true }]);
    // The exact cubic of the quadratic (0,0) (50,100) (100,0).
    const q = cubicToQuadratic({ x: 0, y: 0 }, { x: 100 / 3, y: 200 / 3 }, { x: 200 / 3, y: 200 / 3 }, { x: 100, y: 0 });
    expect(q).toHaveLength(2);
    expect(q[0].x).toBeCloseTo(50);
    expect(q[0].y).toBeCloseTo(100);
  });

  it("splits a true cubic (an S-curve) into pieces within tolerance", () => {
    const q = cubicToQuadratic({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: -200, y: 300 }, { x: 100, y: 300 });
    expect(q.length).toBeGreaterThan(2);
    expect(q[q.length - 1]).toEqual({ x: 100, y: 300, on: true });
  });
});

describe("contour direction", () => {
  it("makes outlines clockwise and holes anticlockwise, whichever way they were drawn", () => {
    const sq = (x: number, y: number, s: number, cw: boolean): PathPoint[] => {
      const pts: [number, number][] = cw ? [[x, y], [x, y + s], [x + s, y + s], [x + s, y]] : [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
      return pts.map(([a, b]) => [a, b, a, b, a, b]);
    };
    const outer = pathToContour(sq(0, 0, 100, false), 1);
    const hole = pathToContour(sq(25, 25, 50, false), 1);
    const [o, h] = orientContours([outer, hole]);
    expect(area(o)).toBeLessThan(0);
    expect(area(h)).toBeGreaterThan(0);
  });
});

describe("export round trip", () => {
  it("gives back every letter of every bundled font within a unit or two, with the same spacing", () => {
    for (const fam of FAMILIES) {
      const f = loadFont(fam);
      const { spec, read } = roundTrip(f);
      expect(read.outside).toBe(0);
      const { bytes, empty } = buildBrandFont(f, spec.meta, read.letters, { family: "Umba Display", style: "Regular" });
      expect(empty).toEqual([]);
      const g = parseFont(bytes.slice().buffer);
      expect(g.N).toBe(f.N);
      for (const cell of spec.cells) {
        const a = glyphContours(f, cell.gid);
        const b = glyphContours(g, cell.gid);
        expect(g.adv[cell.gid], `${fam} ${cell.char} advance`).toBe(f.adv[cell.gid]);
        expect(b.length, `${fam} ${cell.char} contours`).toBe(a.length);
        expect(outlineGap(a, b), `${fam} ${cell.char}`).toBeLessThan(2.5);
        expect(outlineGap(b, a), `${fam} ${cell.char}`).toBeLessThan(2.5);
        // Same fill: holes still cut out, so the total signed area keeps its size. (Direction may
        // flip as a whole: some fonts wind outlines anticlockwise, FontBuilder writes clockwise.)
        const sa = a.reduce((s, c) => s + area(c), 0);
        const sb = b.reduce((s, c) => s + area(c), 0);
        expect(Math.abs(Math.abs(sb) - Math.abs(sa)) / Math.abs(sa), `${fam} ${cell.char} area`).toBeLessThan(0.02);
      }
      // Glyphs that weren't on the canvas are untouched, and names are new.
      expect(g.cmap).toEqual(f.cmap);
      expect(g.names[1]).toBe("Umba Display");
      expect(g.names[0]).toBe(f.names[0]);
      expect(g.names[13]).toBe(f.names[13]);
    }
  }, 120_000);

  it("takes spacing from the artboard width and edits from the paths", () => {
    const f = loadFont("anybody");
    const { spec, read } = roundTrip(f, (il) => {
      const doc = il.app.documents[0];
      // Widen n's artboard by 50 pt and move one of its points up 10 pt.
      const ab = doc.artboards[0];
      ab.artboardRect = [ab.artboardRect[0], ab.artboardRect[1], ab.artboardRect[2] + 50, ab.artboardRect[3]];
      const pt = doc.layers[0].compoundPathItems[0].pathItems[0].pathPoints[0];
      pt.anchor = [pt.anchor[0], pt.anchor[1] + 10];
    });
    const n = spec.cells[0];
    const { bytes } = buildBrandFont(f, spec.meta, read.letters, { family: "Umba", style: "Bold" });
    const g = parseFont(bytes.slice().buffer);
    expect(g.adv[n.gid]).toBe(f.adv[n.gid] + Math.round(50 / spec.scale));
    const moved = glyphContours(g, n.gid)[0].find((q) => q.on && q.x === Math.round(n.contours[0][0].x / spec.scale) && q.y === Math.round((n.contours[0][0].y - n.oy) / spec.scale) + Math.round(10 / spec.scale));
    expect(moved).toBeTruthy();
    expect(g.names[2]).toBe("Bold");
    expect(g.names[6]).toBe("Umba-Bold");
  });

  it("notes stroke-only shapes and shapes off the artboards", () => {
    const f = loadFont("gasoek");
    const { read } = roundTrip(f, (il) => {
      const letters = il.app.documents[0].layers[0];
      const stroke = letters.pathItems.add();
      stroke.setEntirePath([[0, 0], [10, 10]]);
      stroke.filled = false;
      stroke.stroked = true;
      const far = letters.pathItems.add();
      far.setEntirePath([[90000, 90000], [90010, 90000], [90010, 90010]]);
    });
    expect(read.notes).toContain("stroke");
    expect(read.outside).toBe(1);
    void makePath;
  });

  it("keeps the font working when a letter is left empty", () => {
    const f = loadFont("anybody");
    const { spec, read } = roundTrip(f, (il) => {
      il.app.documents[0].layers[0].compoundPathItems[1].hidden = true; // o
    });
    const meta: CanvasMeta = spec.meta;
    const r = buildBrandFont(f, meta, read.letters, { family: "Umba", style: "Regular" });
    expect(r.empty).toEqual(["o"]);
    const g = parseFont(r.bytes.slice().buffer);
    expect(g.glyphs[spec.cells[1].gid].type).toBe("empty");
  });
});

describe("naming", () => {
  it("reads the weight from the style name", async () => {
    const { weightClass } = await import("../src/font/writer");
    expect(weightClass("Black")).toBe(900);
    expect(weightClass("SemiBold")).toBe(600);
    expect(weightClass("Extra Bold")).toBe(800);
    expect(weightClass("Bold Italic")).toBe(700);
    expect(weightClass("Italic")).toBe(0);
    expect(weightClass("Display")).toBe(0);
  });
});
