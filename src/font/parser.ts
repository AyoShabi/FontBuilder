import type { CompositeGlyph, Component, Font, Glyph, Matrix } from "./types";

function tag4(dv: DataView, o: number): string {
  return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
}

const REQUIRED = ["head", "maxp", "hhea", "hmtx", "loca", "glyf", "cmap", "name"];

/** Parses a TrueType (.ttf) font. Throws an Error with a user-facing message if it can't be edited. */
export function parseFont(buf: ArrayBuffer): Font {
  const dv = new DataView(buf);
  const sig = dv.getUint32(0);
  if (sig === 0x4f54544f) throw new Error("This font uses PostScript (CFF) outlines. Upload a TrueType .ttf instead.");
  if (sig === 0x774f4646 || sig === 0x774f4632) throw new Error("This is a web font (WOFF). Upload the .ttf version instead.");

  const n = dv.getUint16(4);
  const tables: Record<string, { off: number; len: number }> = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[tag4(dv, o)] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  for (const t of REQUIRED) {
    if (!tables[t]) throw new Error("This font has no " + t + " table, so it can't be edited here. Use a TrueType .ttf.");
  }
  const raw = (t: string) => new Uint8Array(buf, tables[t].off, tables[t].len).slice();

  const head = tables.head.off;
  const upm = dv.getUint16(head + 18);
  const locFmt = dv.getInt16(head + 50);
  const N = dv.getUint16(tables.maxp.off + 4);
  const hh = tables.hhea.off;
  const asc = dv.getInt16(hh + 4);
  const desc = dv.getInt16(hh + 6);
  const nHM = dv.getUint16(hh + 34);

  const adv: number[] = [];
  const lsb: number[] = [];
  let p = tables.hmtx.off;
  let last = 0;
  for (let g = 0; g < N; g++) {
    if (g < nHM) {
      adv[g] = last = dv.getUint16(p);
      lsb[g] = dv.getInt16(p + 2);
      p += 4;
    } else {
      adv[g] = last;
      lsb[g] = dv.getInt16(p);
      p += 2;
    }
  }

  const lo = tables.loca.off;
  const loca: number[] = [];
  for (let g = 0; g <= N; g++) loca.push(locFmt ? dv.getUint32(lo + g * 4) : dv.getUint16(lo + g * 2) * 2);

  const glyphs: Glyph[] = [];
  for (let g = 0; g < N; g++) glyphs.push(parseGlyph(dv, buf, tables.glyf.off + loca[g], loca[g + 1] - loca[g]));

  const cmap = parseCmap(dv, tables.cmap.off);

  let xh = 0;
  let cap = 0;
  const os2 = tables["OS/2"];
  if (os2 && dv.getUint16(os2.off) >= 2) {
    xh = dv.getInt16(os2.off + 86);
    cap = dv.getInt16(os2.off + 88);
  }
  const names = parseName(dv, tables.name.off);
  const keep: Record<string, Uint8Array> = {};
  for (const t in tables) keep[t] = raw(t);

  const f: Font = { upm, asc, desc, N, adv, lsb, glyphs, cmap, xh, cap, names, tables: keep, rev: new Map() };
  for (const [c, g] of cmap) if (!f.rev.has(g)) f.rev.set(g, c);

  const yMax = (g: number) => {
    const G = glyphs[g];
    return G && G.type === "simple" && G.pts.length ? Math.max(...G.pts.map((q) => q.y)) : 0;
  };
  if (!xh && cmap.get(120)) f.xh = yMax(cmap.get(120)!);
  if (!cap && cmap.get(72)) f.cap = yMax(cmap.get(72)!);
  return f;
}

export function parseGlyph(dv: DataView, buf: ArrayBuffer, o: number, len: number): Glyph {
  if (len <= 0) return { type: "empty" };
  const nc = dv.getInt16(o);

  if (nc >= 0) {
    let p = o + 10;
    const ends: number[] = [];
    for (let i = 0; i < nc; i++) {
      ends.push(dv.getUint16(p));
      p += 2;
    }
    const np = nc ? ends[nc - 1] + 1 : 0;
    const il = dv.getUint16(p);
    p += 2 + il;

    const fl: number[] = [];
    while (fl.length < np) {
      const f = dv.getUint8(p++);
      fl.push(f);
      if (f & 8) {
        let r = dv.getUint8(p++);
        while (r--) fl.push(f);
      }
    }
    const xs: number[] = [];
    const ys: number[] = [];
    let v = 0;
    for (const f of fl) {
      if (f & 2) {
        const d = dv.getUint8(p++);
        v += f & 16 ? d : -d;
      } else if (!(f & 16)) {
        v += dv.getInt16(p);
        p += 2;
      }
      xs.push(v);
    }
    v = 0;
    for (const f of fl) {
      if (f & 4) {
        const d = dv.getUint8(p++);
        v += f & 32 ? d : -d;
      } else if (!(f & 32)) {
        v += dv.getInt16(p);
        p += 2;
      }
      ys.push(v);
    }
    return { type: "simple", ends, pts: fl.map((f, i) => ({ x: xs[i], y: ys[i], on: !!(f & 1) })) };
  }

  return parseComposite(dv, buf, o);
}

