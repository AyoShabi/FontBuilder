import { createApp } from "./ui/app";
import { bindFiles } from "./ui/files";
import { bindGrids } from "./ui/grids";
import { bindInspector } from "./ui/inspector";
import { bindStage } from "./ui/stage";
import { bindStages } from "./ui/stages";
import { bindToolbar } from "./ui/toolbar";
import { $ } from "./ui/dom";
import { bindArtboard } from "./ui/artboard";
import { bindCharset } from "./ui/charset";
import { bindRealFont } from "./ui/realfont";
import { bindProportions } from "./ui/proportions";
import { registerKeys } from "./panel/keys";

const app = createApp();

bindToolbar(app);
bindGrids(app);
bindStage(app);
bindInspector(app);
bindStages(app);
bindFiles(app);
bindCharset(app);
bindRealFont();
bindProportions(app);
bindArtboard();
// The Project menu closes when you click anywhere else.
document.addEventListener("pointerdown", (e) => {
  const m = document.querySelector<HTMLDetailsElement>(".menu");
  if (m?.open && !m.contains(e.target as Node)) m.open = false;
});
registerKeys();

$("#undo").onclick = () => app.undo();
$("#redo").onclick = () => app.redo();

app.renderToolbar();
app.loadFont();
