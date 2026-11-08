import type { BBox, Point } from "./types";

export function bbox(pts: { x: number; y: number }[]): BBox | null {
  if (!pts.length) return null;
  const a: BBox = [1e9, 1e9, -1e9, -1e9];
  for (const q of pts) {
    if (q.x < a[0]) a[0] = q.x;
    if (q.y < a[1]) a[1] = q.y;
    if (q.x > a[2]) a[2] = q.x;
    if (q.y > a[3]) a[3] = q.y;
  }
  return a;
}

/** SVG path data for one TrueType contour, with y flipped for screen coordinates. */
export function contourD(c: Point[]): string {
  const n = c.length;
  if (n < 2) return "";
  const i0 = c.findIndex((q) => q.on);
  let seq: Point[];
  let start: Point;
  if (i0 < 0) {
    start = { x: (c[n - 1].x + c[0].x) / 2, y: (c[n - 1].y + c[0].y) / 2, on: true };
    seq = [...c, start];
  } else {
    start = c[i0];
    seq = [...c.slice(i0 + 1), ...c.slice(0, i0 + 1)];
  }
  let d = `M${start.x} ${-start.y}`;
  let ctrl: Point | null = null;
  for (const q of seq) {
    if (q.on) {
      d += ctrl ? `Q${ctrl.x} ${-ctrl.y} ${q.x} ${-q.y}` : `L${q.x} ${-q.y}`;
      ctrl = null;
    } else {
      if (ctrl) d += `Q${ctrl.x} ${-ctrl.y} ${(ctrl.x + q.x) / 2} ${-(ctrl.y + q.y) / 2}`;
      ctrl = q;
    }
  }
  return d + "Z";
}
