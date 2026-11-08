/**
 * A small stand-in for Illustrator's scripting objects: enough of documents, artboards, layers,
 * paths and text frames to run jsx/host.jsx in Node.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

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

export function makePath() {
  const p = {
    typename: "PathItem",
    pathPoints: [] as Pt[],
    closed: false,
    guides: false,
    hidden: false,
    clipping: false,
    filled: true,
    stroked: false,
    evenodd: false,
    setEntirePath(a: number[][]) {
      p.pathPoints = a.map((q) => ({ anchor: q, leftDirection: q, rightDirection: q, pointType: "CORNER" }));
    },
    get geometricBounds() {
      const xs = p.pathPoints.map((q) => q.anchor[0]);
      const ys = p.pathPoints.map((q) => q.anchor[1]);
      return [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
    },
  };
  return p;
}

function makeText() {
  return { typename: "TextFrame", hidden: false, contents: "", name: "", position: [0, 0], textRange: { characterAttributes: {} } };
}

function makeLayer() {
  const l = {
    name: "",
    locked: false,
    visible: true,
    moved: null as unknown,
    pathItems: collection(makePath),
    textFrames: collection(makeText),
    compoundPathItems: collection(() => {
      const cp = {
        typename: "CompoundPathItem",
        hidden: false,
        name: "",
        pathItems: collection(makePath),
        get geometricBounds() {
          const bs = cp.pathItems.map((p) => p.geometricBounds);
          return [Math.min(...bs.map((b) => b[0])), Math.max(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.min(...bs.map((b) => b[3]))];
        },
      };
      return cp;
    }),
    /** Everything on the layer, in creation order is close enough for these tests. */
    get pageItems() {
      return [...l.compoundPathItems, ...l.pathItems, ...l.textFrames];
    },
    move(_rel: unknown, where: string) {
      l.moved = where;
    },
  };
  return l;
}

export function fakeIllustrator() {
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

