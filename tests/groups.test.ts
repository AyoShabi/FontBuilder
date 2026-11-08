import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFont } from "../src/font/parser";
import { autoGroups, groupChars, ZONES, zonePts } from "../src/editor/groups";
import { movePts, reshapeOp, setMetric } from "../src/editor/edits";
import { editedPts, newProject } from "../src/editor/project";
import { setCurrentGid, state } from "../src/editor/state";

const dir = join(__dirname, "..", "extension", "fonts", "anybody");
const b = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith(".ttf"))!));
const font = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
const gidOf = (ch: string) => font.cmap.get(ch.codePointAt(0)!)!;

function fresh() {
  state.font = font;
  state.store.slug = "anybody";
  state.store.projects.anybody = newProject();
  state.selPts = new Set();
  state.link = null;
  state.zone = null;
}

describe("auto groups", () => {
  const groups = Object.fromEntries(autoGroups(font).map((g) => [g.id, groupChars(font, g)]));

  it("finds the lowercase letters with tails", () => {
    for (const ch of "gjpqy") expect(groups["auto:lowerTails"]).toContain(ch);
    for (const ch of "aceo") expect(groups["auto:lowerTails"]).not.toContain(ch);
  });

  it("finds ascenders without counting accents", () => {
    for (const ch of "bdhkl") expect(groups["auto:lowerAsc"]).toContain(ch);
    expect(groups["auto:lowerAsc"]).not.toContain("é");
    expect(groups["auto:lowerAsc"]).not.toContain("o");
  });

  it("splits by case", () => {
    expect(groups["auto:upper"]).toContain("Q");
    expect(groups["auto:lower"]).not.toContain("Q");
  });
});

describe("linked edits", () => {
  it("lowers every tail in the group and leaves the bowls alone", () => {
    fresh();
    state.link = "auto:lowerTails";
    state.zone = "desc";
    setCurrentGid(gidOf("p"));
    state.selPts = new Set(zonePts(font, gidOf("p"), ZONES.desc));
    expect(movePts(reshapeOp("dn", font.upm, true))).toBe(true);

    const step = Math.round(font.upm * 0.01);
    for (const ch of "gjpqy") {
      const gid = gidOf(ch);
      const G = font.glyphs[gid];
      if (G.type !== "simple") continue;
      const after = editedPts(font, gid, state.store.projects.anybody);
      const zone = new Set(zonePts(font, gid, ZONES.desc));
      expect(zone.size).toBeGreaterThan(0);
      G.pts.forEach((q, i) => expect(after[i].y - q.y).toBe(zone.has(i) ? -step : 0));
    }
    expect(state.store.projects.anybody.edits[gidOf("o")]).toBeUndefined();
  });

  it("keeps hand-picked points on the current glyph only", () => {
    fresh();
    state.link = "auto:lower";
    setCurrentGid(gidOf("n"));
    state.selPts = new Set([0]);
    movePts((q) => ({ x: q.x + 5, y: q.y }));
    expect(Object.keys(state.store.projects.anybody.edits)).toEqual([String(gidOf("n"))]);
  });

  it("sets spacing across the group", () => {
    fresh();
    state.link = "auto:figs";
    setCurrentGid(gidOf("1"));
    setMetric("adv", 600);
    const p = state.store.projects.anybody;
    for (const ch of "0123456789") expect(font.adv[gidOf(ch)] + (p.edits[gidOf(ch)]?.adv || 0)).toBe(600);
  });
});
