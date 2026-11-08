/** The top bar: base font (bundled, installed or chosen), its axes, heights, tracking, and the export name. */
import { parseFont } from "../font/parser";
import { psName, type FontNaming } from "../font/writer";
import { clearHistory, pushUndo } from "../editor/history";
import { keyHeights, newHeights, type Heights } from "../editor/project";
import { AXIS_LABEL, MANIFEST, UPLOAD_PREFIX, famInfo, persist, proj, state, type Family } from "../editor/state";
import { checkLicence, usesReservedName } from "../licence";
import { chooseFontFile, nodeRequire } from "../panel/cep";
import { installedOpenFonts, readFontBytes, type FontEntry } from "../panel/fonts";
import type { App } from "./app";
import { $, $input, escapeHtml, toast } from "./dom";
import { scheduleLive } from "./live";

const UPLOAD_OPTION = "__upload";
const INSTALLED_PREFIX = "__installed:";
let installed: FontEntry[] | null = null;

function fontOptions(): string {
  const { uploads } = state;
  const opt = (v: string, label: string) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`;
  let h = `<optgroup label="Comes with FontBuilder">${MANIFEST.map((f) => opt(f.slug!, f.name)).join("")}</optgroup>`;
  const mine = Object.keys(uploads);
  if (mine.length) h += `<optgroup label="Your fonts">${mine.map((k) => opt(k, uploads[k].name)).join("")}</optgroup>`;
  const inst = (installed || []).filter((e) => !mine.includes(UPLOAD_PREFIX + e.path));
  if (inst.length) h += `<optgroup label="Installed (open licence)">${inst.map((e) => opt(INSTALLED_PREFIX + e.path, e.label)).join("")}</optgroup>`;
  return h + opt(UPLOAD_OPTION, "Choose a .ttf file…");
}

const HEIGHTS: { key: keyof Heights; label: string }[] = [
  { key: "asc", label: "Ascender" },
  { key: "cap", label: "Cap height" },
  { key: "xh", label: "x-height" },
  { key: "desc", label: "Descender" },
];

/** Shows each height's current value in its slider and readout. */
export function syncHeights(): void {
  const f = state.font;
  if (!f) return;
  const k = keyHeights(f);
  const n = newHeights(f, proj());
  const h = proj().heights || {};
  const range = Math.round(f.upm * 0.25);
  for (const { key } of HEIGHTS) {
    const r = $input("#h_" + key);
    r.min = String(-range);
    r.max = String(range);
    r.value = String(h[key] || 0);
    const cur = key === "desc" ? -n.desc : n[key];
    const was = key === "desc" ? -k.desc : k[key];
    $("#h_" + key + "o").textContent = cur === was ? String(cur) : `${cur} (was ${was})`;
  }
}

export function renderToolbar(app: App): void {
  const { store } = state;
  const sel = $<HTMLSelectElement>("#fontSel");
  sel.innerHTML = fontOptions();
  sel.value = store.slug;

  const f = famInfo();
  const box = $("#axes");
  box.innerHTML = "";
  store.loc = store.loc || {};
  for (const a of f.axes || []) {
    if (!a.values.includes(store.loc[a.tag])) store.loc[a.tag] = f.default[a.tag];
    const id = "ax_" + a.tag;
    const w = document.createElement("div");
    w.className = "field";
    w.innerHTML = `<div class="row"><label class="label" for="${id}">${AXIS_LABEL[a.tag] || a.tag}</label><output id="${id}o">${store.loc[a.tag]}</output></div><input id="${id}" type="range" min="0" max="${a.values.length - 1}" step="1" value="${a.values.indexOf(store.loc[a.tag])}">`;
    const r = w.querySelector("input")!;
    r.addEventListener("input", () => {
      w.querySelector("output")!.textContent = String(a.values[+r.value]);
    });
    r.addEventListener("change", () => {
      store.loc[a.tag] = a.values[+r.value];
      app.loadFont();
    });
    box.appendChild(w);
  }
  app.syncProjectControls();
}

/** Reserved Font Names of the current font: from the bundled list, or read from the font's licence. */
function reservedNames(): string[] {
  const f = famInfo();
  const out = f.rfn ? [f.rfn] : [];
  if (state.font) for (const r of checkLicence(state.font.names).reserved) if (!out.includes(r)) out.push(r);
  return out;
}

export function exportNaming(): FontNaming {
  return { family: $input("#famName").value.trim(), style: $input("#styleName").value.trim() || "Regular" };
}

/**
 * Validates the export name: it must not be empty, must be plain ASCII, must not contain the
 * font's Reserved Font Names, and must differ from the original family name. Disables Export when it fails.
 */
export function checkName(): boolean {
  const { family: v, style } = exportNaming();
  const f = famInfo();
  const note = $("#nameNote");
  let msg = "";
  let bad = false;
  const orig = ((state.font && (state.font.names[16] || state.font.names[1])) || f.name || "").trim();
  const reserved = usesReservedName(v, reservedNames());
  if (!v) {
    msg = "Give your font a name.";
    bad = true;
  } else if (!/^[\x20-\x7e]+$/.test(v + style)) {
    msg = "Use plain letters, numbers and spaces, so every app can show the name.";
    bad = true;
  } else if (reserved) {
    msg = `The licence reserves the name "${reserved}". Pick another.`;
    bad = true;
  } else if (orig && v.toLowerCase().includes(orig.toLowerCase())) {
    msg = `Use a name that isn't "${orig}".`;
    bad = true;
  } else msg = `Saves as ${psName(v, style)}.ttf`;
  note.textContent = msg;
  note.classList.toggle("warn", bad);
  $<HTMLButtonElement>("#export").disabled = bad;
  return !bad;
}

