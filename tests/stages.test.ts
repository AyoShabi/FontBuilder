import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFont } from "../src/font/parser";
import { movePts, reshapeOp, setMetric } from "../src/editor/edits";
import { allGroups, groupChars } from "../src/editor/groups";
import { newProject } from "../src/editor/project";
import { STAGES, firstOpenStage, nextOpenChar, stageChars, stageGroupId, stageProgress, toggleReviewed } from "../src/editor/stages";
import { setCurrentGid, state } from "../src/editor/state";

const dir = join(__dirname, "..", "extension", "fonts", "anybody");
const b = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith(".ttf"))!));
const font = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
const gidOf = (ch: string) => font.cmap.get(ch.codePointAt(0)!)!;

describe("stages", () => {
  it("starts from the key letters and covers the basic alphabet", () => {
    expect(stageChars(STAGES[0]).join("")).toBe("noHO");
    const all = new Set(STAGES.flatMap(stageChars));
    for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") expect(all.has(ch)).toBe(true);
  });

  it("tracks review progress and moves to the next open stage", () => {
    const p = newProject();
    expect(firstOpenStage(font, p)).toBe(0);
    for (const ch of "noHO") toggleReviewed(p, ch);
    expect(stageProgress(font, p, STAGES[0])).toEqual({ done: 4, total: 4 });
    expect(firstOpenStage(font, p)).toBe(1);
    toggleReviewed(p, "O");
    expect(firstOpenStage(font, p)).toBe(0);
    expect(nextOpenChar(font, p, STAGES[0], "n")).toBe("O");
    expect(nextOpenChar(font, p, STAGES[0], "O")).toBe(null);
  });

  it("offers each family as a linkable group", () => {
    const g = allGroups(font, newProject()).find((x) => x.id === stageGroupId(1, 0))!;
    expect(groupChars(font, g)).toBe("nhmu");
  });

  it("carries a change on n across the n family", () => {
    state.font = font;
    state.store.slug = "anybody";
    state.store.projects.anybody = newProject();
    state.selPts = new Set();
    state.zone = null;
    state.link = stageGroupId(1, 0);
    setCurrentGid(gidOf("n"));
    setMetric("adv", 700);
    expect(movePts(reshapeOp("sx+", font.upm, false))).toBe(true);
    const p = state.store.projects.anybody;
    for (const ch of "nhmu") expect(p.edits[gidOf(ch)]).toBeDefined();
    expect(p.edits[gidOf("o")]).toBeUndefined();
  });
});
