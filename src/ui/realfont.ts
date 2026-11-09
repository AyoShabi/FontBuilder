/**
 * "Use as a real font": saves the edited font under a new preview name, installs it for this
 * user, and sets the chosen text on the artboard in it. The text stays live text you can retype.
 * Each update is a new font (Illustrator can't reload a changed one); older previews are removed.
 */
import { buildFont, psName } from "../font/writer";
import { outlineSource } from "../editor/project";
import { proj, state } from "../editor/state";
import { inIllustrator, runHost } from "../panel/cep";
import { installFont, nextPreviewNumber, removeOldFonts } from "../panel/install";
import { $, toast } from "./dom";
import { checkName, exportNaming } from "./toolbar";

let busy = false;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function status(msg: string): void {
  $("#rfStatus").textContent = msg;
}

/** Saves, installs and applies the current edits. With `tag`, the selected text joins the preview first. */
async function update(tag: boolean): Promise<void> {
  const font = state.font;
  if (!font || busy) return;
  if (!checkName()) return toast("Fix your font's name first (under Your font).");
  busy = true;
  const btns = ["#rfApply", "#rfUpdate"].map((s) => $<HTMLButtonElement>(s));
  btns.forEach((b) => (b.disabled = true));
  try {
    if (tag) {
      const n = +(await runHost("fbFontTagSelection()"));
      if (!n) {
        status("Select some text on your artboard first, then click Use on selected text.");
        return;
      }
    }
    const { family, style } = exportNaming();
    const num = nextPreviewNumber();
    const fam = `${family} Preview ${num}`;
    const ps = psName(fam, style);
    status(`Saving ${fam}…`);
    const bytes = buildFont(font, { family: fam, style }, outlineSource(font, proj()));
    await installFont(bytes, `${ps}.ttf`, `${fam} ${style}`);
    status(`Waiting for Illustrator to load ${fam}…`);
    // Illustrator picks up new fonts within a few seconds of being told about them.
    let n = -1;
    for (let k = 0; k < 20 && n < 0; k++) {
      n = +(await runHost(`fbFontApply(${JSON.stringify(ps)})`));
      if (n < 0) await wait(750);
    }
    if (n < 0) {
      status(`${fam} is installed, but Illustrator hasn't loaded it yet. Restart Illustrator once, then click Update. After that, updates should apply straight away.`);
      return;
    }
    status(n ? `Your text is set in ${fam} (${n} text frame${n > 1 ? "s" : ""}). Click Update after more edits.` : `${fam} is installed. Select text and click Use on selected text.`);
    await removeOldFonts(`${ps}.ttf`);
  } catch (e) {
    status("");
    toast((e as Error).message);
  } finally {
    busy = false;
    btns.forEach((b) => (b.disabled = false));
  }
}

export function bindRealFont(): void {
  if (!inIllustrator()) {
    status("Inside Illustrator, this saves your edits as a font and sets your artboard text in it.");
    ["#rfApply", "#rfUpdate", "#rfStop"].forEach((s) => ($(s) as HTMLButtonElement).disabled = true);
    return;
  }
  $("#rfApply").onclick = () => update(true);
  $("#rfUpdate").onclick = () => update(false);
  $("#rfStop").onclick = async () => {
    try {
      const n = +(await runHost("fbFontUntag()"));
      status(n ? `Stopped. ${n} text frame${n > 1 ? "s" : ""} keep the last preview font until you change it.` : "Nothing to stop.");
    } catch (e) {
      toast((e as Error).message);
    }
  };
  status("Select text on your artboard, then click Use on selected text. Your text stays editable.");
}
