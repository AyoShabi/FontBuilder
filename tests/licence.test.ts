import { describe, expect, it } from "vitest";
import { checkLicence, reservedNames, usesReservedName } from "../src/licence";
import { FAMILIES, loadFont } from "./helpers";

describe("licence check", () => {
  it("lets every bundled font through as OFL", () => {
    for (const fam of FAMILIES) {
      const l = checkLicence(loadFont(fam).names);
      expect(l.ok).toBe(true);
      expect(l.kind).toBe("ofl");
    }
  });

  it("finds Mona Sans's reserved name", () => {
    expect(checkLicence(loadFont("monasans").names).reserved).toEqual(["Mona"]);
    expect(checkLicence(loadFont("anybody").names).reserved).toEqual([]);
  });

  it("blocks fonts without an open licence", () => {
    expect(checkLicence({ 0: "Copyright Adobe", 13: "This font is licensed for use under the Adobe Fonts terms." }).ok).toBe(false);
    expect(checkLicence({ 0: "(c) Someone" }).ok).toBe(false);
    expect(checkLicence({ 14: "http://www.apache.org/licenses/LICENSE-2.0" }).kind).toBe("apache");
  });

  it("reads several reserved names and checks a new family name against them", () => {
    const r = reservedNames('Copyright 2011 X, with Reserved Font Names "Source" and "Adobe".');
    expect(r).toEqual(["Source", "Adobe"]);
    expect(usesReservedName("Umba Source Display", r)).toBe("Source");
    expect(usesReservedName("Umba Display", r)).toBeNull();
  });
});
