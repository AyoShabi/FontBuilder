// Builds the Illustrator extension into dist/FontBuilder: the panel's TypeScript bundled into one
// plain script (CEP loads pages from file://, where ES modules don't load), plus the static files.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "dist/FontBuilder";
rmSync("dist", { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync("extension", out, { recursive: true });
// Windows batch files need CRLF line endings.
writeFileSync("dist/install-windows.cmd", readFileSync("install/install-windows.cmd", "utf8").replace(/\r?\n/g, "\r\n"));
cpSync("install/install-mac.command", "dist/install-mac.command");
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "chrome88",
  outfile: `${out}/js/panel.js`,
  legalComments: "none",
});
console.log("Built " + out);
