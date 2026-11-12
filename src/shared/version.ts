export const MIN_NODE_MAJOR = 22;

export type NodeVersionResult = { ok: true } | { ok: false; message: string };

/** Accepts "22.1.0", "v22.1.0" and similar; allows start only for major >= 22. */
export function checkNodeVersion(versionString: string): NodeVersionResult {
  const match = /^\s*v?(\d+)(?:\.\d+){0,2}(?:[-+].*)?\s*$/.exec(versionString);
  const major = match?.[1] === undefined ? NaN : Number.parseInt(match[1], 10);
  if (Number.isSafeInteger(major) && major >= MIN_NODE_MAJOR) return { ok: true };
  return {
    ok: false,
    message: `Node.js ${MIN_NODE_MAJOR} or newer is required (found "${versionString}"). Minimum supported version: ${MIN_NODE_MAJOR}.`,
  };
}
