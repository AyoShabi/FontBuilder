import { readdirSync, readFileSync } from "node:fs";
import { parseFont } from "../src/font/parser";

/** The first cut of a bundled family. */
export function loadFont(dir: string) {
  const file = readdirSync(`extension/fonts/${dir}`).filter((f) => f.endsWith(".ttf")).sort()[0];
  const b = readFileSync(`extension/fonts/${dir}/${file}`);
  return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

export const FAMILIES = readdirSync("extension/fonts").filter((d) => !d.includes("."));
