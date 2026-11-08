/**
 * Illustrator keeps keyboard shortcuts for itself, even while the panel has focus. This asks it to
 * pass the editor's keys to the panel instead: tool letters, Space for the hand, zoom, undo/redo,
 * select all, Outline/Preview, arrows and Delete, with any mix of Ctrl, Shift and Alt.
 */
export const PANEL_KEYS = [
  8, 27, 32, 37, 38, 39, 40, 46, // Backspace Esc Space arrows Delete
  48, 96, // 0 and numpad 0 (Ctrl+0 fits the letter)
  187, 107, 189, 109, 61, 173, // = + - on the main keys and the numpad (and Firefox-style codes)
  65, 67, 80, 86, 89, 90, // A C P V Y Z
];

export function keyInterest(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const keyCode of PANEL_KEYS)
    for (let m = 0; m < 16; m++) {
      const k: Record<string, unknown> = { keyCode };
      if (m & 1) k.ctrlKey = true;
      if (m & 2) k.shiftKey = true;
      if (m & 4) k.altKey = true;
      if (m & 8) k.metaKey = true;
      out.push(k);
    }
  return out;
}

export function registerKeys(): void {
  const cep = window.__adobe_cep__ as unknown as { registerKeyEventsInterest?: (json: string) => void } | undefined;
  if (!cep?.registerKeyEventsInterest) return;
  try {
    cep.registerKeyEventsInterest(JSON.stringify(keyInterest()));
  } catch {
    // Older hosts: the keys stay with Illustrator; the panel's buttons still work.
  }
}
