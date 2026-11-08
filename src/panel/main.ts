/**
 * The FontBuilder panel. Step 1 of the build: choose a starting font, check its licence, and lay
 * it out on a new Illustrator canvas, one artboard per letter, in the order you'll design them.
 */
import { parseFont } from "../font/parser";
import type { Font } from "../font/types";
import { layoutCanvas, type CanvasMeta } from "../canvas/layout";
import { hostCall } from "../canvas/script";
import { checkLicence, type LicenceInfo } from "../licence";
import { STAGES, stageChars } from "../stages";
import { chooseFontFile, inIllustrator, runHost } from "./cep";
import { bundledFonts, installedOpenFonts, readFontBytes, type FontEntry } from "./fonts";
import { escapeAttr, textSvg } from "./preview";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Loaded {
  entry: FontEntry;
  font: Font;
  licence: LicenceInfo;
}

let entries: FontEntry[] = [];
let loaded: Loaded | null = null;
let canvas: CanvasMeta | null = null;

function setStatus(msg: string, kind: "info" | "error" | "ok" = "info") {
  const el = $("status");
  el.textContent = msg;
  el.className = "status " + kind;
  el.hidden = !msg;
}

function fillFontList() {
  const sel = $<HTMLSelectElement>("font");
  const bundled = entries.filter((e) => e.bundled);
  const installed = entries.filter((e) => !e.bundled);
  const opt = (e: FontEntry) => `<option value="${escapeAttr(e.id)}">${escapeAttr(e.label)}</option>`;
  sel.innerHTML =
    `<option value="">Choose a font…</option>` +
    `<optgroup label="Comes with FontBuilder">${bundled.map(opt).join("")}</optgroup>` +
    (installed.length ? `<optgroup label="Installed on this computer (open licence)">${installed.map(opt).join("")}</optgroup>` : "");
  if (loaded) sel.value = loaded.entry.id;
}

async function loadEntry(e: FontEntry) {
  setStatus("Reading " + e.label + "…");
  try {
    const font = parseFont(await readFontBytes(e));
    loaded = { entry: e, font, licence: checkLicence(font.names) };
    setStatus("");
  } catch (err) {
    loaded = null;
    setStatus((err as Error).message, "error");
  }
  renderFont();
}

/**
 * Family and style for a loaded font. The bundled fonts are single styles cut from variable fonts,
 * and their name records still carry the variable font's default names, so use the list's names.
 */
function familyStyle(l: Loaded): { family: string; style: string } {
  const n = l.font.names;
  if (l.entry.bundled) return { family: l.entry.family, style: l.entry.style };
  return { family: n[16] || n[1] || l.entry.family, style: n[17] || n[2] || l.entry.style };
}

function renderFont() {
  const card = $("fontcard");
  const build = $("build");
  if (!loaded) {
    card.hidden = true;
    build.hidden = true;
    return;
  }
  const { font, licence } = loaded;
  card.hidden = false;
  $("preview").innerHTML = textSvg(font, "Hamburgefonstiv", 44) + textSvg(font, "HOHO nono 0123", 28);
  const fs = familyStyle(loaded);
  $("fontname").textContent = `${fs.family} ${fs.style}`;
  const lic = $("licence");
  lic.className = "licence " + (licence.ok ? "ok" : "blocked");
  lic.innerHTML =
    `<strong>${licence.ok ? "You can build on this font." : "FontBuilder can't edit this font."}</strong> ${escapeAttr(licence.summary)}` +
    (licence.reserved.length
      ? `<br><br>Its licence reserves the name${licence.reserved.length > 1 ? "s" : ""} ${licence.reserved.map((r) => `“${escapeAttr(r)}”`).join(", ")}, so your version's name can't include ${licence.reserved.length > 1 ? "them" : "it"}.`
      : "");
  build.hidden = !licence.ok;
  renderStageChoices();
}

function renderStageChoices() {
  if (!loaded) return;
  const f = loaded.font;
  $("stages").innerHTML = STAGES.map((s, i) => {
    const have = stageChars(i).filter((ch) => f.cmap.has(ch.codePointAt(0)!));
    return `<label class="check"><input type="checkbox" data-stage="${i}" checked ${have.length ? "" : "disabled"}>
      <span><strong>${i + 1}. ${escapeAttr(s.title)}</strong> <span class="muted">${have.length} letters</span></span></label>`;
  }).join("");
}

