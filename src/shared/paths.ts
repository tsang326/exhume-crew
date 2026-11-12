import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";

export const OUTSIDE_WRITE_MESSAGE = "outside the permitted write locations";

export type GuardedWriteResult =
  | { ok: true }
  | { ok: false; error: { code: "OUTSIDE_WRITE_LOCATIONS"; message: string } };

function errorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Real path of `p`, tolerating a missing tail: the deepest existing ancestor is
 * resolved through symlinks and the missing segments are appended. Returns null
 * when a dangling symlink is met (its target cannot be vetted) or on other errors.
 */
async function realpathAllowMissing(p: string): Promise<string | null> {
  const abs = resolve(p);
  const missing: string[] = [];
  let current = abs;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch (e) {
      if (errorCode(e) !== "ENOENT" && errorCode(e) !== "ENOTDIR") return null;
    }
    try {
      await lstat(current);
      return null; // exists but does not resolve: dangling symlink
    } catch (e) {
      if (errorCode(e) !== "ENOENT" && errorCode(e) !== "ENOTDIR") return null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    missing.push(parse(current).base);
    current = parent;
  }
}

/** Segment-based containment of two already-resolved absolute paths. */
function containsSegments(base: string, candidate: string): boolean {
  const b = base.split(sep).filter((s) => s !== "");
  const c = candidate.split(sep).filter((s) => s !== "");
  if (c.length < b.length) return false;
  return b.every((seg, i) => seg === c[i]);
}

/**
 * True when the real path of `candidate` is the real path of `base` or lies
 * inside it. Compares whole path segments (so `/a/bc` is not within `/a/b`),
 * follows symlinks, and accepts a candidate whose tail does not exist yet.
 */
export async function isWithin(base: string, candidate: string): Promise<boolean> {
  if (base === "" || candidate === "") return false;
  const realBase = await realpathAllowMissing(base);
  const realCandidate = await realpathAllowMissing(candidate);
  if (realBase === null || realCandidate === null) return false;
  return containsSegments(realBase, realCandidate);
}

/**
 * Writes `data` to `target` only when it lies within `base`. Otherwise nothing
 * is touched and the "outside the permitted write locations" error is returned.
 */
export async function guardedWriteFile(
  base: string,
  target: string,
  data: string | Uint8Array,
): Promise<GuardedWriteResult> {
  if (!(await isWithin(base, target))) {
    return { ok: false, error: { code: "OUTSIDE_WRITE_LOCATIONS", message: OUTSIDE_WRITE_MESSAGE } };
  }
  await mkdir(dirname(target), { recursive: true });
  // Re-check after creating parents, in case the tree changed in between.
  if (!(await isWithin(base, target))) {
    return { ok: false, error: { code: "OUTSIDE_WRITE_LOCATIONS", message: OUTSIDE_WRITE_MESSAGE } };
  }
  await writeFile(target, data);
  return { ok: true };
}
