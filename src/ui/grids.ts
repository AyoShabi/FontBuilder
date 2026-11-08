import { isEdited } from "../editor/project";
import { selectZone } from "../editor/edits";
import { SIGNATURE, currentGid, font, linkedGroup, persist, proj, setCurrentGid } from "../editor/state";
import type { App } from "./app";
import { $, escapeHtml, hex4 } from "./dom";

function cellHTML(c: number): string {
  const g = font().cmap.get(c);
  const ch = String.fromCodePoint(c);
  const lbl = c === 32 ? "space" : c === 160 ? "nbsp" : "";
  return `<button class="cell${lbl ? " small" : ""}" data-g="${g}" title="${hex4(c)}">${lbl || escapeHtml(ch)}</button>`;
}

export function renderGrids(): void {
  const f = font();
  const sig = [...new Set(SIGNATURE)].map((c) => c.codePointAt(0)!).filter((c) => f.cmap.has(c));
  $("#sigGrid").innerHTML = sig.map(cellHTML).join("");
  const all = [...f.cmap.keys()].filter((c) => c >= 32 && !(c >= 0x7f && c < 0xa0)).sort((a, b) => a - b);
  $("#allGrid").innerHTML = all.map(cellHTML).join("");
  markGrids();
}

/** Highlights the selected glyph and dots the edited ones. */
export function markGrids(): void {
  const p = proj();
  const cur = currentGid();
  const grp = new Set(linkedGroup()?.gids || []);
  document.querySelectorAll<HTMLElement>(".cell").forEach((b) => {
    const g = +b.dataset.g!;
    b.classList.toggle("on", g === cur);
    b.classList.toggle("edited", isEdited(p.edits[g]));
    b.classList.toggle("grp", grp.has(g));
  });
}

export function bindGrids(app: App): void {
  $(".glyphs").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".cell");
    if (!b) return;
    setCurrentGid(+b.dataset.g!);
    selectZone();
    app.renderAll();
    persist();
  });
}
