/** Live proofs under the editor: specimen line, posters and waterfall, all set in the live font. */
import { $, $input } from "./dom";

const WATERFALL_SIZES = [72, 48, 32, 20, 14];
const WATERFALL_TEXT = "The quick brown fox jumps over the lazy dog 0123456789";

export function bindProofs(): void {
  $input("#specText").addEventListener("input", (e) => {
    $("#specimen").textContent = (e.target as HTMLInputElement).value || " ";
  });
  $input("#specSize").addEventListener("input", (e) => {
    const v = (e.target as HTMLInputElement).value;
    $("#specimen").style.fontSize = v + "px";
    $("#specSizeOut").textContent = v + "px";
  });
  $("#waterfall").innerHTML = WATERFALL_SIZES.map((s) => `<div style="font-size:${s}px"><span>${s}</span>${WATERFALL_TEXT}</div>`).join("");
}
