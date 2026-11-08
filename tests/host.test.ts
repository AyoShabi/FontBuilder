/**
 * Runs jsx/host.jsx against a small stand-in for Illustrator's scripting objects, so the canvas
 * builder's logic is checked without Illustrator. It also checks host.jsx is valid ES3, which is
 * all Illustrator's ExtendScript engine understands.
 */
import { parse } from "acorn";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { layoutCanvas } from "../src/canvas/layout";
import { hostCall } from "../src/canvas/script";
import { loadFont } from "./helpers";

const HOST = readFileSync("extension/jsx/host.jsx", "utf8");

type Pt = { anchor: number[]; leftDirection: number[]; rightDirection: number[]; pointType: string };

function collection<T>(make: () => T) {
  const items: T[] = [] as T[];
  const c = items as T[] & { add: (...a: unknown[]) => T; getByName: (n: string) => T };
  c.add = () => {
    const it = make();
    items.push(it);
    return it;
  };
  c.getByName = (n: string) => {
    const f = items.find((x) => (x as { name?: string }).name === n);
    if (!f) throw new Error("No such element");
    return f;
  };
  return c;
}

function makePath() {
  const p = {
    pathPoints: [] as Pt[],
    closed: false,
    guides: false,
    setEntirePath(a: number[][]) {
      p.pathPoints = a.map((q) => ({ anchor: q, leftDirection: q, rightDirection: q, pointType: "CORNER" }));
    },
  };
  return p;
}

function makeText() {
  return { contents: "", name: "", position: [0, 0], textRange: { characterAttributes: {} } };
}

function makeLayer() {
  const l = {
    name: "",
    locked: false,
    visible: true,
    moved: null as unknown,
    pathItems: collection(makePath),
    textFrames: collection(makeText),
    compoundPathItems: collection(() => ({ name: "", pathItems: collection(makePath) })),
    move(_rel: unknown, where: string) {
      l.moved = where;
    },
  };
  return l;
}

function fakeIllustrator() {
  const docs: ReturnType<typeof makeDoc>[] = [];
  function makeDoc(w: number, h: number) {
    const abs = collection(() => ({ name: "", artboardRect: [0, 0, 0, 0] }));
    abs.add();
    abs[0].artboardRect = [0, h, w, 0];
    const orig = abs.add;
    (abs as unknown as { add: (r: number[]) => unknown }).add = (r: number[]) => {
      const a = orig();
      a.artboardRect = r;
      return a;
    };
    const layers = collection(makeLayer);
    layers.add();
    return { artboards: Object.assign(abs, { active: 0, setActiveArtboardIndex: (i: number) => ((abs as unknown as { active: number }).active = i) }), layers };
  }
  const app = {
    documents: Object.assign(docs, {
      add: (_cs: unknown, w: number, h: number) => {
        const d = makeDoc(w, h);
        docs.push(d);
        app.activeDocument = d;
        return d;
      },
    }),
    activeDocument: null as unknown,
    commands: [] as string[],
    executeMenuCommand: (c: string) => app.commands.push(c),
  };
  const ctx = createContext({
    app,
    RGBColor: function RGBColor() {},
    DocumentColorSpace: { RGB: "RGB" },
    ElementPlacement: { PLACEAFTER: "PLACEAFTER" },
    PointType: { SMOOTH: "SMOOTH", CORNER: "CORNER" },
  });
  runInContext(HOST, ctx);
  return { app, run: (s: string) => runInContext(s, ctx) as string };
}

describe("host.jsx", () => {
  it("is ES3", () => {
    expect(() => parse(HOST, { ecmaVersion: 3 })).not.toThrow();
  });

  it("builds the canvas: artboards, letters, guides, labels and saved data", () => {
    const f = loadFont("anybody");
    const spec = layoutCanvas(f, { source: { family: "Anybody", style: "Regular", path: "C:/x.ttf" } });
    const il = fakeIllustrator();
    const r = il.run(hostCall("fbBuildCanvas", { ...spec, metaJson: JSON.stringify(spec.meta) }));
    expect(r).toBe("ok:" + spec.cells.length);

    const doc = il.app.documents[0];
    expect(doc.artboards.length).toBe(spec.cells.length);
    expect(doc.artboards.map((a) => a.name)).toEqual(spec.cells.map((c) => c.name));

    // The layout is shifted as a whole: every artboard keeps its size and its offset from the first.
    const dx = doc.artboards[0].artboardRect[0] - spec.cells[0].rect[0];
    const dy = doc.artboards[0].artboardRect[1] - spec.cells[0].rect[1];
    doc.artboards.forEach((a, i) => {
      const want = spec.cells[i].rect;
      expect(a.artboardRect.map((v, k) => v - (k % 2 ? dy : dx))).toEqual(want.map((v) => expect.closeTo(v, 6)));
    });

    const [letters, guides, data] = doc.layers;
    expect([letters.name, guides.name, data.name]).toEqual(["Letters", "Guides", "FontBuilder data"]);
    expect(guides.locked && data.locked && !data.visible).toBe(true);
    expect(letters.compoundPathItems.length).toBe(spec.cells.length);

    // The letter H: same anchors and handles as the layout, moved by the same shift.
    const hi = spec.cells.findIndex((c) => c.char === "H");
    const H = letters.compoundPathItems[hi];
    expect(H.name).toBe("H");
    const want = spec.cells[hi].contours;
    expect(H.pathItems.length).toBe(want.length);
    H.pathItems.forEach((p, ci) => {
      expect(p.closed).toBe(true);
      p.pathPoints.forEach((pt, k) => {
        const a = want[ci][k];
        expect(pt.anchor).toEqual([a.x + dx, a.y + dy]);
        expect(pt.rightDirection).toEqual([a.ox + dx, a.oy + dy]);
        expect(pt.leftDirection).toEqual([a.ix + dx, a.iy + dy]);
      });
    });

    expect(guides.pathItems.length).toBe(spec.guides.length);
    expect(guides.pathItems.every((p) => p.guides)).toBe(true);
    expect(guides.textFrames.map((t) => t.contents)).toContain("1. Key letters");
    expect(JSON.parse(data.textFrames[0].contents)).toEqual(spec.meta);

    expect(il.run("fbReadMeta()")).toBe("ok:" + JSON.stringify(spec.meta));
    expect(il.run('fbGoTo("O")')).toBe("ok:3");
    expect(il.run('fbGoTo("nope")')).toMatch(/^error:/);
  });

  it("reports when no canvas is open", () => {
    const il = fakeIllustrator();
    expect(il.run("fbReadMeta()")).toBe("none");
    expect(il.run('fbGoTo("n")')).toMatch(/^error:Open your FontBuilder canvas/);
  });
});
