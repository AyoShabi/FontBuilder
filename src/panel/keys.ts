/**
 * Illustrator keeps most keyboard shortcuts for itself, even while the panel has focus. This asks
 * it to pass the editor's keys (arrows, Delete, Escape, the tool letters and undo/redo) to the panel.
 */
export function registerKeys(): void {
  const cep = window.__adobe_cep__ as unknown as { registerKeyEventsInterest?: (json: string) => void } | undefined;
  if (!cep?.registerKeyEventsInterest) return;
  const plain = [8, 27, 37, 38, 39, 40, 46, 67, 80, 86]; // Backspace Esc arrows Delete C P V
  const keys: Record<string, unknown>[] = [];
  for (const k of plain) keys.push({ keyCode: k }, { keyCode: k, shiftKey: true });
  for (const k of [65, 89, 90]) {
    // Ctrl/Cmd + A, Y, Z, and Shift+Z for redo.
    keys.push({ keyCode: k, ctrlKey: true }, { keyCode: k, metaKey: true }, { keyCode: k, ctrlKey: true, shiftKey: true }, { keyCode: k, metaKey: true, shiftKey: true });
  }
  try {
    cep.registerKeyEventsInterest(JSON.stringify(keys));
  } catch {
    // Older hosts: the keys stay with Illustrator; the panel's buttons still work.
  }
}
