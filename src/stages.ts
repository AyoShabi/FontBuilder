/**
 * The design stages: the order a type designer works through a font. Key letters first, because
 * they set the weight, contrast and curves; then the letters that follow from them; then figures
 * and punctuation. Each stage has families of letters built from a source letter.
 */

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
  /** Test words to read while working on the stage. */
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
    goal: "Carry n and o across the lowercase: stems and arches from n, bowls from o. Then fix each letter by eye.",
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

/** Characters of a stage, each once, in family order. Characters already in an earlier stage are left out. */
export function stageChars(si: number): string[] {
  const before = new Set(STAGES.slice(0, si).flatMap((s) => s.families.flatMap((f) => [...f.chars])));
  return [...new Set(STAGES[si].families.flatMap((f) => [...f.chars]))].filter((ch) => !before.has(ch));
}
