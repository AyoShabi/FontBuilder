/**
 * The design stages: the order a type designer works through a font. Key letters first, because
 * they set the weight, contrast and curves; then the letters that follow from them; then figures
 * and punctuation. Each stage has families of letters that share parts with a source letter, and
 * each family can be linked like any other glyph group, so a decision made on n carries to h m u.
 */
import type { Font } from "../font/types";
import type { GlyphGroup } from "./groups";
import type { Project } from "./project";

export interface StageFamily {
  name: string;
  /** The source letter comes first; the rest are built from it. */
  chars: string;
}

export interface Stage {
  id: string;
  title: string;
  /** What to settle in this stage. */
  goal: string;
  families: StageFamily[];
  /** Proof strings, set in the live font while working on the stage. */
  proofs: string[];
}

export const STAGES: Stage[] = [
  {
    id: "key",
    title: "Key letters",
    goal: "Settle stroke weight, contrast and curves on n o H O. Every later stage copies these decisions, so get them right here first.",
    families: [
      { name: "Lowercase keys", chars: "no" },
      { name: "Capital keys", chars: "HO" },
    ],
    proofs: ["nonono nnoonn", "HOHOHO HHOOHH", "noon HOHO"],
  },
  {
    id: "lower",
    title: "Lowercase",
    goal: "Carry n and o across the lowercase: stems and arches from n, bowls from o. Link a family to make one change on all of it, then fix each letter by eye.",
    families: [
      { name: "n family", chars: "nhmu" },
      { name: "o family", chars: "obdpq" },
      { name: "Round", chars: "ceas" },
      { name: "The rest", chars: "fgijklrtvwxyz" },
    ],
    proofs: ["hamburgefonstiv", "nnhnnmnnunn", "oobodopoqoo", "nanbncndnenfngn", "minimum quiz jaywalk"],
  },
  {
    id: "upper",
    title: "Capitals",
    goal: "Build the capitals from H and O: straight letters from H, round ones from O. Check them in caps-only words and next to lowercase.",
    families: [
      { name: "H family", chars: "HEFLIT" },
      { name: "O family", chars: "OCGDQ" },
      { name: "The rest", chars: "ABJKMNPRSUVWXYZ" },
    ],
    proofs: ["HAMBURGEFONSTIV", "HHEHHFHHLHHIHHT", "OOCOOGOODOOQOO", "Hamburgefonstiv"],
  },
  {
    id: "figs",
    title: "Figures and punctuation",
    goal: "Match the figures to the capitals' height and weight, then fit punctuation to the letters around it.",
    families: [
      { name: "Figures", chars: "0123456789" },
      { name: "Punctuation", chars: ".,:;!?'\"-()&@£" },
    ],
    proofs: ["H0H1H2H3H4H5H6H7H8H9H", "£4.50 for a jumper? 1,280 sold!", "n.n,n:n;n!n?n(n)n-n&n@n"],
  },
];

/** Characters of a stage, each once, in family order. */
export function stageChars(s: Stage): string[] {
  return [...new Set(s.families.flatMap((fam) => [...fam.chars]))];
}

const gidOf = (f: Font, ch: string) => f.cmap.get(ch.codePointAt(0)!);

/** Characters of a stage that the font has. */
export function presentChars(f: Font, s: Stage): string[] {
  return stageChars(s).filter((ch) => gidOf(f, ch) != null);
}

export const stageGroupId = (si: number, fi: number) => `stage:${STAGES[si].id}:${fi}`;

/** Every stage family as a glyph group, so it can be linked in the inspector. */
export function stageGroups(f: Font): GlyphGroup[] {
  const out: GlyphGroup[] = [];
  STAGES.forEach((s, si) =>
    s.families.forEach((fam, fi) => {
      const gids = [...new Set([...fam.chars].map((ch) => gidOf(f, ch)).filter((x): x is number => x != null))];
      if (gids.length > 1) out.push({ id: stageGroupId(si, fi), name: `${s.title}: ${fam.name}`, gids });
    }),
  );
  return out;
}

export const isReviewed = (p: Project, ch: string) => !!p.reviewed?.includes(ch);

/** Marks or unmarks a character as reviewed. Returns its new state. */
export function toggleReviewed(p: Project, ch: string): boolean {
  const set = new Set(p.reviewed || "");
  const now = !set.has(ch);
  if (now) set.add(ch);
  else set.delete(ch);
  p.reviewed = [...set].join("");
  return now;
}

/** How many of a stage's letters (that the font has) are reviewed. */
export function stageProgress(f: Font, p: Project, s: Stage): { done: number; total: number } {
  const chars = presentChars(f, s);
  return { done: chars.filter((ch) => isReviewed(p, ch)).length, total: chars.length };
}

/** The first stage with letters still to review, or the last stage when all are done. */
export function firstOpenStage(f: Font, p: Project): number {
  const i = STAGES.findIndex((s) => {
    const { done, total } = stageProgress(f, p, s);
    return done < total;
  });
  return i < 0 ? STAGES.length - 1 : i;
}

/** The next letter in the stage after `from` that isn't reviewed, wrapping round. Null when all are. */
export function nextOpenChar(f: Font, p: Project, s: Stage, from: string | null): string | null {
  const chars = presentChars(f, s);
  const start = from ? chars.indexOf(from) + 1 : 0;
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[(start + k) % chars.length];
    if (!isReviewed(p, ch) && ch !== from) return ch;
  }
  return null;
}
