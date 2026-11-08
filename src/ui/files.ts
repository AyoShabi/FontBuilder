/** Export, and project save/open. */
import { buildFont, psName } from "../font/writer";
import { clearHistory } from "../editor/history";
import { outlineSource, type Project } from "../editor/project";
import { MANIFEST, famInfo, fontFile, isUpload, proj, state } from "../editor/state";
import { nodeRequire } from "../panel/cep";
import type { App } from "./app";
import { $, $input, toast } from "./dom";
import { checkName, exportNaming } from "./toolbar";

const PROJECT_APP_ID = "fontbuilder";

interface ProjectFile {
  app: typeof PROJECT_APP_ID;
  version: 1;
  slug: string;
  loc: Record<string, number>;
  project: Project;
}

interface SaveDialog {
  showSaveDialogEx(title: string, initialPath: string, types: string[], name: string): { err: number; data: string };
}

/**
 * Saves a file. Inside Illustrator: asks where with the system save dialog and writes it with
 * Node, returning the path. In a browser preview: a plain download. Null when cancelled.
 */
function offer(filename: string, data: string | Uint8Array, types: string[]): string | null {
  const req = nodeRequire();
  const dlg = (window.cep?.fs as unknown as SaveDialog | undefined) ?? null;
  if (req && dlg) {
    const r = dlg.showSaveDialogEx("Save", "", types, filename);
    if (r.err !== 0 || !r.data) return null;
    const ext = filename.slice(filename.lastIndexOf("."));
    const file = r.data.toLowerCase().endsWith(ext) ? r.data : r.data + ext;
    const fs = req("fs") as typeof import("fs");
    const { Buffer } = req("buffer") as typeof import("buffer");
    fs.writeFileSync(file, typeof data === "string" ? data : Buffer.from(data));
    return file;
  }
  const blob = new Blob([data as BlobPart]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return filename;
}

/** The licence text of the current font: its licence file if there is one, else what the font itself says. */
function licenceText(): string {
  const f = famInfo();
  const req = nodeRequire();
  if (req) {
    const fs = req("fs") as typeof import("fs");
    const path = req("path") as typeof import("path");
    const dirs: string[] = [];
    if (!isUpload(state.store.slug)) {
      const p = fontFile(f.slug!, "OFL.txt").path;
      if (p) dirs.push(path.dirname(p));
    } else if (f.path) dirs.push(path.dirname(f.path));
    for (const d of dirs) {
      for (const n of ["OFL.txt", "LICENSE.txt", "LICENSE", "OFL"]) {
        try {
          return fs.readFileSync(path.join(d, n), "utf8");
        } catch {
          // Try the next name.
        }
      }
    }
  }
  const n = state.font?.names || {};
  return [n[0], "", n[13], n[14]].filter((x) => x != null).join("\n");
}

export function bindFiles(app: App): void {
  const { store } = state;

  $("#export").onclick = () => {
    const font = state.font;
    if (!font || !checkName()) return;
    const naming = exportNaming();
    const p = proj();
    const name = psName(naming.family, naming.style);
    try {
      const file = offer(name + ".ttf", buildFont(font, naming, outlineSource(font, p)), ["ttf"]);
      if (!file) return;
      // The licence has to travel with the font, so it's saved next to it.
      if (file !== name + ".ttf") {
        const fs = nodeRequire()!("fs") as typeof import("fs");
        fs.writeFileSync(file.replace(/\.ttf$/i, "-LICENSE.txt"), licenceText());
        toast("Saved. Right-click the .ttf and choose Install to use it. Keep the licence file with it.");
      } else {
        offer(name + "-LICENSE.txt", licenceText(), ["txt"]);
        toast("Saved " + file);
      }
    } catch (e) {
      toast("Couldn't save the font: " + (e as Error).message);
    }
  };

  $("#saveProj").onclick = () => {
    const p = proj();
    const file: ProjectFile = { app: PROJECT_APP_ID, version: 1, slug: store.slug, loc: store.loc, project: p };
    const saved = offer(`${psName(p.family, p.style).replace(/-Regular$/, "")}-project.json`, JSON.stringify(file, null, 1), ["json"]);
    if (saved) toast("Project saved");
  };

  $("#openProj").onclick = () => $input("#projFile").click();

  $input("#projFile").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const j = JSON.parse(await file.text()) as ProjectFile;
      if (j.app !== PROJECT_APP_ID) throw new Error("not a project");
      if (!MANIFEST.some((f) => f.slug === j.slug) && !state.uploads[j.slug]) {
        toast("That project uses a font of your own. Choose the same font first, then open the project.");
        return;
      }
      store.slug = j.slug;
      store.loc = j.loc || {};
      store.projects[j.slug] = j.project;
      clearHistory();
      app.renderToolbar();
      app.loadFont();
      toast("Project opened");
    } catch {
      toast("That file isn't a FontBuilder project.");
    }
  });
}
