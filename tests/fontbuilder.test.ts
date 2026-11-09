/** FontBuilder's additions to the editor: bending lines, font-wide heights, and the artboard preview. */
import { parse } from "acorn";
import { readdirSync, readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";
import { bendLine } from "../src/editor/edits";
import { undo } from "../src/editor/history";
import { baseOutline, editedOutline, keyHeights, newHeights, newProject, outlineSource } from "../src/editor/project";
import { proj, setCurrentGid, state } from "../src/editor/state";
import { parseFont } from "../src/font/parser";
import { buildFont } from "../src/font/writer";
import { drawCall, setFrame, type PreviewFrame } from "../src/panel/artboard";
import { loadFont } from "./helpers";

const font = loadFont("anybody");
const gid = (ch: string) => font.cmap.get(ch.codePointAt(0)!)!;

beforeEach(() => {
  state.font = font;
  state.store.slug = "anybody";
  state.store.projects.anybody = newProject();
  state.selPts = new Set();
  state.link = null;
  state.zone = null;
});

describe("Curve tool", () => {
  it("turns a straight line into a curve without changing the shape, and undoes", () => {
    setCurrentGid(gid("H"));
    const before = baseOutline(font, gid("H"), proj())!;
    // A straight line inside the first contour.
    const i = before.pts.findIndex((q, k) => k < before.ends[0] && q.on && before.pts[k + 1].on);
    const ctrl = bendLine(i);
    expect(ctrl).toBe(i + 1);
    const after = editedOutline(font, gid("H"), proj());
    expect(after.pts.length).toBe(before.pts.length + 1);
    const c = after.pts[i + 1];
    expect(c.on).toBe(false);
    // Halfway along the old line, so nothing moves until it's dragged.
    expect(c.x).toBeCloseTo((before.pts[i].x + before.pts[i + 1].x) / 2, 0);
    expect(c.y).toBeCloseTo((before.pts[i].y + before.pts[i + 1].y) / 2, 0);
    expect(state.selPts).toEqual(new Set([i + 1]));
    undo();
    expect(editedOutline(font, gid("H"), proj()).pts.length).toBe(before.pts.length);
  });

  it("won't bend a curve", () => {
    setCurrentGid(gid("o"));
    const o = baseOutline(font, gid("o"), proj())!;
    const i = o.pts.findIndex((q, k) => q.on && !o.pts[(k + 1) % o.pts.length].on);
    expect(bendLine(i)).toBeNull();
  });
});

describe("heights", () => {
  const top = (ch: string) => Math.max(...editedOutline(font, gid(ch), proj()).pts.map((q) => q.y));
  const bottom = (ch: string) => Math.min(...editedOutline(font, gid(ch), proj()).pts.map((q) => q.y));

  it("measures the font's key heights", () => {
    const k = keyHeights(font);
    expect(k.xh).toBe(font.xh);
    expect(k.cap).toBe(font.cap);
    expect(k.asc).toBeGreaterThan(k.xh);
    expect(k.desc).toBeLessThan(0);
  });

  it("raises the x-height of the lowercase only, keeping ascenders and the baseline", () => {
    const x0 = top("x");
    const l0 = top("l");
    const H0 = top("H");
    proj().heights = { xh: 60 };
    expect(top("x")).toBe(x0 + 60);
    expect(top("l")).toBe(l0);
    expect(top("H")).toBe(H0);
    expect(bottom("x")).toBe(0);
  });

  it("changes cap height, ascender and descender", () => {
    const H0 = top("H");
    const l0 = top("l");
    const p0 = bottom("p");
    proj().heights = { cap: -40, asc: 30, desc: 50 };
    expect(top("H")).toBe(H0 - 40);
    expect(top("l")).toBe(l0 + 30);
    expect(bottom("p")).toBe(p0 - 50);
    const n = newHeights(font, proj());
    expect(n.cap).toBe(font.cap - 40);
  });

  it("writes the new heights into the exported font", () => {
    proj().heights = { xh: 40, cap: 20 };
    const out = parseFont(buildFont(font, "Test Face", outlineSource(font, proj())).slice().buffer);
    expect(out.xh).toBe(font.xh + 40);
    expect(out.cap).toBe(font.cap + 20);
    const x = out.glyphs[gid("x")];
    expect(x.type === "simple" && Math.max(...x.pts.map((q) => q.y))).toBe(top("x"));
  });
});

describe("artboard preview", () => {
  const frame: PreviewFrame = { id: "1", text: "no\rHO", size: 100, leading: 120, tracking: 0, x: 10, y: 500, just: "left", area: false };

  it("sets text at the frame's size and position, line by line", () => {
    const paths = setFrame(font, proj(), frame);
    expect(paths.length).toBeGreaterThan(4);
    const s = 100 / font.upm;
    const xs = paths.flat().map((a) => a[0]);
    const ys = paths.flat().map((a) => a[1]);
    // Left edge at the frame's x (plus n's left side bearing), top line's x-height above its baseline.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    // The top line ("no") reaches the x-height (o overshoots it a little).
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(500 + font.xh * s - 0.5);
    expect(Math.max(...ys)).toBeLessThan(500 + font.xh * s * 1.03);
    // Second line sits one leading lower.
    expect(Math.min(...ys)).toBeLessThan(500 - 120 + 1);
  });

  it("follows edits and centres centred text", () => {
    const before = setFrame(font, proj(), frame);
    proj().heights = { xh: 100 };
    const after = setFrame(font, proj(), frame);
    expect(after).not.toEqual(before);
    const c = setFrame(font, proj(), { ...frame, text: "HOH", just: "center", x: 0 });
    const xs = c.flat().map((a) => a[0]);
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(20);
  });

  it("drives host.jsx: draws over the selected text, then puts it back", () => {
    const HOST = readFileSync("extension/jsx/host.jsx", "utf8");
    expect(() => parse(HOST, { ecmaVersion: 3 })).not.toThrow();

    // A small stand-in for Illustrator: one document, one layer, one point-text frame.
    const mkColl = <T,>(make: () => T) => Object.assign([] as T[], { add() { const x = make(); (this as unknown as T[]).push(x); return x; } });
    const groups: { name: string; pageItems: unknown[]; compoundPathItems: ReturnType<typeof mkColl>; move(): void; remove(): void }[] = [];
    const layer = {
      locked: false,
      groupItems: {
        add() {
          const g = {
            name: "",
            pageItems: [] as { remove(): void }[],
            compoundPathItems: mkColl(() => {
              const cp = { pathItems: mkColl(() => {
                const p = { pathPoints: [] as Record<string, unknown>[], setEntirePath(a: number[][]) { p.pathPoints = a.map((q) => ({ anchor: q })); } };
                return p;
              }), remove() { g.pageItems.splice(g.pageItems.indexOf(cp), 1); } };
              g.pageItems.push(cp);
              return cp;
            }),
            move() {},
            remove() { groups.splice(groups.indexOf(g), 1); },
          };
          groups.push(g);
          return g;
        },
      },
    };
    const tf = {
      typename: "TextFrame", note: "", hidden: false, contents: "sample", kind: "POINT", anchor: [100, 200], layer,
      textRange: { characterAttributes: { size: 48, autoLeading: true, leading: 0, tracking: 0, fillColor: { c: "red" } }, paragraphAttributes: { justification: "LEFT" } },
    };
    const doc = { selection: [tf], textFrames: [tf], get groupItems() { return groups; } };
    const ctx = createContext({ app: { documents: [doc], activeDocument: doc }, Justification: { CENTER: "CENTER", RIGHT: "RIGHT" }, TextType: { POINTTEXT: "POINT" }, ElementPlacement: { PLACEBEFORE: "B" } });
    runInContext(HOST, ctx);
    const run = (s: string) => runInContext(s, ctx) as string;

    const listed = run("fbPreviewAdd()");
    expect(listed.startsWith("ok:")).toBe(true);
    const frames = JSON.parse(listed.slice(3)).frames as PreviewFrame[];
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ text: "sample", size: 48, leading: expect.closeTo(57.6, 3), x: 100, y: 200, just: "left" });

    expect(run(drawCall(font, proj(), frames))).toBe("ok:1");
    expect(tf.hidden).toBe(true);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("FontBuilder preview " + frames[0].id);
    const drawn = (groups[0].pageItems[0] as { pathItems: { pathPoints: unknown[] }[] }).pathItems;
    expect(drawn.length).toBe(setFrame(font, proj(), frames[0]).length);

    // Redrawing replaces the shapes rather than piling them up.
    proj().heights = { xh: 80 };
    expect(run(drawCall(font, proj(), frames))).toBe("ok:1");
    expect(groups).toHaveLength(1);
    expect(groups[0].pageItems).toHaveLength(1);

    expect(run("fbPreviewStop()")).toBe("ok:1");
    expect(tf.hidden).toBe(false);
    expect(tf.note).toBe("");
    expect(groups).toHaveLength(0);
  });
});

