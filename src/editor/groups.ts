/**
 * Glyph groups and zones, so one edit can apply to every glyph that shares a feature.
 *
 * Point edits are stored per point index, and point 14 of "g" has nothing to do with point 14 of
 * "y", so a group can't replay one glyph's point moves on another. Instead a linked edit is
 * re-run on each glyph in the group: spacing values, whole-glyph reshapes, and zone reshapes,
 * where a zone is a band of the outline such as everything below the baseline (the tails).
 */
import { bbox } from "../font/geometry";
import type { Font } from "../font/types";
import { baseOutline, contours, newProject, type Project } from "./project";
import { stageGroups } from "./stages";

export type ZoneKey = "desc" | "asc" | "cap";

export interface Zone {
  key: ZoneKey;
  label: string;
  /** Is a point at height y (in the source outline) inside the zone? */
  has(y: number, f: Font): boolean;
  /** Vertical scaling of the zone is anchored here, so a taller tail stays attached at the baseline. */
  anchor(f: Font): number;
}

/** Leaves round overshoots (o dipping just under the baseline) out of a zone. */
const margin = (f: Font) => Math.round(f.upm * 0.025);

export const ZONES: Record<ZoneKey, Zone> = {
  desc: { key: "desc", label: "below baseline", has: (y, f) => y < -margin(f), anchor: () => 0 },
  asc: { key: "asc", label: "above x-height", has: (y, f) => y > f.xh + margin(f), anchor: (f) => f.xh },
  cap: { key: "cap", label: "above cap height", has: (y, f) => y > f.cap + margin(f), anchor: (f) => f.cap },
};

/**
 * Indices of a simple glyph's points that lie in the zone in the source outline (with any added
 * or removed points, but before points were moved).
 */
export function zonePts(f: Font, gid: number, z: Zone, p: Project = newProject()): number[] {
  const o = baseOutline(f, gid, p);
  if (!o) return [];
  const out: number[] = [];
  o.pts.forEach((q, i) => {
    if (z.has(q.y, f)) out.push(i);
  });
  return out;
}

/** A group the user made, stored in the project by characters so it survives other cuts. */
export interface CustomGroup {
  name: string;
  chars: string;
}

export interface GlyphGroup {
  id: string;
  name: string;
  gids: number[];
  /** Index into project.groups for a user group. */
  custom?: number;
}

const isAccented = (c: number) => String.fromCodePoint(c).normalize("NFD").length > 1;

/** Groups worked out from the font: by case, figures, and by which zones the outline reaches. */
export function autoGroups(f: Font): GlyphGroup[] {
  const blank = newProject();
  const m = margin(f);
  const upper: number[] = [];
  const lower: number[] = [];
  const figs: number[] = [];
  const lowerTails: number[] = [];
  const lowerAsc: number[] = [];
  const upperTails: number[] = [];
  const seen = new Set<number>();
  for (const [c, gid] of [...f.cmap].sort((a, b) => a[0] - b[0])) {
    if (seen.has(gid)) continue;
    seen.add(gid);
    const ch = String.fromCodePoint(c);
    const isU = /\p{Lu}/u.test(ch);
    const isL = /\p{Ll}/u.test(ch);
    if (isU) upper.push(gid);
    if (isL) lower.push(gid);
    if (/\p{Nd}/u.test(ch)) figs.push(gid);
    // Shape groups only take glyphs with their own outline and no accent, so é isn't an "ascender".
    if ((!isU && !isL) || isAccented(c) || f.glyphs[gid].type !== "simple") continue;
    const box = bbox(contours(f, gid, blank, 0, true).flat());
    if (!box) continue;
    if (box[1] < -m) (isU ? upperTails : lowerTails).push(gid);
    if (isL && box[3] > f.xh + m) lowerAsc.push(gid);
  }
  return [
    { id: "auto:upper", name: "Uppercase", gids: upper },
    { id: "auto:lower", name: "Lowercase", gids: lower },
    { id: "auto:figs", name: "Figures", gids: figs },
    { id: "auto:lowerTails", name: "Lowercase with tails", gids: lowerTails },
    { id: "auto:lowerAsc", name: "Lowercase with ascenders", gids: lowerAsc },
    { id: "auto:upperTails", name: "Uppercase with tails", gids: upperTails },
  ].filter((g) => g.gids.length > 0);
}

export function customGroups(f: Font, p: Project): GlyphGroup[] {
  return (p.groups || []).map((g, i) => ({
    id: "custom:" + i,
    name: g.name,
    custom: i,
    gids: [...new Set([...g.chars].map((ch) => f.cmap.get(ch.codePointAt(0)!)).filter((x): x is number => x != null))],
  }));
}

export function allGroups(f: Font, p: Project): GlyphGroup[] {
  return [...autoGroups(f), ...stageGroups(f), ...customGroups(f, p)];
}

/** Characters of a group, for showing its members. */
export function groupChars(f: Font, g: GlyphGroup): string {
  return g.gids.map((gid) => (f.rev.has(gid) ? String.fromCodePoint(f.rev.get(gid)!) : "")).join("");
}
