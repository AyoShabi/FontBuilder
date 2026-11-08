import { contourD } from "../font/geometry";
import { glyphContours } from "../font/outline";
import type { Font } from "../font/types";

/** An SVG of a line of text set in the font, scaled to fit the given height in pixels. */
export function textSvg(f: Font, text: string, height: number): string {
  let x = 0;
  let d = "";
  for (const ch of text) {
    const gid = f.cmap.get(ch.codePointAt(0)!) ?? 0;
    for (const c of glyphContours(f, gid)) d += contourD(c.map((q) => ({ ...q, x: q.x + x })));
    x += f.adv[gid] || 0;
  }
  const top = f.asc;
  const h = f.asc - f.desc;
  const w = Math.max(1, x);
  const px = (height * w) / h;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-top} ${w} ${h}" width="${px.toFixed(0)}" height="${height}" role="img" aria-label="${escapeAttr(text)}"><path d="${d}" fill="currentColor"/></svg>`;
}

export function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
