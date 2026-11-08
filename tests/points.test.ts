import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseFont } from "../src/font/parser";
import { buildFont } from "../src/font/writer";
import type { Font, Point } from "../src/font/types";
import { addPoint, deletePoints, movePts } from "../src/editor/edits";
import { applyOps, deleteOps, hitSegment, type Outline } from "../src/editor/outline";
import { baseOutline, contours, editedOutline, editedPts, newProject, outlineSource } from "../src/editor/project";
import { proj, setCurrentGid, state } from "../src/editor/state";
import { undo } from "../src/editor/history";

const dir = join(__dirname, "..", "extension", "fonts", "anybody");
function load(file: string): Font {
  const b = readFileSync(join(dir, file));
  return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}
const regular = load("wdth100-wght400.ttf");
const black = load("wdth100-wght900.ttf");
const gidOf = (f: Font, ch: string) => f.cmap.get(ch.codePointAt(0)!)!;

/** Dense samples along each contour, to compare shapes. */
function samples(o: Outline): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let s = 0;
  for (const e of o.ends) {
    const c = o.pts.slice(s, e + 1);
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const q = c[i];
      const a = c[(i - 1 + n) % n];
      const b = c[(i + 1) % n];
      if (q.on) {
        const steps = Math.max(40, Math.ceil(Math.hypot(b.x - q.x, b.y - q.y) / 0.25));
        if (b.on) for (let k = 0; k < steps; k++) out.push(lerp(q, b, k / steps));
        continue;
      }
      const p0 = a.on ? a : lerp(a, q, 0.5);
      const p2 = b.on ? b : lerp(q, b, 0.5);
      const steps = Math.max(80, Math.ceil((Math.hypot(q.x - p0.x, q.y - p0.y) + Math.hypot(p2.x - q.x, p2.y - q.y)) / 0.25));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        out.push(lerp(lerp(p0, q, t), lerp(q, p2, t), t));
      }
    }
    s = e + 1;
  }
  return out;
}
const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Largest distance from any sample of `a` to the nearest sample of `b` (looked up in a 4-unit grid). */
function maxGap(a: Outline, b: Outline): number {
  const cell = 4;
  const grid = new Map<string, { x: number; y: number }[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const q of samples(b)) {
    const k = key(q.x, q.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(q);
  }
  let worst = 0;
  for (const p of samples(a)) {
    let best = Infinity;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) best = Math.min(best, (p.x - q.x) ** 2 + (p.y - q.y) ** 2);
    worst = Math.max(worst, Math.sqrt(best));
  }
  return worst;
}

const outlineOf = (f: Font, ch: string): Outline => {
  const G = f.glyphs[gidOf(f, ch)];
  if (G.type !== "simple") throw new Error("not simple");
  return { ends: G.ends, pts: G.pts };
};

/**
 * The first curve control with an implied on-curve point on one side (in Anybody's "o" the
 * curves run on, off, off, on), the first straight line, and how many points splitting that
 * curve adds: two controls and the point, minus the old control, plus each implied point.
 */
function findSegments(o: Outline) {
  let curve = -1;
  let line = -1;
  let grow = 0;
  let s = 0;
  for (const e of o.ends) {
    for (let i = s; i <= e; i++) {
      const prev = o.pts[i === s ? e : i - 1];
      const next = o.pts[i === e ? s : i + 1];
      if (curve < 0 && !o.pts[i].on && (!prev.on || !next.on)) {
        curve = i;
        grow = 2 + (prev.on ? 0 : 1) + (next.on ? 0 : 1);
      }
      if (line < 0 && o.pts[i].on && next.on) line = i;
    }
    s = e + 1;
  }
  return { curve, line, grow };
}

beforeEach(() => {
  state.font = regular;
  state.store.slug = "anybody";
  state.store.projects.anybody = newProject();
  state.selPts = new Set();
  state.link = null;
  state.zone = null;
});

describe("splitting a segment", () => {
  it("adds a point to a curve without changing its shape, even between implied points", () => {
    const o = outlineOf(regular, "o");
    const { curve, grow } = findSegments(o);
    expect(curve).toBeGreaterThanOrEqual(0);
    const r = applyOps(o, [{ split: curve, t: 0.3 }])!;
    expect(grow).toBe(3);
    expect(r.pts.length).toBe(o.pts.length + grow);
    expect(r.ends[r.ends.length - 1]).toBe(r.pts.length - 1);
    expect(maxGap(r, o)).toBeLessThan(0.5);
    expect(maxGap(o, r)).toBeLessThan(0.5);
  });

  it("adds a point on a straight line", () => {
    const o = outlineOf(regular, "H");
    const { line } = findSegments(o);
    const r = applyOps(o, [{ split: line, t: 0.5 }])!;
    expect(r.pts.length).toBe(o.pts.length + 1);
    expect(r.pts[line + 1]).toMatchObject({ on: true, ...lerp(o.pts[line], o.pts[line + 1], 0.5) });
    expect(maxGap(r, o)).toBeLessThan(0.01);
  });

  it("finds the segment under the pointer", () => {
    const o = outlineOf(regular, "H");
    const { line } = findSegments(o);
    const mid = lerp(o.pts[line], o.pts[line + 1], 0.25);
    const hit = hitSegment(o, { x: mid.x + 3, y: mid.y }, 10)!;
    expect(hit.i).toBe(line);
    expect(hitSegment(o, { x: -5000, y: -5000 }, 10)).toBeNull();
  });
});

