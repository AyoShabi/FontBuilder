import { readFileSync } from "node:fs";
import { parseFont } from "../src/font/parser";

export function loadFont(dir: string) {
  const b = readFileSync(`extension/fonts/${dir}/regular.ttf`);
  return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

export const FAMILIES = ["anybody", "bigshoulders", "gasoek", "monasans", "sofia", "tiltwarp"];
