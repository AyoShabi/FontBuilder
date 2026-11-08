/**
 * Reads the licence a font declares about itself, to decide whether FontBuilder may change it.
 * Only open licences that allow modified versions pass: the SIL Open Font License and Apache 2.0.
 * Everything else (Adobe Fonts, most fonts bought from foundries, system fonts) is blocked, because
 * their licences don't let you make and share a changed version.
 */

export type LicenceKind = "ofl" | "apache" | "unknown";

export interface LicenceInfo {
  kind: LicenceKind;
  /** True when FontBuilder will let you build a variant of this font. */
  ok: boolean;
  /** Plain-language explanation for the panel. */
  summary: string;
  /** Names the licence reserves; a variant's family name must not use them. */
  reserved: string[];
  copyright: string;
}

const OFL = /open\s+font\s+licen[cs]e|scripts\.sil\.org\/ofl|openfontlicense\.org/i;
const APACHE = /apache\s+licen[cs]e|apache\.org\/licenses/i;

/** Pulls the quoted names out of "with Reserved Font Name "A" and "B"" in a copyright or licence string. */
export function reservedNames(text: string): string[] {
  const out: string[] = [];
  const re = /reserved\s+font\s+names?\s*((?:[\s,]*(?:and\s+)?["“'‘][^"”'’]+["”'’])+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const q of m[1].matchAll(/["“'‘]([^"”'’]+)["”'’]/g)) {
      const name = q[1].trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** Checks the licence from a font's name records (0 copyright, 13 licence text, 14 licence URL). */
export function checkLicence(names: Record<number, string>): LicenceInfo {
  const copyright = names[0] || "";
  const lic = `${names[13] || ""} ${names[14] || ""}`;
  const reserved = reservedNames(`${copyright} ${names[13] || ""}`);
  if (OFL.test(lic)) {
    return {
      kind: "ofl",
      ok: true,
      summary: "SIL Open Font License: you can change this font and release your version, as long as you keep the copyright notice and licence and give it a new name.",
      reserved,
      copyright,
    };
  }
  if (APACHE.test(lic)) {
    return {
      kind: "apache",
      ok: true,
      summary: "Apache License 2.0: you can change this font and release your version, as long as you keep the copyright notice and licence and say that you changed it.",
      reserved,
      copyright,
    };
  }
  return {
    kind: "unknown",
    ok: false,
    summary: lic.trim()
      ? "This font's licence doesn't say it allows changed versions, so FontBuilder won't edit it. Adobe Fonts and most fonts you buy can't be changed and re-released."
      : "This font doesn't say what licence it's under, so FontBuilder won't edit it. Use a font under the SIL Open Font License, such as one from Google Fonts.",
    reserved,
    copyright,
  };
}

/** True when a proposed family name uses one of the reserved names (case-insensitive, ignoring spaces). */
export function usesReservedName(family: string, reserved: string[]): string | null {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const f = squash(family);
  return reserved.find((r) => r.trim() && f.includes(squash(r))) || null;
}
