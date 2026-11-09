/** The design stages strip above the bench: stepper, the stage's letters, review marks and proofs. */
import { selectZone } from "../editor/edits";
import { pushUndo } from "../editor/history";
import { isEdited } from "../editor/project";
import { isDrawn } from "../editor/charset";
import {
  STAGES,
  firstOpenStage,
  isReviewed,
  nextOpenChar,
  stageGroupId,
  stageProgress,
  toggleReviewed,
} from "../editor/stages";
import { currentGid, font, persist, proj, setCurrentGid, state } from "../editor/state";
import type { App } from "./app";
import { $, escapeHtml } from "./dom";

/** The stage being worked on. A project that never picked one starts at the first unfinished stage. */
export function currentStage(): number {
  const p = proj();
  if (p.stage == null || !STAGES[p.stage] || !stageProgress(font(), p, STAGES[p.stage]).total) p.stage = firstOpenStage(font(), p);
  return p.stage;
}

const currentChar = (): string | null => {
  const c = font().rev.get(currentGid());
  return c != null ? String.fromCodePoint(c) : null;
};

export function renderStages(): void {
  const f = font();
  const p = proj();
  const si = currentStage();
  const s = STAGES[si];
  const cur = currentChar();

  $("#stepper").innerHTML = STAGES.map((st, i) => {
    const { done, total } = stageProgress(f, p, st);
    const complete = total > 0 && done === total;
    if (!total)
      return `<li><button data-stage="${i}" disabled title="Not part of your font's characters"><span class="n">${i + 1}</span><span class="t">${escapeHtml(st.title)}</span><span class="pg">Not used</span></button></li>`;
    return `<li><button data-stage="${i}" class="${complete ? "done" : ""}"${i === si ? ' aria-current="step"' : ""}>
      <span class="n">${complete ? "✓" : i + 1}</span><span class="t">${escapeHtml(st.title)}</span>
      <span class="pg">${done} of ${total} reviewed</span></button></li>`;
  }).join("");

  $("#stageGoal").textContent = s.goal;

  $("#stageFams").innerHTML = s.families
    .map((fam, fi) => {
      const shown = [...fam.chars].filter((ch) => !f.cmap.has(ch.codePointAt(0)!) || isDrawn(f, p, ch.codePointAt(0)!));
      if (!shown.some((ch) => f.cmap.has(ch.codePointAt(0)!))) return "";
      const letters = shown
        .map((ch) => {
          const gid = f.cmap.get(ch.codePointAt(0)!);
          if (gid == null) return `<button class="sl missing" disabled title="Not in this font">${escapeHtml(ch)}</button>`;
          const cls = ["sl", gid === currentGid() ? "on" : "", isEdited(p.edits[gid]) ? "edited" : "", isReviewed(p, ch) ? "reviewed" : ""];
          const tip = isReviewed(p, ch) ? "Reviewed" : isEdited(p.edits[gid]) ? "Edited" : "Not started";
          return `<button class="${cls.filter(Boolean).join(" ")}" data-g="${gid}" title="${tip}">${escapeHtml(ch)}</button>`;
        })
        .join("");
      const present = shown.filter((ch) => f.cmap.has(ch.codePointAt(0)!)).length;
      const id = stageGroupId(si, fi);
      const link =
        present > 1
          ? `<button class="link" data-link="${id}" aria-pressed="${state.link === id}" title="Apply spacing and reshapes to the whole family">${state.link === id ? "Linked" : "Link family"}</button>`
          : "";
      return `<div class="fam"><span class="fname">${escapeHtml(fam.name)}</span>${letters}${link}</div>`;
    })
    .join("");

  const mark = $<HTMLButtonElement>("#markReviewed");
  mark.disabled = cur == null;
  const rev = cur != null && isReviewed(p, cur);
  mark.setAttribute("aria-pressed", String(rev));
  mark.textContent = rev ? `${cur} reviewed ✓` : cur != null ? `Mark ${cur} reviewed` : "Mark reviewed";

  const { done, total } = stageProgress(f, p, s);
  const next = STAGES[si + 1];
  $("#stageNote").textContent =
    done < total
      ? `${total - done} left in this stage`
      : next
        ? `Stage done. Next: ${next.title}`
        : "Every stage is reviewed";
  $<HTMLButtonElement>("#nextLetter").textContent = done < total || !next ? "Next letter" : `Go to ${next.title}`;

}

function selectGid(app: App, gid: number): void {
  setCurrentGid(gid);
  selectZone();
  app.renderAll();
  persist();
}

function selectChar(app: App, ch: string): void {
  const gid = font().cmap.get(ch.codePointAt(0)!);
  if (gid != null) selectGid(app, gid);
}

export function bindStages(app: App): void {
  $("#stepper").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-stage]");
    if (!b) return;
    const si = +b.dataset.stage!;
    const p = proj();
    p.stage = si;
    if (state.link?.startsWith("stage:")) state.link = null;
    const ch = nextOpenChar(font(), p, STAGES[si], null) ?? [...STAGES[si].families[0].chars][0];
    const gid = font().cmap.get(ch.codePointAt(0)!);
    if (gid != null) selectGid(app, gid);
    else {
      app.renderAll();
      persist();
    }
  });

  $("#stageFams").addEventListener("click", (e) => {
    const l = (e.target as Element).closest<HTMLElement>("[data-link]");
    if (l) {
      const id = l.dataset.link!;
      state.link = state.link === id ? null : id;
      app.renderAll();
      return;
    }
    const b = (e.target as Element).closest<HTMLElement>("[data-g]");
    if (b) selectGid(app, +b.dataset.g!);
  });

  $("#markReviewed").onclick = () => {
    const ch = currentChar();
    if (ch == null) return;
    pushUndo();
    toggleReviewed(proj(), ch);
    app.renderAll();
    persist();
  };

  $("#nextLetter").onclick = () => {
    const p = proj();
    const si = currentStage();
    const ch = nextOpenChar(font(), p, STAGES[si], currentChar());
    if (ch) return selectChar(app, ch);
    const next = STAGES[si + 1];
    if (next) ($(`[data-stage="${si + 1}"]`) as HTMLButtonElement).click();
  };
}
