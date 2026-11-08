/** The "Preview on artboard" controls, and redrawing previewed text after edits. */
import { proj, state } from "../editor/state";
import { drawCall, type PreviewFrame } from "../panel/artboard";
import { inIllustrator, runHost } from "../panel/cep";
import { $, toast } from "./dom";

let frames: PreviewFrame[] = [];
let timer = 0;
let busy = false;
let again = false;

function renderStatus(): void {
  const n = frames.length;
  $("#abStatus").textContent = n
    ? `Showing your edits on ${n} text frame${n > 1 ? "s" : ""}: ${frames.map((f) => `“${f.text.replace(/[\r\n\u0003]+/g, " ").slice(0, 24)}”`).join(", ")}. Your original text is hidden until you stop.`
    : "Select text on your artboard, then click Preview selected text to see your edits on it as you work.";
  $<HTMLButtonElement>("#abStop").disabled = !n;
}

async function redraw(): Promise<void> {
  const f = state.font;
  if (!f || !frames.length) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    await runHost(drawCall(f, proj(), frames));
  } catch (e) {
    toast((e as Error).message);
  }
  busy = false;
  if (again) {
    again = false;
    scheduleArtboard();
  }
}

/** Redraws previewed text shortly after the last edit (Illustrator is slow to draw, so edits are batched). */
export function scheduleArtboard(): void {
  if (!frames.length) return;
  clearTimeout(timer);
  timer = window.setTimeout(redraw, 400);
}

async function load(script: string): Promise<void> {
  const r = JSON.parse(await runHost(script)) as { frames: PreviewFrame[] };
  frames = r.frames;
  renderStatus();
  await redraw();
}

export function bindArtboard(): void {
  if (!inIllustrator()) {
    $("#abStatus").textContent = "Inside Illustrator, you can select text on your artboard and see your edits on it live.";
    ($("#abAdd") as HTMLButtonElement).disabled = true;
    ($("#abStop") as HTMLButtonElement).disabled = true;
    return;
  }
  $("#abAdd").onclick = () => load("fbPreviewAdd()").catch((e) => toast((e as Error).message));
  $("#abStop").onclick = async () => {
    try {
      await runHost("fbPreviewStop()");
      frames = [];
      renderStatus();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  renderStatus();
  // Pick up a preview left running in the open document.
  load("fbPreviewList()").catch(() => {});
}
