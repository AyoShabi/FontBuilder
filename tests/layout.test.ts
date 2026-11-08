import { describe, expect, it } from "vitest";
import { EM_POINTS, layoutCanvas } from "../src/canvas/layout";
import { hostCall, toLiteral } from "../src/canvas/script";
import { FAMILIES, loadFont } from "./helpers";

const src = { family: "Anybody", style: "Regular", path: null };

describe("canvas layout", () => {
  it("puts key letters first and gives each letter an artboard as wide as its advance", () => {
    const f = loadFont("anybody");
    const spec = layoutCanvas(f, { source: src });
    expect(spec.cells.slice(0, 4).map((c) => c.char)).toEqual(["n", "o", "H", "O"]);
    expect(new Set(spec.cells.map((c) => c.char)).size).toBe(spec.cells.length);
    const n = spec.cells[0];
    expect(n.rect[2] - n.rect[0]).toBeCloseTo(f.adv[n.gid] * spec.scale, 1);
    expect(spec.scale).toBeCloseTo(EM_POINTS / f.upm);
  });

  it("keeps artboards apart and inside Illustrator's canvas for every bundled font", () => {
    for (const fam of FAMILIES) {
      const spec = layoutCanvas(loadFont(fam), { source: src });
      const [l, t, r, b] = spec.bounds;
      expect(r - l).toBeLessThan(15000);
      expect(t - b).toBeLessThan(15000);
      const rects = spec.cells.map((c) => c.rect);
      for (let i = 0; i < rects.length; i++) {
        const a = rects[i];
        expect(a[0]).toBeGreaterThanOrEqual(l);
        expect(a[2]).toBeLessThanOrEqual(r);
        expect(a[3]).toBeGreaterThanOrEqual(b);
        expect(a[1]).toBeLessThanOrEqual(t);
        for (let j = i + 1; j < rects.length; j++) {
          const c = rects[j];
          const overlap = a[0] < c[2] && c[0] < a[2] && a[3] < c[1] && c[3] < a[1];
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("can lay out a single stage", () => {
    const spec = layoutCanvas(loadFont("gasoek"), { stages: [0], source: src });
    expect(spec.cells.map((c) => c.char)).toEqual(["n", "o", "H", "O"]);
    expect(spec.meta.glyphs.map((g) => g.char)).toEqual(["n", "o", "H", "O"]);
  });

  it("places the outline on the artboard's baseline", () => {
    const f = loadFont("anybody");
    const spec = layoutCanvas(f, { stages: [0], source: src });
    const H = spec.cells[2];
    const ys = H.contours.flat().map((a) => a.y);
    expect(Math.min(...ys)).toBeCloseTo(H.oy, 0);
    expect(Math.max(...ys)).toBeCloseTo(H.oy + f.cap * spec.scale, 0);
  });
});

describe("script literals", () => {
  it("escapes characters ExtendScript can't take raw", () => {
    expect(toLiteral({ a: "£ " })).toBe('{"a":"\\u00a3\\u2028"}');
    expect(hostCall("fbGoTo", "n")).toBe('fbGoTo("n")');
  });
});
