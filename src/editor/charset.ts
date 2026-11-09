/**
 * Which characters a font has: capitals only, lowercase only or both, and the full character set
 * of the starting font or just the basic one. Nothing is redrawn: the exported font's character
 * map points the dropped case at the kept one (so typing "sample" in a capitals-only font gives
 * SAMPLE), and a basic font simply has no entries for the characters left out.
 */
import type { Font } from "../font/types";
import type { Project } from "./project";

export type LetterCase = "both" | "upper" | "lower";
export type Charset = "full" | "basic";

/** Beyond printable ASCII, the basic set keeps the no-break space and everyday typographic marks. */
const BASIC_EXTRA = new Set([..." £€‘’“”–—…•"].map((c) => c.codePointAt(0)!));

export const isBasic = (c: number) => (c >= 0x20 && c <= 0x7e) || BASIC_EXTRA.has(c);

const caseOf = (p: Project): LetterCase => p.letterCase || "both";
const setOf = (p: Project): Charset => p.charset || "full";

/** True when the project leaves the starting font's character map as it is. */
export const isDefaultCharset = (p: Project) => caseOf(p) === "both" && setOf(p) === "full";

/** The character `c` turns into: its capital in a capitals-only font, its lowercase in a lowercase-only one. */
function folded(font: Font, p: Project, c: number): number {
  const lc = caseOf(p);
  if (lc === "both") return c;
  const ch = String.fromCodePoint(c);
  const t = lc === "upper" ? ch.toUpperCase() : ch.toLowerCase();
  if (t === ch || [...t].length !== 1) return c;
  const u = t.codePointAt(0)!;
  return font.cmap.has(u) ? u : c;
}

/** The character map the edited font uses (for export, the live preview and the artboard). */
export function outputCmap(font: Font, p: Project): Map<number, number> {
  if (isDefaultCharset(p)) return font.cmap;
  const basic = setOf(p) === "basic";
  const out = new Map<number, number>();
  for (const c of font.cmap.keys()) {
    if (basic && !isBasic(c)) continue;
    out.set(c, font.cmap.get(folded(font, p, c))!);
  }
  return out;
}

/** Whether `c` is a character the user designs: in the font, and not just a copy of the other case. */
export function isDrawn(font: Font, p: Project, c: number): boolean {
  if (!font.cmap.has(c)) return false;
  if (setOf(p) === "basic" && !isBasic(c)) return false;
  return folded(font, p, c) === c;
}

export const LETTER_CASES: { key: LetterCase; label: string }[] = [
  { key: "both", label: "Both" },
  { key: "upper", label: "Capitals only" },
  { key: "lower", label: "Lowercase only" },
];