describe("Illustrator-style editing", () => {
  it("Shift keeps a drag horizontal, vertical or at 45 degrees", async () => {
    const { constrain } = await import("../src/ui/stage");
    expect(constrain(100, 12)).toEqual([100, 0]);
    expect(constrain(-8, 90)).toEqual([0, 90]);
    const [x, y] = constrain(50, 46);
    expect(Math.abs(x - y)).toBeLessThan(1e-9);
    expect(x).toBeCloseTo(48, 0);
  });

  it("asks Illustrator for the editor's keys with every modifier", async () => {
    const { keyInterest, PANEL_KEYS } = await import("../src/panel/keys");
    const ks = keyInterest();
    expect(ks.length).toBe(PANEL_KEYS.length * 16);
    expect(ks).toContainEqual({ keyCode: 32 }); // Space for the hand
    expect(ks).toContainEqual({ keyCode: 67, shiftKey: true }); // Shift+C
    expect(ks).toContainEqual({ keyCode: 187, ctrlKey: true }); // Ctrl+=
    expect(ks).toContainEqual({ keyCode: 90, ctrlKey: true, shiftKey: true }); // redo
  });
});

describe("Characters and shapes", () => {
  const load = (slug: string) => {
    const dir = `extension/fonts/${slug}`;
    const file = readdirSync(dir).find((n) => n.endsWith(".ttf"))!;
    const b = readFileSync(`${dir}/${file}`);
    return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };

  it("a capitals-only font types capitals for lowercase, and survives export", async () => {
    const { outputCmap, isDrawn } = await import("../src/editor/charset");
    const f = load("passionone");
    const p = { ...newProject(), letterCase: "upper" as const };
    const m = outputCmap(f, p);
    expect(m.get(97)).toBe(f.cmap.get(65)); // a -> A
    expect(m.get(65)).toBe(f.cmap.get(65));
    expect(isDrawn(f, p, 97)).toBe(false);
    expect(isDrawn(f, p, 65)).toBe(true);
    const back = parseFont(buildFont(f, "Test Caps", outlineSource(f, p)).buffer as ArrayBuffer);
    expect(back.cmap.get(97)).toBe(f.cmap.get(65));
    expect(back.cmap.get(0x31)).toBe(f.cmap.get(0x31));
  });

  it("a lowercase-only font types lowercase for capitals", async () => {
    const { outputCmap } = await import("../src/editor/charset");
    const f = load("passionone");
    const m = outputCmap(f, { ...newProject(), letterCase: "lower" });
    expect(m.get(72)).toBe(f.cmap.get(104)); // H -> h
  });

  it("the basic set leaves accented letters and symbols out", async () => {
    const { outputCmap } = await import("../src/editor/charset");
    const f = load("passionone");
    expect(f.cmap.has(0xe9)).toBe(true); // é in the starting font
    const p = { ...newProject(), charset: "basic" as const };
    const back = parseFont(buildFont(f, "Test Basic", outlineSource(f, p)).buffer as ArrayBuffer);
    expect(back.cmap.has(0xe9)).toBe(false);
    expect(back.cmap.get(0x41)).toBe(f.cmap.get(0x41));
    expect(back.cmap.has(0xa3)).toBe(f.cmap.has(0xa3)); // £ stays
    expect(outputCmap(f, p).size).toBe(back.cmap.size);
  });

  it("draws a filled rectangle and a cut-out ellipse into a letter", async () => {
    const { addShape } = await import("../src/editor/edits");
    const { rectPoints, ellipsePoints, signedArea, fillDirection } = await import("../src/editor/outline");
    state.store.slug = "passionone";
    state.store.loc = { wght: 700 };
    state.font = load("passionone");
    state.store.projects.passionone = newProject();
    const gid = state.font.cmap.get(72)!; // H
    setCurrentGid(gid);
    const before = editedOutline(state.font, gid, proj());
    const dir = fillDirection(before);
    expect(addShape(rectPoints(0, 700, 200, 800), false)).toBe(true);
    let o = editedOutline(state.font, gid, proj());
    expect(o.ends.length).toBe(before.ends.length + 1);
    const rect = o.pts.slice(before.pts.length);
    expect(Math.sign(signedArea(rect))).toBe(dir);
    expect(rect.map((q) => [q.x, q.y])).toContainEqual([200, 800]);
    expect(addShape(ellipsePoints(300, 300, 50, 80), true)).toBe(true);
    o = editedOutline(state.font, gid, proj());
    const ell = o.pts.slice(before.pts.length + 4);
    expect(ell.length).toBe(16);
    expect(Math.sign(signedArea(ell))).toBe(-dir);
    // It exports and reads back.
    const back = parseFont(buildFont(state.font, "Test Shapes", outlineSource(state.font, proj())).buffer as ArrayBuffer);
    const G = back.glyphs[gid];
    expect(G.type === "simple" && G.ends.length).toBe(before.ends.length + 2);
    undo();
    expect(editedOutline(state.font, gid, proj()).ends.length).toBe(before.ends.length + 1);
  });
});

