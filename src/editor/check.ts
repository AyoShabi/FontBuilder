/**
 * Checks the letters you changed for small slips that make a font look uneven, and fixes them.
 *
 * Only edited letters are checked, and only points you moved or added, so the starting font's
 * own design (such as round letters dipping just past the baseline on purpose) is left alone.
 *
 * Work happens in "flat" units: point positions with height changes and point moves applied but
 * before whole-font width and slant. A fix there maps straight onto the stored offsets.
 */
import type { Font, Point } from "../font/types";
import { isDrawn } from "./charset";
import { applyStructural, moved } from "./edits";
import { pushUndo } from "./history";
import { mergeContours } from "./merge";
import { deleteOps, fillDirection, signedArea, type Outline, type OutlineOp } from "./outline";
import { baseOutline, cleanEdit, heightMapper, isEdited, newHeights, type Project } from "./project";

export type IssueKind = "guide" | "line" | "dup" | "stray" | "overlap" | "backwards";

export interface Issue {
  gid: number;
  kind: IssueKind;
  /** Point numbers involved, for selecting them in the editor. */
  pts: number[];
  /** What's wrong, in plain words. */
  text: string;
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  guide: "Just off a guide line",
  line: "Almost straight line",
  dup: "Doubled point",
  stray: "Tiny stray shape",
  overlap: "Overlapping shapes",
  backwards: "Shape runs backwards",
};

interface Flat {
  o: Outline;
  /** The same outline before height changes: what outline steps are stored against. */
  raw: Outline;
  /** Points not in the starting font at this position (moved or added). */
  changed: Set<number>;
}

/** The glyph's outline in flat units and which points the user changed. */
function flatOf(f: Font, gid: number, p: Project): Flat | null {
  const G = f.glyphs[gid];
  const base = baseOutline(f, gid, p);
  if (G.type !== "simple" || !base?.fits) return null;
  const my = heightMapper(f, gid, p);
  const Y = (y: number) => (my ? my(y) : y);
  const m = moved({ ends: base.ends, pts: base.pts.map((q) => ({ ...q, y: Y(q.y) })) }, p.edits[gid]?.pts);
  const orig = new Set(G.pts.map((q) => `${q.x},${Y(q.y)}`));
  const changed = new Set<number>();
  m.pts.forEach((q, i) => {
    if (!orig.has(`${q.x},${q.y}`)) changed.add(i);
  });
  return { o: m, raw: moved(base, p.edits[gid]?.pts), changed };
}

function contourRanges(o: Outline): [number, number][] {
  const r: [number, number][] = [];
  let s = 0;
  for (const e of o.ends) {
    r.push([s, e]);
    s = e + 1;
  }
  return r;
}

const tolOf = (f: Font) => Math.max(3, Math.round(f.upm * 0.012));

/** The font's guide heights in flat units. */
function guidesOf(f: Font, p: Project): number[] {
  const h = newHeights(f, p);
  return [0, h.xh, h.cap, h.asc, h.desc];
}

