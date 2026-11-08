/**
 * Step 2: read the letters off the canvas, build the font, and save it with its licence.
 */
import { baselineFromTop, type CanvasMeta } from "../canvas/layout";
import { hostCall } from "../canvas/script";
import { buildBrandFont, type BuildResult } from "../export/build";
import type { DrawnLetter } from "../export/letters";
import { parseFont } from "../font/parser";
import type { Font } from "../font/types";
import { psName, type FontNaming } from "../font/writer";
import { checkLicence, usesReservedName } from "../licence";
import { chooseFontFile, nodeRequire, runHost } from "./cep";
import { readFontBytes } from "./fonts";

export interface ReadResult {
  letters: DrawnLetter[];
  /** Kinds of things on the Letters layer that won't be in the font: "stroke", "text", "other". */
  notes: string[];
  /** Shapes that aren't on any artboard. */
  outside: number;
}

export async function readCanvas(meta: CanvasMeta): Promise<ReadResult> {
  return JSON.parse(await runHost(hostCall("fbReadLetters", baselineFromTop(meta)))) as ReadResult;
}

/** The source font the canvas was made from. Asks for the file if it has moved. */
export async function loadSource(meta: CanvasMeta): Promise<{ font: Font; path: string | null }> {
  let path = meta.source.path;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (path) return { font: parseFont(await readFontBytes({ path, url: null })), path };
    } catch {
      // Fall through to asking for the file.
    }
    if (attempt === 0) {
      alert(`FontBuilder needs the font this canvas was made from (${meta.source.family} ${meta.source.style}), but it isn't where it was. Choose the file.`);
      path = chooseFontFile();
      if (!path) break;
    }
  }
  throw new Error(`Couldn't open ${meta.source.family} ${meta.source.style}, the font this canvas was made from.`);
}

/** Why a family name can't be used, or null when it's fine. */
export function nameProblem(font: Font, naming: FontNaming): string | null {
  const fam = naming.family.trim();
  if (!fam) return "Give your font a name.";
  if (!/^[\x20-\x7e]+$/.test(fam) || !/^[\x20-\x7e]*$/.test(naming.style)) return "Use only plain letters, numbers and spaces in the name, so every app can show it.";
  if (fam.length > 40) return "Keep the name to 40 characters or fewer.";
  const lic = checkLicence(font.names);
  const reserved = usesReservedName(fam, lic.reserved);
  if (reserved) return `The original font's licence reserves the name “${reserved}”, so your font's name can't include it.`;
  const orig = (font.names[16] || font.names[1] || "").trim().toLowerCase();
  if (orig && fam.toLowerCase() === orig) return "Choose a name that's different from the original font's, so the two don't clash when both are installed.";
  return null;
}

export function build(font: Font, meta: CanvasMeta, read: ReadResult, naming: FontNaming): BuildResult {
  return buildBrandFont(font, meta, read.letters, { family: naming.family.trim(), style: naming.style.trim() || "Regular" });
}

/** Plain-language notes about what was left out. */
export function readNotes(r: ReadResult, empty: string[]): string[] {
  const out: string[] = [];
  if (r.notes.includes("stroke")) out.push("Some shapes only have a stroke, so they were left out. Select them and use Object > Path > Outline Stroke to include them.");
  if (r.notes.includes("text")) out.push("There's live text on the Letters layer, which was left out. Use Type > Create Outlines to include it.");
  if (r.notes.includes("other")) out.push("Some items on the Letters layer (images, symbols or similar) were left out. Only shapes go into the font.");
  if (r.outside) out.push(`${r.outside} shape${r.outside > 1 ? "s aren't" : " isn't"} on any letter's artboard, so ${r.outside > 1 ? "they were" : "it was"} left out.`);
  if (empty.length) out.push(`These letters came out empty: ${empty.join(" ")}`);
  return out;
}

/** Saves the font and its licence. Returns the font's path, or null if cancelled. */
export function save(bytes: Uint8Array, naming: FontNaming, sourcePath: string | null, font: Font): string | null {
  const req = nodeRequire();
  const fsDialog = window.cep?.fs as unknown as { showSaveDialogEx(title: string, initial: string, types: string[], name: string): { err: number; data: string } } | undefined;
  if (!req || !fsDialog) throw new Error("Saving works inside Illustrator.");
  const fs = req("fs") as typeof import("fs");
  const path = req("path") as typeof import("path");
  const { Buffer } = req("buffer") as typeof import("buffer");
  const r = fsDialog.showSaveDialogEx("Save your font", "", ["ttf"], psName(naming.family, naming.style || "Regular") + ".ttf");
  if (r.err !== 0 || !r.data) return null;
  const file = /\.ttf$/i.test(r.data) ? r.data : r.data + ".ttf";
  fs.writeFileSync(file, Buffer.from(bytes));

  // The licence has to travel with the font. Use the source's licence file when there is one.
  let licence = "";
  if (sourcePath) {
    const dir = path.dirname(sourcePath);
    for (const n of ["OFL.txt", "LICENSE.txt", "LICENSE"]) {
      try {
        licence = fs.readFileSync(path.join(dir, n), "utf8");
        break;
      } catch {
        // Try the next name.
      }
    }
  }
  if (!licence) licence = [font.names[0], "", font.names[13], font.names[14]].filter((x) => x != null).join("\n");
  fs.writeFileSync(file.replace(/\.ttf$/i, "-LICENSE.txt"), licence);
  return file;
}