describe("Real-font preview", () => {
  it("host.jsx tags the selected text and sets it in the installed font", () => {
    const HOST = readFileSync("extension/jsx/host.jsx", "utf8");
    const mkTags = () => {
      const tags: { name: string; value: string; remove(): void }[] = [];
      return Object.assign(tags, {
        add() {
          const t = { name: "", value: "", remove() { tags.splice(tags.indexOf(t), 1); } };
          tags.push(t);
          return t;
        },
      });
    };
    const layer = { locked: true };
    const mk = () => ({ typename: "TextFrame", tags: mkTags(), layer, textRange: { characterAttributes: { textFont: null as unknown } } });
    const a = mk();
    const b = mk();
    const fonts = [{ name: "Arial" }];
    const doc = { selection: [a], textFrames: [a, b] };
    const textFonts = Object.assign(fonts, {
      getByName(n: string) {
        const f = fonts.find((x) => x.name === n);
        if (!f) throw new Error("no font");
        return f;
      },
    });
    const ctx = createContext({ app: { documents: [doc], activeDocument: doc, textFonts } });
    runInContext(HOST, ctx);
    const run = (s: string) => runInContext(s, ctx) as string;

    expect(run("fbFontTagSelection()")).toBe("ok:1");
    expect(run("fbFontTagSelection()")).toBe("ok:1"); // tagging twice doesn't add a second tag
    expect(a.tags).toHaveLength(1);
    expect(run('fbFontApply("BrandDisplayPreview1-Regular")')).toBe("ok:-1"); // not loaded yet
    fonts.push({ name: "BrandDisplayPreview1-Regular" });
    expect(run('fbFontApply("BrandDisplayPreview1-Regular")')).toBe("ok:1");
    expect(a.textRange.characterAttributes.textFont).toEqual({ name: "BrandDisplayPreview1-Regular" });
    expect(b.textRange.characterAttributes.textFont).toBe(null);
    expect(layer.locked).toBe(true); // locked layers are unlocked only while setting the font
    expect(run("fbFontUntag()")).toBe("ok:1");
    expect(a.tags).toHaveLength(0);
  });
});