/** Adds a font of the user's own after checking it can be read and that its licence allows changes. */
function addOwnFont(app: App, buf: ArrayBuffer, path: string | null, fallbackName: string): void {
  let test;
  try {
    test = parseFont(buf);
  } catch (err) {
    toast((err as Error).message);
    return;
  }
  const lic = checkLicence(test.names);
  if (!lic.ok) {
    toast(lic.summary);
    return;
  }
  const key = UPLOAD_PREFIX + (path || fallbackName);
  const name = `${test.names[16] || test.names[1] || fallbackName} ${test.names[17] || test.names[2] || ""}`.trim();
  const fam: Family = { name, axes: [], default: {}, buf, rfn: null, path };
  state.uploads[key] = fam;
  state.store.slug = key;
  clearHistory();
  app.renderToolbar();
  app.loadFont();
}

export function bindToolbar(app: App): void {
  const { store } = state;

  // Installed fonts: read a little of every .ttf, so do it once, after the panel has drawn.
  if (nodeRequire()) {
    setTimeout(() => {
      try {
        installed = installedOpenFonts();
        app.renderToolbar();
      } catch {
        installed = [];
      }
    }, 200);
  }

  $<HTMLSelectElement>("#fontSel").addEventListener("change", async (e) => {
    const sel = e.target as HTMLSelectElement;
    const v = sel.value;
    if (v === UPLOAD_OPTION) {
      sel.value = store.slug;
      const path = chooseFontFile();
      if (path) {
        try {
          addOwnFont(app, await readFontBytes({ path, url: null }), path, path.split(/[\\/]/).pop()!);
        } catch (err) {
          toast((err as Error).message);
        }
      } else if (!nodeRequire()) $input("#upFile").click();
      return;
    }
    if (v.startsWith(INSTALLED_PREFIX)) {
      const path = v.slice(INSTALLED_PREFIX.length);
      sel.value = store.slug;
      try {
        addOwnFont(app, await readFontBytes({ path, url: null }), path, path.split(/[\\/]/).pop()!);
      } catch (err) {
        toast((err as Error).message);
      }
      return;
    }
    store.slug = v;
    clearHistory();
    app.renderToolbar();
    app.loadFont();
  });

  $input("#upFile").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) addOwnFont(app, await file.arrayBuffer(), null, file.name);
  });

  // One undo step per drag of a slider.
  let pushed = false;
  const once = () => {
    if (!pushed) {
      pushUndo();
      pushed = true;
    }
  };
  const done = () => {
    pushed = false;
  };

  $input("#track").addEventListener("input", (e) => {
    once();
    const p = proj();
    p.tracking = +(e.target as HTMLInputElement).value;
    $("#trackOut").textContent = String(p.tracking);
    app.renderEditor();
    scheduleLive();
    persist();
  });
  $input("#track").addEventListener("change", done);

  for (const { key } of HEIGHTS) {
    const r = $input("#h_" + key);
    r.addEventListener("input", () => {
      once();
      const p = proj();
      p.heights = { ...(p.heights || {}), [key]: +r.value };
      syncHeights();
      app.renderAll();
      scheduleLive();
      persist();
    });
    r.addEventListener("change", () => {
      done();
      app.changed();
    });
  }
  $("#resetHeights").onclick = () => {
    pushUndo();
    delete proj().heights;
    syncHeights();
    app.changed();
  };

  $input("#famName").addEventListener("input", () => {
    proj().family = $input("#famName").value;
    checkName();
    persist();
  });
  $input("#styleName").addEventListener("input", () => {
    proj().style = $input("#styleName").value;
    checkName();
    persist();
  });
}

export { HEIGHTS };
