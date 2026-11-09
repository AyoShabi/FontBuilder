/** The Check font window: lists slips in the letters you changed, and fixes them one letter at a time or all at once. */
import { checkFont, fixFont, ISSUE_LABEL, type Issue } from "../editor/check";
import { font, persist, proj, setCurrentGid, state } from "../editor/state";
import type { App } from "./app";
import { $, escapeHtml, toast } from "./dom";
import { renderGrids } from "./grids";
import { scheduleLive } from "./live";

function label(gid: number): string {
  const c = font().rev.get(gid);
  return c != null ? String.fromCodePoint(c) : `#${gid}`;
}

function render(): void {
  const issues = checkFont(font(), proj());
  const byGlyph = new Map<number, Issue[]>();
  for (const i of issues) byGlyph.set(i.gid, [...(byGlyph.get(i.gid) || []), i]);
  const edited = Object.keys(proj().edits).length;
  $("#checkSum").textContent = !edited
    ? "You haven't changed any letters yet, so there's nothing to check."
    : !issues.length
      ? "Everything looks consistent. No slips found in the letters you changed."
      : `${issues.length} slip${issues.length === 1 ? "" : "s"} in ${byGlyph.size} letter${byGlyph.size === 1 ? "" : "s"}. Fixing moves only the points you changed, and you can undo it.`;
  $<HTMLButtonElement>("#checkFixAll").hidden = !issues.length;
  $("#checkList").innerHTML = [...byGlyph]
    .map(([gid, list]) => {
      const kinds = [...new Set(list.map((i) => i.kind))];
      return `<div class="chkrow"><span class="big">${escapeHtml(label(gid))}</span><div class="chkwhat">${kinds
        .map((k) => `<div><b>${ISSUE_LABEL[k]}</b> <span class="note">${escapeHtml(list.find((i) => i.kind === k)!.text)}${list.filter((i) => i.kind === k).length > 1 ? ` (and ${list.filter((i) => i.kind === k).length - 1} more)` : ""}</span></div>`)
        .join("")}</div><div class="btns"><button data-show="${gid}">Show</button><button data-fix="${gid}">Fix</button></div></div>`;
    })
    .join("");
}

export function bindCheck(app: App): void {
  const dlg = $("#checkDlg");
  const after = () => {
    renderGrids();
    app.renderAll();
    scheduleLive(true);
    persist();
    render();
  };
  $("#checkFont").onclick = () => {
    if (!state.font) return;
    render();
    dlg.hidden = false;
  };
  $("#checkClose").onclick = () => (dlg.hidden = true);
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dlg.hidden = true;
  });
  $("#checkFixAll").onclick = () => {
    const n = fixFont(font(), proj());
    state.selPts.clear();
    after();
    toast(n ? `Fixed ${n} letter${n === 1 ? "" : "s"}. Ctrl+Z undoes it.` : "Nothing could be fixed automatically.");
  };
  $("#checkList").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button");
    if (!b) return;
    if (b.dataset.fix) {
      const gid = +b.dataset.fix;
      fixFont(font(), proj(), [gid]);
      if (gid === state.store.sel[state.store.slug]) state.selPts.clear();
      after();
    } else if (b.dataset.show) {
      const gid = +b.dataset.show;
      setCurrentGid(gid);
      state.zone = null;
      const issues = checkFont(font(), proj()).filter((i) => i.gid === gid);
      state.selPts = new Set(issues.flatMap((i) => i.pts));
      dlg.hidden = true;
      app.renderAll();
      persist();
      toast("The points involved are selected.");
    }
  });
}