describe("Whole-font proportions", () => {
  const load = (slug: string) => {
    const dir = `extension/fonts/${slug}`;
    const file = readdirSync(dir).find((n) => n.endsWith(".ttf"))!;
    const b = readFileSync(`${dir}/${file}`);
    return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };

  it("width, height and slant change every letter and move the guides, and point edits still land where dragged", async () => {
    const { advOf, toOffset } = await import("../src/editor/project");
    const { setPoint } = await import("../src/editor/edits");
    const f = load("anybody");
    state.store.slug = "anybody";
    state.font = f;
    state.store.projects.anybody = newProject();
    const H = f.cmap.get(72)!;
    setCurrentGid(H);
    const p = proj();
    const adv0 = advOf(f, H, p);
    const cap0 = newHeights(f, p).cap;
    p.proportions = { width: 80, height: 110, slant: 10 };
    expect(advOf(f, H, p)).toBe(Math.round(adv0 * 0.8));
    expect(newHeights(f, p).cap).toBe(Math.round(cap0 * 1.1));
    // A point moved to (x, y) in the editor ends up exactly there.
    setPoint(0, 300, 400);
    const q = editedOutline(f, H, p).pts[0];
    expect(Math.abs(q.x - 300)).toBeLessThanOrEqual(1);
    expect(q.y).toBe(400);
    expect(toOffset(p, 80, 0)[0]).toBeCloseTo(100);
  });

  it("exports accented letters as plain outlines so accents stay over their letters", async () => {
    const f = load("anybody");
    const p = { ...newProject(), proportions: { width: 70 } };
    const e = f.cmap.get(0xe9)!; // é
    expect(f.glyphs[e].type).toBe("composite");
    const back = parseFont(buildFont(f, "Test Narrow", outlineSource(f, p)).buffer as ArrayBuffer);
    expect(back.glyphs[e].type).toBe("simple");
    const xs = (gid: number) => (back.glyphs[gid] as { pts: { x: number }[] }).pts.map((q) => q.x);
    const plain = xs(back.cmap.get(0x65)!);
    const acc = xs(e);
    expect(Math.max(...acc)).toBeLessThanOrEqual(Math.max(...plain) + 40);
  });
});

