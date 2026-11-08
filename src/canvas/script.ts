/**
 * Turns data into ExtendScript source. Illustrator's scripting engine is ES3 and has no JSON
 * object, but JSON is valid ES3 source as long as non-ASCII characters and the two Unicode line
 * separators are escaped, so the data is passed as a literal.
 */
export function toLiteral(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** A call to a function defined in jsx/host.jsx, with arguments passed as literals. */
export function hostCall(fn: string, ...args: unknown[]): string {
  return `${fn}(${args.map(toLiteral).join(",")})`;
}
