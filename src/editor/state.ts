import manifest from "../manifest.json";
import { extensionPath } from "../panel/cep";
import type { Font } from "../font/types";
import { allGroups, type GlyphGroup, type ZoneKey } from "./groups";
import { newProject, type GlyphEdit, type Project } from "./project";

export interface Axis {
  tag: string;
  values: number[];
}

/** A font family the user can pick: one of the built-in OFL families, or an uploaded .ttf. */
export interface Family {
  slug?: string;
  name: string;
  axes: Axis[];
  default: Record<string, number>;
  /** OFL Reserved Font Name, which an exported font must not use. */
  rfn: string | null;
  /** Copyright notice of the source font (written by build.py). */
  copyright?: string;
  /** Bytes of an uploaded font. */
  buf?: ArrayBuffer;
  /** Where an uploaded or installed font came from, so its licence file can be found. */
  path?: string | null;
}

export const MANIFEST = manifest as unknown as Family[];
export const AXIS_LABEL: Record<string, string> = { wght: "Weight", wdth: "Width", XROT: "Tilt across", YROT: "Tilt up" };
/** Letters shown first in the glyph list: the key letters and the test word. */
export const SIGNATURE = [..."noHOhamburgefstiv"];

/** What persists in localStorage. Projects for uploaded fonts are left out because the font bytes aren't stored. */
export interface Store {
  slug: string;
  loc: Record<string, number>;
  projects: Record<string, Project>;
  /** Selected glyph id per family. */
  sel: Record<string, number>;
}

const LS = "fontbuilder-v1";
export const UPLOAD_PREFIX = "upload:";

function loadStore(): Store {
  let store: Store = { slug: "anybody", loc: {}, projects: {}, sel: {} };
  try {
    const s = JSON.parse(localStorage.getItem(LS) || "null");
    if (s && s.projects) store = Object.assign(store, s);
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return store;
}

export type Tool = "select" | "add" | "pen" | "remove" | "bend" | "rect" | "ellipse";

export const state = {
  store: loadStore(),
  font: null as Font | null,
  uploads: {} as Record<string, Family>,
  /** Selected point indices in the current glyph. */
  selPts: new Set<number>(),
  /** Id of the glyph group that edits are linked across, if any. */
  link: null as string | null,
  /** The zone picked in the inspector. Linked reshapes use it while the selection is that zone. */
  zone: null as ZoneKey | null,
  /** Editor tool: "select" moves points, "add" puts new points on the outline, "pen" also draws new shapes in empty space, "remove" deletes the point clicked, "bend" curves a straight line. */
  tool: "select" as Tool,
};

/** Where a file in extension/fonts/<slug>/ is: a path on disk inside Illustrator, a URL in a browser preview. */
export function fontFile(slug: string, file: string): { path: string | null; url: string | null } {
  const ext = extensionPath();
  return ext ? { path: `${ext}/fonts/${slug}/${file}`, url: null } : { path: null, url: `fonts/${slug}/${file}` };
}

export const isUpload = (slug: string) => slug.startsWith(UPLOAD_PREFIX);

/** The current family's project, created on first use. */
export function proj(): Project {
  const { store } = state;
  return store.projects[store.slug] || (store.projects[store.slug] = newProject());
}

export function famInfo(): Family {
  const { store } = state;
  return MANIFEST.find((f) => f.slug === store.slug) || state.uploads[store.slug];
}

/** The loaded font. Only call once a font has loaded. */
export function font(): Font {
  if (!state.font) throw new Error("No font loaded");
  return state.font;
}

export const currentGid = () => state.store.sel[state.store.slug];
export const setCurrentGid = (gid: number) => {
  state.store.sel[state.store.slug] = gid;
};

/** A glyph's edit record (the current glyph's by default), created on first use. */
export function glyphEdit(g = currentGid()): GlyphEdit {
  const p = proj();
  return p.edits[g] || (p.edits[g] = {});
}

/** The linked group, if one is picked and still exists. */
export function linkedGroup(): GlyphGroup | null {
  if (!state.link || !state.font) return null;
  return allGroups(state.font, proj()).find((g) => g.id === state.link) || null;
}

/**
 * Glyphs a linked edit applies to: the whole linked group when the current glyph is in it,
 * otherwise just the current glyph.
 */
export function linkedGids(): number[] {
  const cur = currentGid();
  const g = linkedGroup();
  return g && g.gids.includes(cur) ? g.gids : [cur];
}

let saveT = 0;
export function persist(): void {
  clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    try {
      const { store } = state;
      const s: Store = { ...store, projects: {} };
      for (const k in store.projects) if (!isUpload(k)) s.projects[k] = store.projects[k];
      localStorage.setItem(LS, JSON.stringify(s));
    } catch {
      /* storage full or blocked */
    }
  }, 300);
}
