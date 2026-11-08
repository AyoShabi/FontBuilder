/**
 * Finds fonts to start from: the open-licence fonts that ship with FontBuilder, and TrueType
 * fonts installed on the computer whose licence allows changes. Installed fonts are checked by
 * reading only their name table, so scanning a big font folder stays quick.
 */
import { parseName } from "../font/parser";
import { checkLicence, type LicenceInfo } from "../licence";
import { extensionPath, nodeRequire } from "./cep";

export interface FontEntry {
  id: string;
  label: string;
  family: string;
  style: string;
  /** Where to read it: a file path inside Illustrator, or a URL in a browser. */
  path: string | null;
  url: string | null;
  bundled: boolean;
}

export const BUNDLED: { dir: string; family: string }[] = [
  { dir: "anybody", family: "Anybody" },
  { dir: "bigshoulders", family: "Big Shoulders Display" },
  { dir: "gasoek", family: "Gasoek One" },
  { dir: "monasans", family: "Mona Sans" },
  { dir: "sofia", family: "Sofia Sans Extra Condensed" },
  { dir: "tiltwarp", family: "Tilt Warp" },
];

export function bundledFonts(): FontEntry[] {
  const ext = extensionPath();
  return BUNDLED.map((b) => ({
    id: "bundled:" + b.dir,
    label: b.family,
    family: b.family,
    style: "Regular",
    path: ext ? `${ext}/fonts/${b.dir}/regular.ttf` : null,
    url: ext ? null : `fonts/${b.dir}/regular.ttf`,
    bundled: true,
  }));
}

/** Reads a font file's bytes, from disk inside Illustrator or over HTTP in a browser preview. */
export async function readFontBytes(e: { path: string | null; url: string | null }): Promise<ArrayBuffer> {
  const req = nodeRequire();
  if (e.path && req) {
    const fs = req("fs") as typeof import("fs");
    const b = fs.readFileSync(e.path);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  if (e.url) {
    const r = await fetch(e.url);
    if (!r.ok) throw new Error("Couldn't load " + e.url);
    return r.arrayBuffer();
  }
  throw new Error("Can't read font files here. Open this panel inside Illustrator.");
}

/** Licence and names from just the name table of a font file's bytes. Null if it isn't a TrueType font. */
export function quickInfo(head: ArrayBuffer, readTable: (off: number, len: number) => ArrayBuffer): { names: Record<number, string>; licence: LicenceInfo } | null {
  const dv = new DataView(head);
  if (dv.byteLength < 12 || dv.getUint32(0) !== 0x00010000) return null;
  const n = dv.getUint16(4);
  for (let i = 0; i < n && 12 + i * 16 + 16 <= dv.byteLength; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    if (tag === "name") {
      const names = parseName(new DataView(readTable(dv.getUint32(o + 8), dv.getUint32(o + 12))), 0);
      return { names, licence: checkLicence(names) };
    }
  }
  return null;
}

/** Folders where Windows and macOS keep installed fonts. */
function fontDirs(): string[] {
  const req = nodeRequire();
  if (!req) return [];
  const os = req("os") as typeof import("os");
  const path = req("path") as typeof import("path");
  const proc = req("process") as typeof import("process");
  const home = os.homedir();
  if (proc.platform === "win32") {
    return [path.join(proc.env.WINDIR || "C:\\Windows", "Fonts"), path.join(proc.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Microsoft", "Windows", "Fonts")];
  }
  return ["/Library/Fonts", path.join(home, "Library", "Fonts")];
}

/** Installed TrueType fonts whose licence lets FontBuilder change them. */
export function installedOpenFonts(): FontEntry[] {
  const req = nodeRequire();
  if (!req) return [];
  const fs = req("fs") as typeof import("fs");
  const path = req("path") as typeof import("path");
  const { Buffer } = req("buffer") as typeof import("buffer");
  const out: FontEntry[] = [];
  for (const dir of fontDirs()) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/\.ttf$/i.test(file)) continue;
      const p = path.join(dir, file);
      try {
        const info = fileInfo(fs, Buffer, p);
        if (!info || !info.licence.ok) continue;
        const family = info.names[16] || info.names[1] || file;
        const style = info.names[17] || info.names[2] || "Regular";
        out.push({ id: "file:" + p, label: `${family} ${style}`, family, style, path: p, url: null, bundled: false });
      } catch {
        // Unreadable or damaged files are skipped.
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function fileInfo(fs: typeof import("fs"), Buffer: typeof import("buffer").Buffer, p: string) {
  const fd = fs.openSync(p, "r");
  try {
    const read = (off: number, len: number) => {
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, off);
      return b.buffer.slice(b.byteOffset, b.byteOffset + len) as ArrayBuffer;
    };
    return quickInfo(read(0, 12 + 64 * 16), read);
  } finally {
    fs.closeSync(fd);
  }
}
