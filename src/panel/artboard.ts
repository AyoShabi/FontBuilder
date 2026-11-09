/**
 * Live preview on the artboard: text frames picked in Illustrator are drawn in the edited font as
 * shapes, redrawn after every edit. Illustrator can't reload a changed font while it runs, so
 * this is how edits show up in real layouts before the font is exported and installed.
 */
import { advOf, contours, type Project } from "../editor/project";
import { outputCmap } from "../editor/charset";
import type { Font } from "../font/types";
import { contourToAnchors } from "./curves";
import { hostCall } from "./script";

/** A previewed text frame, as host.jsx describes it. Sizes in points, position in document coordinates. */
export interface PreviewFrame {
  id: string;
  text: string;
  size: number;
  leading: number;
  /** Illustrator tracking, in thousandths of an em. */
  tracking: number;
  x: number;
  y: number;
  just: "left" | "center" | "right";
  area: boolean;
}

/** One anchor: [x, y, in-handle x, y, out-handle x, y]. */
export type HostAnchor = [number, number, number, number, number, number];

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The text of one frame set in the edited font, as paths in document coordinates. */
export function setFrame(f: Font, p: Project, fr: PreviewFrame): HostAnchor[][] {
  const s = fr.size / f.upm;
  const track = (fr.tracking / 1000) * fr.size;
  const out: HostAnchor[][] = [];
  const cmap = outputCmap(f, p);
  const lines = fr.text.split(/[\r\n\u0003]/);
  lines.forEach((line, li) => {
    const chars = [...line];
    const gids = chars.map((ch) => cmap.get(ch.codePointAt(0)!) ?? 0);
    const width = gids.reduce((w, g) => w + advOf(f, g, p) * s + track, 0) - (gids.length ? track : 0);
    let x = fr.x - (fr.just === "center" ? width / 2 : fr.just === "right" ? width : 0);
    const y = fr.y - li * fr.leading;
    for (const g of gids) {
      for (const c of contours(f, g, p)) {
        const a = contourToAnchors(c);
        if (a.length < 2) continue;
        out.push(a.map((q) => [r2(x + q.x * s), r2(y + q.y * s), r2(x + q.ix * s), r2(y + q.iy * s), r2(x + q.ox * s), r2(y + q.oy * s)]));
      }
      x += advOf(f, g, p) * s + track;
    }
  });
  return out;
}

/** The host call that redraws every previewed frame. */
export function drawCall(f: Font, p: Project, frames: PreviewFrame[]): string {
  return hostCall("fbPreviewDraw", frames.map((fr) => ({ id: fr.id, paths: setFrame(f, p, fr) })));
}
