import { createApp } from "./ui/app";
import { bindFiles } from "./ui/files";
import { bindGrids } from "./ui/grids";
import { bindInspector } from "./ui/inspector";
import { bindProofs } from "./ui/proofs";
import { bindStage } from "./ui/stage";
import { bindStages } from "./ui/stages";
import { bindToolbar } from "./ui/toolbar";
import { $ } from "./ui/dom";
import { bindArtboard } from "./ui/artboard";
import { registerKeys } from "./panel/keys";

const app = createApp();

bindToolbar(app);
bindGrids(app);
bindStage(app);
bindInspector(app);
bindStages(app);
bindProofs();
bindFiles(app);
bindArtboard();
registerKeys();

$("#undo").onclick = () => app.undo();
$("#redo").onclick = () => app.redo();

app.renderToolbar();
app.loadFont();
