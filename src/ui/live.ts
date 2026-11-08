/**
 * Live preview: rebuilds the edited font and swaps it in as the `--live` CSS font family,
 * which the glyph grid, specimen and posters all use.
 */
import { buildFont } from "../font/writer";
import { outlineSource } from "../editor/project";
import { proj, state } from "../editor/state";
import { toast } from "./dom";
import { scheduleArtboard } from "./artboard";

let liveFace: FontFace | null = null;
let liveSeq = 0;
let liveTimer = 0;
let liveBusy = false;
let liveAgain = false;

/** Rebuilds soon (debounced) or, with `now`, on the next tick. */
export function scheduleLive(now = false): void {
  clearTimeout(liveTimer);
  liveTimer = window.setTimeout(refreshLive, now ? 0 : 60);
}

async function refreshLive(): Promise<void> {
  const font = state.font;
  if (!font) return;
  if (liveBusy) {
    liveAgain = true;
    return;
  }
  liveBusy = true;
  try {
    const bytes = buildFont(font, "FontBuilder Live", outlineSource(font, proj()));
    const fam = "FontBuilderLive" + ++liveSeq;
    const face = new FontFace(fam, bytes.buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    if (liveFace) document.fonts.delete(liveFace);
    liveFace = face;
    document.documentElement.style.setProperty("--live", `"${fam}"`);
    scheduleArtboard();
  } catch (e) {
    console.error(e);
    toast("The live preview couldn't rebuild that change. Try Undo.");
  }
  liveBusy = false;
  if (liveAgain) {
    liveAgain = false;
    scheduleLive(true);
  }
}