/** Point moves that would fix guide and line slips: point -> new [x, y]. */
function pointFixes(f: Font, p: Project, fl: Flat): { moves: Map<number, [number, number]>; issues: Omit<Issue, "gid">[] } {
  const tol = tolOf(f);
  const guides = guidesOf(f, p);
  const pts = fl.o.pts.map((q) => ({ ...q }));
  const moves = new Map<number, [number, number]>();
  const issues: Omit<Issue, "gid">[] = [];
  const set = (i: number, x: number, y: number) => {
    pts[i].x = x;
    pts[i].y = y;
    moves.set(i, [x, y]);
  };
  const ranges = contourRanges(fl.o);
  const next = (i: number) => {
    const [s, e] = ranges.find(([s, e]) => i >= s && i <= e)!;
    return i === e ? s : i + 1;
  };
  const prev = (i: number) => {
    const [s, e] = ranges.find(([s, e]) => i >= s && i <= e)!;
    return i === s ? e : i - 1;
  };
  const flatLine = (a: Point, b: Point) => a.on && b.on && Math.abs(a.y - b.y) <= tol && Math.abs(a.x - b.x) > 2 * Math.abs(a.y - b.y);

  // Flat edges that sit a few units off a guide line (a bar just under the cap height, a foot just above the baseline).
  for (const i of fl.changed) {
    const q = pts[i];
    if (!q.on) continue;
    if (!flatLine(q, pts[prev(i)]) && !flatLine(q, pts[next(i)])) continue;
    const g = guides.find((g) => q.y !== g && Math.abs(q.y - g) <= tol);
    if (g == null) continue;
    issues.push({ kind: "guide", pts: [i], text: `Point ${i} is ${Math.abs(q.y - g)} units ${q.y > g ? "above" : "below"} the line at ${g}` });
    set(i, q.x, g);
  }

  // Lines that are a hair off level or upright.
  for (const [s, e] of ranges) {
    for (let i = s; i <= e; i++) {
      const j = next(i);
      const a = pts[i];
      const b = pts[j];
      if (!a.on || !b.on || j === i || (!fl.changed.has(i) && !fl.changed.has(j))) continue;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const level = dy > 0 && dx >= 2 * tol && dy <= Math.max(2, dx * 0.05);
      const upright = dx > 0 && dy >= 2 * tol && dx <= Math.max(2, dy * 0.05);
      if (!level && !upright) continue;
      // Move the changed end; if both changed, keep the one already on a guide (or the first).
      const moveB = fl.changed.has(j) && !(fl.changed.has(i) && level && guides.includes(b.y) && !guides.includes(a.y));
      const [from, to] = moveB ? [a, j] : [b, i];
      const t = pts[to];
      issues.push({ kind: "line", pts: [i, j], text: `The line from point ${i} to ${j} is ${level ? dy : dx} units off ${level ? "level" : "upright"}` });
      if (level) set(to, t.x, from.y);
      else set(to, from.x, t.y);
    }
  }
  return { moves, issues };
}

/** Steps that tidy the outline: doubled points, tiny shapes, backwards shapes, overlaps. */
function structuralFixes(f: Font, p: Project, gid: number, o: Outline, changed: Set<number>): { ops: OutlineOp[]; issues: Omit<Issue, "gid">[] } {
  const issues: Omit<Issue, "gid">[] = [];
  const ranges = contourRanges(o);
  const gone = new Set<number>();
  const minArea = (f.upm * 0.02) ** 2 * 2; // signedArea is twice the area

  for (const [s, e] of ranges) {
    const idx = Array.from({ length: e - s + 1 }, (_, k) => s + k);
    if (!idx.some((i) => changed.has(i))) continue;
    if (idx.length < 3 || Math.abs(signedArea(o.pts.slice(s, e + 1))) < minArea) {
      issues.push({ kind: "stray", pts: idx, text: `A shape of ${idx.length} points is too small to see` });
      idx.forEach((i) => gone.add(i));
      continue;
    }
    for (const i of idx) {
      const j = i === e ? s : i + 1;
      const a = o.pts[i];
      const b = o.pts[j];
      if (a.on && b.on && j !== i && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && (changed.has(i) || changed.has(j))) {
        const drop = changed.has(j) ? j : i;
        if (gone.has(i) || gone.has(j)) continue;
        issues.push({ kind: "dup", pts: [i, j], text: `Points ${i} and ${j} sit on top of each other` });
        gone.add(drop);
      }
    }
  }
  const ops: OutlineOp[] = gone.size ? deleteOps(o, gone) : [];
  if (issues.length) return { ops, issues }; // Fix these first; the next check sees the cleaner outline.

  // Shapes you drew that overlap the letter: merge them into one outline.
  const drew = p.edits[gid]?.ops?.some((op) => "shape" in op);
  if (drew && o.ends.length > 1) {
    const m = mergeContours(o, []);
    if (m && m.ends.length !== o.ends.length) {
      issues.push({ kind: "overlap", pts: [], text: "Shapes you drew overlap the letter. Merging makes one clean outline." });
      return { ops: [{ outline: m.pts.flatMap((q) => [q.x, q.y, q.on ? 1 : 0]), ends: m.ends }], issues };
    }
  }

  // A shape on its own (not inside another) that runs the opposite way to the letter.
  const dir = fillDirection(o);
  const contains = (outer: [number, number], q: Point) => {
    const poly = o.pts.slice(outer[0], outer[1] + 1);
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const pa = poly[a];
      const pb = poly[b];
      if (pa.y > q.y !== pb.y > q.y && q.x < ((pb.x - pa.x) * (q.y - pa.y)) / (pb.y - pa.y) + pa.x) inside = !inside;
    }
    return inside;
  };
  let flipped = false;
  const pts = o.pts.map((q) => ({ ...q }));
  for (const r of ranges) {
    const [s, e] = r;
    if (![...Array(e - s + 1).keys()].some((k) => changed.has(s + k))) continue;
    const c = o.pts.slice(s, e + 1);
    if (Math.sign(signedArea(c)) === dir) continue;
    const inside = ranges.some((r2) => r2 !== r && c.every((q) => contains(r2, q)));
    if (inside) continue;
    issues.push({ kind: "backwards", pts: c.map((_, k) => s + k), text: "A shape runs the wrong way round, so some apps show it as a hole" });
    const rev = [c[0], ...c.slice(1).reverse()];
    rev.forEach((q, k) => (pts[s + k] = { ...q }));
    flipped = true;
  }
  if (flipped) ops.push({ outline: pts.flatMap((q) => [q.x, q.y, q.on ? 1 : 0]), ends: o.ends });
  return { ops, issues };
}

