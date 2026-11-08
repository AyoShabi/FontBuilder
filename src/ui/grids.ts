import { isEdited } from "../editor/project";
import { selectZone } from "../editor/edits";
import { currentGid, font, linkedGroup, persist, proj, setCurrentGid } from "../editor/state";
import type { App } from "./app";
import { $, escapeHtml, hex4 } from "./dom";

function cellHTML(c: number): string {
  const g = font().cmap.get(c);
  const ch = String.fromCodePoint(c);
  const lbl = c === 32 ? "space" : c === 160 ? "nbsp" : "";
  return `<button class="cell${lbl ? " small" : ""}" data-g="${g}" title="${hex4(c)}">${lbl || escapeHtml(ch)}</button>`;
}

/** Letters in the order of the design stages (a–z, A–Z, 0–9), then everything else. */
function order(c: number): number {
  if (c >= 97 && c <= 122) return 0;
  if (c >= 65 && c <= 90) return 1;
  if (c >= 48 && c <= 57) return 2;
  return c < 128 ? 3 : 4;
}

export function renderGrids(): void {
  const f = font();
  const all = [...f.cmap.keys()].filter((c) => c >= 32 && !(c >= 0x7f && c < 0xa0)).sort((a, b) => order(a) - order(b) || a - b);
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
