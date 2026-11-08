/** Typed querySelector for elements that the page always contains. */
export function $<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error("Missing element " + sel);
  return el;
}

export const $input = (sel: string) => $<HTMLInputElement>(sel);

let toastT = 0;
export function toast(msg: string): void {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = window.setTimeout(() => (t.hidden = true), 3200);
}

export const escapeHtml = (s: string) => s.replace(/[<&]/g, (m) => (m === "<" ? "&lt;" : "&amp;"));

export const hex4 = (c: number) => "U+" + c.toString(16).toUpperCase().padStart(4, "0");