async function createCanvas() {
  if (!loaded || !loaded.licence.ok) return;
  const stages = [...document.querySelectorAll<HTMLInputElement>("#stages input:checked")].map((i) => +i.dataset.stage!);
  if (!stages.length) return setStatus("Tick at least one stage.", "error");
  const spec = layoutCanvas(loaded.font, { stages, source: { ...familyStyle(loaded), path: loaded.entry.path } });
  const btn = $<HTMLButtonElement>("create");
  btn.disabled = true;
  setStatus(`Drawing ${spec.cells.length} letters on a new canvas. This can take a minute…`);
  try {
    await runHost(hostCall("fbBuildCanvas", { ...spec, metaJson: JSON.stringify(spec.meta) }));
    canvas = spec.meta;
    setStatus(`Your canvas is ready: ${spec.cells.length} letters, one per artboard. Start with n, o, H and O.`, "ok");
    renderLetters();
  } catch (err) {
    setStatus((err as Error).message, "error");
  } finally {
    btn.disabled = false;
  }
}

/** The letters of the open canvas, by stage, as buttons that jump to each artboard. */
function renderLetters() {
  const box = $("letters");
  if (!canvas) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const have = new Map(canvas.glyphs.map((g) => [g.char, g.name]));
  $("letterlist").innerHTML = STAGES.map((s, i) => {
    const chars = stageChars(i).filter((ch) => have.has(ch));
    if (!chars.length) return "";
    return `<section class="stage"><h3>${i + 1}. ${escapeAttr(s.title)}</h3><p class="muted">${escapeAttr(s.goal)}</p>
      <div class="keys">${chars.map((ch) => `<button type="button" class="key" data-name="${escapeAttr(have.get(ch)!)}" title="Go to ${escapeAttr(ch)}">${escapeAttr(ch)}</button>`).join("")}</div></section>`;
  }).join("");
  $("canvasname").textContent = `${canvas.source.family} ${canvas.source.style}`;
}

async function checkOpenCanvas() {
  if (!inIllustrator()) return;
  try {
    const r = await runHost("fbReadMeta()");
    canvas = r === "none" ? null : (JSON.parse(r) as CanvasMeta);
  } catch {
    canvas = null;
  }
  renderLetters();
}

function wire() {
  $<HTMLSelectElement>("font").addEventListener("change", (ev) => {
    const e = entries.find((x) => x.id === (ev.target as HTMLSelectElement).value);
    if (e) loadEntry(e);
  });
  $("pick").addEventListener("click", () => {
    if (!inIllustrator()) return setStatus("Choosing a file works inside Illustrator. Here, pick one of the fonts that come with FontBuilder.", "error");
    const p = chooseFontFile();
    if (!p) return;
    const name = p.split(/[\\/]/).pop() || p;
    const e: FontEntry = { id: "file:" + p, label: name, family: name.replace(/\.ttf$/i, ""), style: "Regular", path: p, url: null, bundled: false };
    if (!entries.some((x) => x.id === e.id)) entries.push(e);
    fillFontList();
    loadEntry(e);
  });
  $("create").addEventListener("click", createCanvas);
  $("letterlist").addEventListener("click", async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button.key");
    if (!b) return;
    try {
      await runHost(hostCall("fbGoTo", b.dataset.name!));
    } catch (err) {
      setStatus((err as Error).message, "error");
    }
  });
  $("refresh").addEventListener("click", checkOpenCanvas);
}

function init() {
  entries = bundledFonts();
  fillFontList();
  wire();
  if (!inIllustrator()) {
    $("hostnote").hidden = false;
    return;
  }
  // Scanning installed fonts reads a little of every .ttf, so do it after the panel has drawn.
  setTimeout(() => {
    try {
      entries = [...bundledFonts(), ...installedOpenFonts()];
      fillFontList();
    } catch {
      // Keep the bundled list if the scan fails.
    }
  }, 50);
  checkOpenCanvas();
}

init();
