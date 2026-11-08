/**
 * The bridge between the panel and Illustrator. Inside Illustrator, CEP gives the page
 * window.__adobe_cep__ (to run host.jsx functions), window.cep (file dialogs) and Node's require
 * (to read font files). In a normal browser none of these exist, and the panel says so.
 */

interface CepBridge {
  evalScript(script: string, cb?: (result: string) => void): void;
  getSystemPath(kind: string): string;
}

interface CepFs {
  showOpenDialogEx(multi: boolean, dirs: boolean, title: string, initial: string, types: string[]): { err: number; data: string[] };
}

declare global {
  interface Window {
    __adobe_cep__?: CepBridge;
    cep?: { fs: CepFs };
    cep_node?: { require: NodeRequire };
  }
}

export const inIllustrator = (): boolean => !!window.__adobe_cep__;

/** Runs ExtendScript in Illustrator. Resolves with the "ok:" payload or rejects with the "error:" message. */
export function runHost(script: string): Promise<string> {
  const cep = window.__adobe_cep__;
  if (!cep) return Promise.reject(new Error("Open this panel inside Illustrator (Window > Extensions > FontBuilder) to use the canvas."));
  return new Promise((resolve, reject) => {
    cep.evalScript(script, (r) => {
      if (r === "EvalScript error.") reject(new Error("Illustrator couldn't run FontBuilder's script. Try closing and reopening the panel."));
      else if (r.startsWith("error:")) reject(new Error(r.slice(6)));
      else resolve(r.startsWith("ok:") ? r.slice(3) : r);
    });
  });
}

/** Node's require, when the panel runs inside Illustrator with Node enabled. */
export function nodeRequire(): NodeRequire | null {
  const w = window as unknown as { cep_node?: { require: NodeRequire }; require?: NodeRequire };
  return w.cep_node?.require || (typeof w.require === "function" ? w.require : null);
}

/** Turns a file:// URL (as CEP returns paths) into a plain path for Node. */
export function fileUrlToPath(u: string): string {
  let p = decodeURI(u).replace(/^file:\/\//, "");
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // file:///C:/... on Windows
  return p;
}

/** The folder FontBuilder is installed in. */
export function extensionPath(): string | null {
  const cep = window.__adobe_cep__;
  return cep ? fileUrlToPath(cep.getSystemPath("extension")) : null;
}

/** Shows Illustrator's open-file dialog for fonts. Null when cancelled or not available. */
export function chooseFontFile(): string | null {
  const fs = window.cep?.fs;
  if (!fs) return null;
  const r = fs.showOpenDialogEx(false, false, "Choose a TrueType font (.ttf)", "", ["ttf"]);
  return r.err === 0 && r.data?.length ? r.data[0] : null;
}