describe("adding points in the editor", () => {
  it("keeps moved points where they are and puts the new point on the edited curve", () => {
    const gid = gidOf(regular, "o");
    setCurrentGid(gid);
    state.selPts = new Set([0, 1, 2]);
    movePts((q) => ({ x: q.x + 40, y: q.y - 25 }));
    const before = editedOutline(regular, gid, proj());
    const { curve, grow } = findSegments(before);
    const at = addPoint(curve, 0.5)!;
    const after = editedOutline(regular, gid, proj());
    expect(after.pts.length).toBe(before.pts.length + grow);
    expect(after.pts[at].on).toBe(true);
    expect(state.selPts).toEqual(new Set([at]));
    expect(maxGap(after, before)).toBeLessThan(1.5);
    expect(maxGap(before, after)).toBeLessThan(1.5);
  });

  it("carries added points to another weight, in the matching place", () => {
    const gid = gidOf(regular, "o");
    setCurrentGid(gid);
    const { curve, grow } = findSegments(outlineOf(regular, "o"));
    const at = addPoint(curve, 0.4)!;
    const p = proj();
    const heavy = editedOutline(black, gid, p);
    const src = outlineOf(black, "o");
    expect(heavy.pts.length).toBe(src.pts.length + grow);
    expect(baseOutline(black, gid, p)!.fits).toBe(true);
    expect(heavy.pts[at].on).toBe(true);
    // The Black's outline keeps its own shape; the new point sits on it.
    expect(maxGap(heavy, src)).toBeLessThan(0.5);
  });

  it("undoes an added point", () => {
    const gid = gidOf(regular, "o");
    setCurrentGid(gid);
    const n = editedPts(regular, gid, proj()).length;
    const { curve, grow } = findSegments(outlineOf(regular, "o"));
    addPoint(curve, 0.5);
    expect(editedPts(regular, gid, proj()).length).toBe(n + grow);
    undo();
    expect(editedPts(regular, gid, proj()).length).toBe(n);
  });
});

describe("deleting points", () => {
  it("merges the curves back when a just-added point is deleted", () => {
    const gid = gidOf(regular, "o");
    setCurrentGid(gid);
    const orig = editedOutline(regular, gid, proj());
    const { curve } = findSegments(orig);
    const at = addPoint(curve, 0.35)!;
    const withPt = editedOutline(regular, gid, proj());
    expect(deletePoints([at])).toBe(true);
    const back = editedOutline(regular, gid, proj());
    expect(back.pts.length).toBe(withPt.pts.length - 2);
    expect(maxGap(back, orig)).toBeLessThan(1);
    expect(maxGap(orig, back)).toBeLessThan(1);
  });

  it("removes a corner point", () => {
    const gid = gidOf(regular, "H");
    setCurrentGid(gid);
    const n = editedPts(regular, gid, proj()).length;
    expect(deletePoints([0])).toBe(true);
    expect(editedPts(regular, gid, proj()).length).toBe(n - 1);
    expect(proj().edits[gid].ops).toEqual([{ del: 0 }]);
  });

  it("drops a contour left with fewer than three points", () => {
    const o = outlineOf(regular, "i");
    expect(o.ends.length).toBe(2);
    const first = o.ends[0];
    const ops = deleteOps(o, Array.from({ length: first }, (_, k) => k)); // all but one point of contour 1
    const r = applyOps(o, ops)!;
    expect(r.ends.length).toBe(1);
    expect(r.pts.length).toBe(o.pts.length - (first + 1));
  });

  it("deletes several points across the end of a contour", () => {
    const o = outlineOf(regular, "o");
    const last = o.ends[0];
    const r = applyOps(o, deleteOps(o, [0, last]))!;
    expect(r.pts.length).toBeLessThanOrEqual(o.pts.length - 2);
    expect(r.ends[r.ends.length - 1]).toBe(r.pts.length - 1);
  });
});

describe("export", () => {
  it("writes glyphs with added and removed points and raises maxp", () => {
    const gid = gidOf(regular, "o");
    setCurrentGid(gid);
    const { curve } = findSegments(outlineOf(regular, "o"));
    addPoint(curve, 0.5);
    setCurrentGid(gidOf(regular, "H"));
    deletePoints([0]);
    const p = proj();
    const out = buildFont(regular, "Test Face", outlineSource(regular, p));
    const back = parseFont(out.buffer as ArrayBuffer);
    for (const ch of "oH") {
      const g = gidOf(regular, ch);
      const bg = back.glyphs[g];
      if (bg.type !== "simple") throw new Error("not simple");
      const want = editedOutline(regular, g, p);
      expect(bg.ends).toEqual(want.ends);
      expect(bg.pts).toEqual(want.pts.map((q: Point) => ({ x: Math.round(q.x), y: Math.round(q.y), on: q.on })));
    }
    const maxp = new DataView(back.tables.maxp.buffer, back.tables.maxp.byteOffset);
    const most = Math.max(...back.glyphs.map((G) => (G.type === "simple" ? G.pts.length : 0)));
    expect(maxp.getUint16(6)).toBeGreaterThanOrEqual(most);
    // Composites built from an edited glyph pick up its new points.
    expect(contours(regular, gid, p).flat().length).toBe(editedPts(regular, gid, p).length);
  });
});
