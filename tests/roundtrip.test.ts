import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFont } from "../src/font/parser";
import { buildFont, psName } from "../src/font/writer";
import { editedPts, newProject, outlineSource, type Project } from "../src/editor/project";

const FONTS = join(__dirname, "..", "extension", "fonts");

function load(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** One cut from each bundled family. */
const samples = readdirSync(FONTS).map((slug) => {
  const file = readdirSync(join(FONTS, slug)).find((f) => f.endsWith(".ttf"))!;
  return { slug, path: join(FONTS, slug, file) };
});

function wholeFileChecksum(u8: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < u8.length; i += 4) {
    s = (s + (((u8[i] << 24) | ((u8[i + 1] ?? 0) << 16) | ((u8[i + 2] ?? 0) << 8) | (u8[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return s;
}

describe.each(samples)("$slug", ({ path }) => {
  const src = parseFont(load(path));

  it("round-trips unedited outlines, advances and layout tables", () => {
    const out = buildFont(src, "Test Face", outlineSource(src, newProject()));
    const back = parseFont(out.buffer as ArrayBuffer);
    expect(back.N).toBe(src.N);
    expect(back.adv).toEqual(src.adv);
    expect([...back.cmap]).toEqual([...src.cmap]);
    for (let g = 0; g < src.N; g++) {
      const a = src.glyphs[g];
      const b = back.glyphs[g];
      expect(b.type).toBe(a.type);
      if (a.type === "simple" && b.type === "simple") {
        expect(b.pts).toEqual(a.pts);
        expect(b.ends).toEqual(a.ends);
      }
      if (a.type === "composite" && b.type === "composite") expect(b.comps).toEqual(a.comps);
    }
    for (const t of ["GPOS", "GSUB", "GDEF"]) {
      if (src.tables[t]) expect(back.tables[t]).toEqual(src.tables[t]);
    }
    expect(wholeFileChecksum(out)).toBe(0xb1b0afba);
  });

  it("renames the font and keeps the copyright and licence", () => {
    const back = parseFont(buildFont(src, "Test Face", outlineSource(src, newProject())).buffer as ArrayBuffer);
    expect(back.names[1]).toBe("Test Face");
    expect(back.names[6]).toBe(psName("Test Face"));
    if (src.names[0]) expect(back.names[0]).toBe(src.names[0]);
    expect(back.names[13]).toBeTruthy();
  });

  it("writes point edits, shifts and tracking", () => {
    const gid = src.cmap.get(72)!; // H
    const G = src.glyphs[gid];
    if (G.type !== "simple") return;
    const p: Project = { ...newProject(), tracking: 20, edits: { [gid]: { pts: { 0: [15, -7] }, shift: 4, adv: 9 } } };
    const back = parseFont(buildFont(src, "Test Face", outlineSource(src, p)).buffer as ArrayBuffer);
    const bg = back.glyphs[gid];
    expect(bg.type).toBe("simple");
    if (bg.type !== "simple") return;
    expect(bg.pts[0]).toEqual({ x: G.pts[0].x + 15 + 4 + 10, y: G.pts[0].y - 7, on: G.pts[0].on });
    expect(bg.pts).toEqual(editedPts(src, gid, p));
    expect(back.adv[gid]).toBe(src.adv[gid] + 4 + 9 + 20);
  });
});

it("rejects CFF and WOFF fonts with a helpful message", () => {
  const otto = new Uint8Array(16);
  new DataView(otto.buffer).setUint32(0, 0x4f54544f);
  expect(() => parseFont(otto.buffer)).toThrow(/CFF/);
  const woff = new Uint8Array(16);
  new DataView(woff.buffer).setUint32(0, 0x774f4646);
  expect(() => parseFont(woff.buffer)).toThrow(/WOFF/);
});