function parseComposite(dv: DataView, buf: ArrayBuffer, o: number): CompositeGlyph {
  let p = o + 10;
  const comps: Component[] = [];
  const flagOffs: number[] = [];
  let f: number;
  do {
    f = dv.getUint16(p);
    flagOffs.push(p - o);
    const gi = dv.getUint16(p + 2);
    p += 4;
    let a: number;
    let b: number;
    if (f & 1) {
      a = dv.getInt16(p);
      b = dv.getInt16(p + 2);
      p += 4;
    } else {
      a = dv.getInt8(p);
      b = dv.getInt8(p + 1);
      p += 2;
    }
    let m: Matrix = [1, 0, 0, 1];
    if (f & 8) {
      const s = dv.getInt16(p) / 16384;
      m = [s, 0, 0, s];
      p += 2;
    } else if (f & 0x40) {
      m = [dv.getInt16(p) / 16384, 0, 0, dv.getInt16(p + 2) / 16384];
      p += 4;
    } else if (f & 0x80) {
      m = [dv.getInt16(p) / 16384, dv.getInt16(p + 2) / 16384, dv.getInt16(p + 4) / 16384, dv.getInt16(p + 6) / 16384];
      p += 8;
    }
    comps.push({ gi, dx: f & 2 ? a : 0, dy: f & 2 ? b : 0, m });
  } while (f & 0x20);

  const raw = new Uint8Array(buf, o, p - o).slice();
  const rv = new DataView(raw.buffer);
  for (const fo of flagOffs) rv.setUint16(fo, rv.getUint16(fo) & ~0x100); // drop hinting instructions
  return { type: "composite", comps, raw };
}

/** Picks the best Unicode subtable (format 12 over 4, Windows/Unicode platforms preferred). */
export function parseCmap(dv: DataView, o: number): Map<number, number> {
  const n = dv.getUint16(o + 2);
  let best: number | null = null;
  let score = -1;
  for (let i = 0; i < n; i++) {
    const pid = dv.getUint16(o + 4 + i * 8);
    const off = dv.getUint32(o + 8 + i * 8);
    const fmt = dv.getUint16(o + off);
    let s = fmt === 12 ? 2 : fmt === 4 ? 1 : -9;
    if (pid === 3 || pid === 0) s += 0.5;
    if (s > score) {
      score = s;
      best = o + off;
    }
  }
  const map = new Map<number, number>();
  if (best == null) return map;
  const fmt = dv.getUint16(best);

  if (fmt === 4) {
    const sx2 = dv.getUint16(best + 6);
    const E = best + 14;
    const S = E + sx2 + 2;
    const D = S + sx2;
    const R = D + sx2;
    for (let s = 0; s < sx2 / 2; s++) {
      const e = dv.getUint16(E + s * 2);
      const st = dv.getUint16(S + s * 2);
      const d = dv.getInt16(D + s * 2);
      const ro = dv.getUint16(R + s * 2);
      for (let c = st; c <= e && c !== 0xffff; c++) {
        let g: number;
        if (!ro) g = (c + d) & 0xffff;
        else {
          g = dv.getUint16(R + s * 2 + ro + (c - st) * 2);
          if (g) g = (g + d) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (fmt === 12) {
    const ng = dv.getUint32(best + 12);
    for (let i = 0; i < ng; i++) {
      const q = best + 16 + i * 12;
      const sc = dv.getUint32(q);
      const ec = dv.getUint32(q + 4);
      const sg = dv.getUint32(q + 8);
      for (let c = sc; c <= ec && c - sc < 70000; c++) map.set(c, sg + c - sc);
    }
  }
  return map;
}

/** Reads Windows-platform (UTF-16BE) name records, first one per name id. */
export function parseName(dv: DataView, o: number): Record<number, string> {
  const cnt = dv.getUint16(o + 2);
  const so = o + dv.getUint16(o + 4);
  const out: Record<number, string> = {};
  for (let i = 0; i < cnt; i++) {
    const r = o + 6 + i * 12;
    const pid = dv.getUint16(r);
    const id = dv.getUint16(r + 6);
    const len = dv.getUint16(r + 8);
    const off = dv.getUint16(r + 10);
    if (pid === 3 && !(id in out)) {
      let s = "";
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(so + off + k));
      out[id] = s;
    }
  }
  return out;
}
