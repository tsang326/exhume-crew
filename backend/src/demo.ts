/**
 * Demo library copy (Requirements 3.2, 3.3, 4.2, 7.13; design impact I-9).
 *
 * This is the single user-initiated write into the Library outside `exhumed/`.
 * Each `demo-library/*.img` is written to a temporary name in the Library and
 * then published with `fs.link`, which fails with EEXIST instead of replacing
 * an existing file. The temporary name is always removed again. Files
 * already linked before an error are complete and stay.
 *
 * Only file names are reported, never paths. Nothing in `demo-library/` is
 * ever opened for writing.
 */
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { link, lstat, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./errors";
import { validateLibraryPath } from "./library";

export const DEMO_DIR_NAME = "demo-library";
export const DEMO_IMAGE_EXTENSION = ".img";
/** Largest image copied (2.88 MB floppy). Larger sources are ignored. */
export const MAX_DEMO_IMAGE_BYTES = 2_949_120;

/** Places where a failure can be injected, in the order they happen. */
export const DEMO_FAILURE_POINTS = [
  "mkdir-library",
  "write-temp",
  "link",
  "unlink-temp",
] as const;
export type DemoFailurePoint = (typeof DEMO_FAILURE_POINTS)[number];

/**
 * Test seam. Called just before the real operation at `point`; throwing makes
 * that operation fail. `fileName` is the demo image name, or "" for
 * "mkdir-library".
 */
export type DemoFailureInjector = (point: DemoFailurePoint, fileName: string) => void | Promise<void>;

export interface DemoCopyOptions {
  /**
   * Must be `true`. The copy is started only by an explicit user action
   * (the "Use demo library" button); nothing calls it at startup or on a timer.
   */
  readonly userInitiated: true;
  /** Home directory used by library validation. Defaults to the OS home. */
  readonly home?: string;
  /** Failure injection for tests. Absent in production. */
  readonly inject?: DemoFailureInjector;
}

export interface DemoCopyResult {
  /** Names of images newly written into the Library. */
  readonly copied: readonly string[];
  /** Names of images left alone because a file of that name already existed. */
  readonly skipped: readonly string[];
}

/** Failure carrying what was done before it, as file names only. */
export class DemoCopyError extends ApiError {
  readonly copied: readonly string[];
  readonly skipped: readonly string[];

  constructor(copied: readonly string[], skipped: readonly string[]) {
    super("DEMO_COPY_FAILED", 500);
    this.name = "DemoCopyError";
    this.copied = copied;
    this.skipped = skipped;
  }
}

function errnoCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

/** Regular `*.img` files (no symlinks) directly inside the demo folder, sorted. */
async function listDemoImages(demoDir: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(demoDir)) {
    if (path.extname(entry).toLowerCase() !== DEMO_IMAGE_EXTENSION) continue;
    if (entry !== path.basename(entry)) continue;
    const st = await lstat(path.join(demoDir, entry));
    if (!st.isFile() || st.size === 0 || st.size > MAX_DEMO_IMAGE_BYTES) continue;
    names.push(entry);
  }
  return names.sort();
}

/** Creates the Library folder when it is missing and its parent exists (I-9). */
async function ensureLibraryFolder(
  libraryRoot: string,
  inject: DemoFailureInjector | undefined,
): Promise<void> {
  const target = path.resolve(libraryRoot);
  try {
    await lstat(target);
    return; // exists; validateLibraryPath judges whether it is usable
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") return; // let validation report the problem
  }
  if (inject) await inject("mkdir-library", "");
  try {
    // Not recursive: only the last segment may be created.
    await mkdir(target, { mode: 0o755 });
  } catch (err) {
    if (errnoCode(err) !== "EEXIST") throw err;
  }
}

/**
 * Copies `<appRoot>/demo-library/*.img` into `libraryRoot`.
 *
 * Throws the library's fixed LIBRARY_* ApiError when the folder is unusable,
 * and a DemoCopyError (DEMO_COPY_FAILED) for any copy failure.
 */
export async function copyDemoLibrary(
  appRoot: string,
  libraryRoot: string,
  options: DemoCopyOptions,
): Promise<DemoCopyResult> {
  if (options.userInitiated !== true) throw new ApiError("DEMO_COPY_FAILED", 500);
  const inject = options.inject;
  const home = options.home ?? homedir();
  const copied: string[] = [];
  const skipped: string[] = [];

  try {
    await ensureLibraryFolder(libraryRoot, inject);
  } catch {
    throw new DemoCopyError(copied, skipped);
  }
  // Throws a LIBRARY_* ApiError (no path in message) if the folder is not usable.
  const realLibrary = await validateLibraryPath(libraryRoot, home);

  const demoDir = path.join(appRoot, DEMO_DIR_NAME);
  let names: string[];
  try {
    names = await listDemoImages(demoDir);
  } catch {
    throw new DemoCopyError(copied, skipped);
  }

  for (const name of names) {
    const finalPath = path.join(realLibrary, name);
    const tmpPath = path.join(realLibrary, `.demo-${randomBytes(8).toString("hex")}.tmp`);
    try {
      const bytes = await readFile(path.join(demoDir, name));
      if (inject) await inject("write-temp", name);
      // "wx": never opens an existing file, never follows a planted link.
      await writeFile(tmpPath, bytes, { flag: "wx", mode: 0o644 });

      if (inject) await inject("link", name);
      try {
        await link(tmpPath, finalPath);
        copied.push(name);
      } catch (err) {
        if (errnoCode(err) !== "EEXIST") throw err;
        skipped.push(name);
      }

      if (inject) await inject("unlink-temp", name);
      await unlink(tmpPath);
    } catch {
      // The temp file may exist even if writeFile threw part-way.
      await unlink(tmpPath).catch(() => undefined);
      throw new DemoCopyError(copied, skipped);
    }
  }
  return { copied, skipped };
}
