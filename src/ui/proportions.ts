/** Whole-font width, height and slant sliders in the Proportions card. */
import { pushUndo } from "../editor/history";
import type { Proportions } from "../editor/project";
import { persist, proj } from "../editor/state";
import type { App } from "./app";
import { $, $input } from "./dom";
import { scheduleLive } from "./live";
import { syncHeights } from "./toolbar";

const KEYS: { key: keyof Proportions; unit: string; def: number }[] = [
  { key: "width", unit: "%", def: 100 },
  { key: "height", unit: "%", def: 100 },
  { key: "slant", unit: "°", def: 0 },
];

/** Puts the project's proportions into the sliders. */
export function syncProportions(): void {
  const q = proj().proportions || {};
  for (const { key, unit, def } of KEYS) {
    const v = q[key] ?? def;
    $input("#pr_" + key).value = String(v);
    $("#pr_" + key + "o").textContent = v + unit;
  }
}

export function bindProportions(app: App): void {
  let pushed = false;
  for (const { key, unit, def } of KEYS) {
    const r = $input("#pr_" + key);
    r.addEventListener("input", () => {
      if (!pushed) {
        pushUndo(); // one undo step per drag
        pushed = true;
      }
      const p = proj();
      const v = +r.value;
      p.proportions = { ...(p.proportions || {}), [key]: v === def ? undefined : v };
      $("#pr_" + key + "o").textContent = v + unit;
      syncHeights();
      app.renderAll();
      scheduleLive();
      persist();
    });
    r.addEventListener("change", () => {
      pushed = false;
      app.changed();
    });
  }
  $("#resetProps").onclick = () => {
    pushUndo();
    delete proj().proportions;
    syncProportions();
    syncHeights();
    app.changed();
  };
}
