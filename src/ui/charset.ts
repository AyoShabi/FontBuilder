/** The Characters card: capitals only / lowercase only / both, and all or basic special characters. */
import { isBasic, isDrawn, type Charset, type LetterCase } from "../editor/charset";
import { selectZone } from "../editor/edits";
import { pushUndo } from "../editor/history";
import { currentGid, font, persist, proj, setCurrentGid, state } from "../editor/state";
import type { App } from "./app";
import { $ } from "./dom";
import { scheduleLive } from "./live";

export function renderCharset(): void {
  if (!state.font) return;
  const f = font();
  const p = proj();
  const lc = p.letterCase || "both";
  const cs = p.charset || "full";
  document.querySelectorAll<HTMLElement>("#caseSeg [data-case]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.case === lc)));
  document.querySelectorAll<HTMLElement>("#setSeg [data-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.set === cs)));
  const notes: string[] = [];
  if (lc === "upper") notes.push("Typing lowercase gives your capitals.");
  if (lc === "lower") notes.push("Typing capitals gives your lowercase.");
  if (cs === "basic") {
    const gone = [...f.cmap.keys()].filter((c) => c > 0x20 && !isBasic(c)).length;
    notes.push(`${gone} accented letters and symbols are left out of your font.`);
  }
  $("#charNote").textContent = notes.join(" ");
}

/** If the letter being edited is no longer drawn (say, "n" in a capitals-only font), move to one that is. */
function keepCurrentDrawn(): void {
  const f = font();
  const p = proj();
  const c = f.rev.get(currentGid());
  if (c == null || isDrawn(f, p, c)) return;
  const prefer = [p.letterCase === "lower" ? "n" : "H", "H", "n", "A", "a"];
  for (const ch of prefer) {
    const cp = ch.codePointAt(0)!;
    if (isDrawn(f, p, cp)) return setCurrentGid(f.cmap.get(cp)!);
  }
}

export function bindCharset(app: App): void {
  const apply = (fn: () => void) => {
    pushUndo();
    fn();
    keepCurrentDrawn();
    selectZone();
    renderCharset();
    app.renderGrids();
    app.renderAll();
    scheduleLive(true);
    persist();
  };
  $("#caseSeg").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-case]");
    if (b) apply(() => (proj().letterCase = b.dataset.case as LetterCase));
  });
  $("#setSeg").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-set]");
    if (b) apply(() => (proj().charset = b.dataset.set as Charset));
  });
}
