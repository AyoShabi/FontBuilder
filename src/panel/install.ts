/**
 * Installs a font file for the current user so Illustrator can use it straight away, and removes
 * earlier ones. Illustrator can't reload a font whose file changed, so each preview is installed
 * as a new font with its own name, and the old ones are removed once nothing needs them.
 *
 * Windows: the file goes in the user's own fonts folder (no admin rights needed), is registered
 * under HKCU, loaded into the running session and announced with WM_FONTCHANGE, which Adobe
 * apps listen for. macOS: copying into ~/Library/Fonts is enough.
 */
import { nodeRequire } from "./cep";

interface Installed {
  path: string;
  /** Registry value name (Windows). */
  reg: string;
}

const LS_KEY = "fontbuilder-installed-previews";

type ExecFile = (cmd: string, args: string[], opts: object, cb: (err: Error | null, out: string, errOut: string) => void) => void;

function node() {
  const req = nodeRequire();
  if (!req) throw new Error("Installing fonts only works inside Illustrator.");
  return {
    fs: req("fs") as typeof import("fs"),
    path: req("path") as typeof import("path"),
    os: req("os") as typeof import("os"),
    env: (req("process") as typeof import("process")).env,
    execFile: (req("child_process") as { execFile: ExecFile }).execFile,
  };
}

function run(cmd: string, args: string[]): Promise<string> {
  const { execFile } = node();
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout: 20000 }, (err, out, errOut) => (err ? reject(new Error(errOut || err.message)) : resolve(out))),
  );
}

const isWindows = () => node().os.platform() === "win32";
const REG_FONTS = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const psQuote = (s: string) => "'" + s.replace(/'/g, "''") + "'";

/** Runs a PowerShell script, passed base64-encoded (UTF-16LE) so no command-line quoting can mangle it. */
function powershell(script: string): Promise<string> {
  const u16 = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    u16[i * 2] = c & 0xff;
    u16[i * 2 + 1] = c >> 8;
  }
  let bin = "";
  for (const b of u16) bin += String.fromCharCode(b);
  return run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", btoa(bin)]);
}

/** PowerShell that loads or unloads a font file in the running session and tells apps fonts changed. */
export function gdiScript(path: string, load: boolean): string {
  const fn = load ? "AddFontResourceW" : "RemoveFontResourceW";
  return [
    "$sig = '[DllImport(\"gdi32.dll\", CharSet=CharSet.Unicode)] public static extern int AddFontResourceW(string f);" +
      ' [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int RemoveFontResourceW(string f);' +
      ' [DllImport("user32.dll")] public static extern System.IntPtr SendMessageTimeoutW(System.IntPtr h, int m, System.IntPtr w, System.IntPtr l, int f, int t, out System.IntPtr r);\'',
    "Add-Type -Namespace FontBuilder -Name Gdi -MemberDefinition $sig",
    `[void][FontBuilder.Gdi]::${fn}(${psQuote(path)})`,
    "$r = [System.IntPtr]::Zero",
    "[void][FontBuilder.Gdi]::SendMessageTimeoutW([System.IntPtr]0xffff, 0x1D, [System.IntPtr]::Zero, [System.IntPtr]::Zero, 2, 2000, [ref]$r)",
  ].join("; ");
}

function loadList(): Installed[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]") as Installed[];
  } catch {
    return [];
  }
}

function saveList(l: Installed[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(l));
  } catch {
    // Not fatal: old previews just aren't cleaned up.
  }
}

function fontsFolder(): string {
  const { path, os, fs, env } = node();
  const dir = isWindows()
    ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "Windows", "Fonts")
    : path.join(os.homedir(), "Library", "Fonts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Installs `bytes` as `fileName` for this user. `fullName` is the font's full name, used in the Windows registry. */
export async function installFont(bytes: Uint8Array, fileName: string, fullName: string): Promise<void> {
  const { fs, path } = node();
  const file = path.join(fontsFolder(), fileName);
  fs.writeFileSync(file, bytes);
  const entry: Installed = { path: file, reg: `${fullName} (TrueType)` };
  if (isWindows()) {
    await run("reg", ["add", REG_FONTS, "/v", entry.reg, "/t", "REG_SZ", "/d", file, "/f"]);
    await powershell(gdiScript(file, true));
  }
  saveList([...loadList().filter((e) => e.path !== file), entry]);
}

/** Removes every preview font installed earlier except `keep`. Fonts still in use are tried again next time. */
export async function removeOldFonts(keepFile: string): Promise<void> {
  const { fs, path } = node();
  const keep = path.join(fontsFolder(), keepFile);
  const left: Installed[] = [];
  for (const e of loadList()) {
    if (e.path === keep) {
      left.push(e);
      continue;
    }
    try {
      if (isWindows()) {
        await powershell(gdiScript(e.path, false));
        await run("reg", ["delete", REG_FONTS, "/v", e.reg, "/f"]).catch(() => "");
      }
      if (fs.existsSync(e.path)) fs.unlinkSync(e.path);
    } catch {
      left.push(e);
    }
  }
  saveList(left);
}

/** The number for the next preview font, so every install has a new name. */
export function nextPreviewNumber(): number {
  let n = 1;
  try {
    n = (parseInt(localStorage.getItem(LS_KEY + "-n") || "0", 10) || 0) + 1;
    localStorage.setItem(LS_KEY + "-n", String(n));
  } catch {
    n = Date.now() % 100000;
  }
  return n;
}