/** Glyphs worth checking: edited simple glyphs that are part of the font being made. */
function checkedGids(f: Font, p: Project): number[] {
  const out: number[] = [];
  for (const k of Object.keys(p.edits)) {
    const gid = +k;
    if (f.glyphs[gid]?.type !== "simple" || !isEdited(p.edits[gid])) continue;
    const c = f.rev.get(gid);
    if (c != null && !isDrawn(f, p, c)) continue;
    out.push(gid);
  }
  return out;
}

/** Everything that looks off in the letters you changed. */
export function checkFont(f: Font, p: Project): Issue[] {
  const out: Issue[] = [];
  for (const gid of checkedGids(f, p)) out.push(...checkGlyph(f, p, gid));
  return out;
}

export function checkGlyph(f: Font, p: Project, gid: number): Issue[] {
  const fl = flatOf(f, gid, p);
  if (!fl) return [];
  const pf = pointFixes(f, p, fl);
  const sf = structuralFixes(f, p, gid, fl.raw, fl.changed);
  return [...pf.issues, ...sf.issues].map((i) => ({ ...i, gid }));
}

/** Fixes one glyph without recording undo. Returns whether it changed. */
function fixGlyph(f: Font, p: Project, gid: number): boolean {
  let changed = false;
  // A few rounds: fixing one thing (deleting a doubled point) can reveal the next.
  for (let round = 0; round < 4; round++) {
    const fl = flatOf(f, gid, p);
    if (!fl) break;
    const { moves } = pointFixes(f, p, fl);
    if (moves.size) {
      const e = (p.edits[gid] = p.edits[gid] || {});
      e.pts = e.pts || {};
      for (const [i, [x, y]] of moves) {
        const q = fl.o.pts[i];
        const d = e.pts[i] || [0, 0];
        e.pts[i] = [d[0] + Math.round(x - q.x), d[1] + Math.round(y - q.y)];
      }
      cleanEdit(e);
      changed = true;
      continue;
    }
    const { ops } = structuralFixes(f, p, gid, fl.raw, fl.changed);
    if (!ops.length || !applyStructural(ops, gid, false)) break;
    changed = true;
  }
  return changed;
}

/** Fixes the given glyphs (every checked glyph when none are given) as one undo step. Returns how many letters changed. */
export function fixFont(f: Font, p: Project, gids?: number[]): number {
  const todo = (gids || checkedGids(f, p)).filter((g) => checkGlyph(f, p, g).length);
  if (!todo.length) return 0;
  pushUndo();
  let n = 0;
  for (const gid of todo) if (fixGlyph(f, p, gid)) n++;
  return n;
}