describe("Merge shapes and round corners", () => {
  const load = (slug: string) => {
    const dir = `extension/fonts/${slug}`;
    const file = readdirSync(dir).find((n) => n.endsWith(".ttf"))!;
    const b = readFileSync(`${dir}/${file}`);
    return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const area = (pts: { x: number; y: number }[]) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  };
  const start = (gidChar: number) => {
    state.store.slug = "passionone";
    state.font = load("passionone");
    state.store.projects.passionone = newProject();
    setCurrentGid(state.font.cmap.get(gidChar)!);
    return state.font.cmap.get(gidChar)!;
  };

  it("merges an overlapping rectangle into the letter as one outline", async () => {
    const { addShape, mergeShapes } = await import("../src/editor/edits");
    const { rectPoints } = await import("../src/editor/outline");
    const gid = start(73); // I: one contour
    const before = editedOutline(state.font!, gid, proj());
    expect(before.ends.length).toBe(1);
    const xs = before.pts.map((q) => q.x);
    const top = Math.max(...before.pts.map((q) => q.y));
    // A bar across the top, overlapping the stem.
    expect(addShape(rectPoints(Math.min(...xs) - 60, top - 80, Math.max(...xs) + 60, top + 20), false)).toBe(true);
    expect(editedOutline(state.font!, gid, proj()).ends.length).toBe(2);
    state.selPts.clear();
    expect(mergeShapes()).toBe(true);
    const after = editedOutline(state.font!, gid, proj());
    expect(after.ends.length).toBe(1);
    // The merged shape covers both: wider than the stem and as tall as the bar.
    expect(Math.min(...after.pts.map((q) => q.x))).toBe(Math.min(...xs) - 60);
    expect(Math.max(...after.pts.map((q) => q.y))).toBe(top + 20);
    expect(Math.sign(area(after.pts))).toBe(Math.sign(area(before.pts)));
    // It survives export.
    const back = parseFont(buildFont(state.font!, "Test Merge", outlineSource(state.font!, proj())).buffer as ArrayBuffer);
    expect((back.glyphs[gid] as { ends: number[] }).ends.length).toBe(1);
    undo();
    expect(editedOutline(state.font!, gid, proj()).ends.length).toBe(2);
  });

  it("rounds a square corner into a curve of the given radius", async () => {
    const { roundCorners } = await import("../src/editor/edits");
    const gid = start(73);
    const o = editedOutline(state.font!, gid, proj());
    // The bottom-left corner of I.
    let best = 0;
    o.pts.forEach((q, i) => {
      if (q.on && q.x + q.y < o.pts[best].x + o.pts[best].y) best = i;
    });
    const c = o.pts[best];
    state.selPts = new Set([best]);
    expect(roundCorners(30)).toBe(true);
    const r = editedOutline(state.font!, gid, proj());
    expect(r.pts.length).toBe(o.pts.length + 2);
    const ctrl = r.pts.find((q) => !q.on && q.x === c.x && q.y === c.y);
    expect(ctrl).toBeTruthy();
    const ons = r.pts.filter((q) => q.on && Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - 30) < 1.5);
    expect(ons.length).toBe(2);
    expect(r.pts.some((q) => q.on && q.x === c.x && q.y === c.y)).toBe(false);
  });
});
