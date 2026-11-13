/**
 * LibraryManager: resolves, validates, persists and exposes the Library_Root
 * (Requirements 3.1, 3.4, 3.5, 3.6, 3.10 to 3.13, 7.14, 7.15).
 *
 * Error messages come from the fixed table in errors.ts and never contain a path.
 */
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, ERROR_MESSAGES } from "./errors";
import type { ErrorCode } from "./errors";

export const REALPATH_TIMEOUT_MS = 2000;
export const DEFAULT_LIBRARY_NAME = "Exhume Library";
export const ACTIVE_FILE_NAME = "library-active.json";
export const CONFIG_FILE_NAME = "config.json";

export type LibraryErrorCode = Extract<
  ErrorCode,
  | "LIBRARY_TOO_BROAD"
  | "LIBRARY_NOT_FOUND"
  | "LIBRARY_NOT_DIRECTORY"
  | "LIBRARY_UNREADABLE"
  | "LIBRARY_TIMEOUT"
>;

export interface LibraryStatus {
  /** Active (or last attempted) path, as the user typed it. */
  readonly path: string;
  readonly error: { readonly code: LibraryErrorCode; readonly message: string } | null;
}

export interface LibraryManagerOptions {
  /** Backend data directory (holds library-active.json and config.json). */
  readonly dataDir: string;
  /** Home directory. Defaults to the OS home directory. */
  readonly home: string;
  /** Called after a new library is persisted; restarts the Exhume client with `--root <real>`. */
  readonly restartExhume: (realPath: string) => Promise<void> | void;
  /** Called after the restart; starts a scan of the new library. */
  readonly triggerScan: () => Promise<void> | void;
  /** Timeout for realpath, in ms. Defaults to 2000. */
  readonly realpathTimeoutMs?: number;
}

function libraryError(code: LibraryErrorCode): ApiError {
  return new ApiError(code, code === "LIBRARY_TIMEOUT" ? 504 : 400);
}

function isLibraryCode(code: ErrorCode): code is LibraryErrorCode {
  return code.startsWith("LIBRARY_");
}

function errnoCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

/** Expands a leading `~` (alone or followed by a separator). `~user` is not expanded. */
function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
}

async function realpathWithTimeout(target: string, timeoutMs: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(libraryError("LIBRARY_TIMEOUT")), timeoutMs);
  });
  try {
    return await Promise.race([realpath(target), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** True when `ancestor` equals `child` or contains it, compared by path segment. */
function isSameOrAncestor(ancestor: string, child: string): boolean {
  if (ancestor === child) return true;
  const prefix = ancestor.endsWith(path.sep) ? ancestor : ancestor + path.sep;
  return child.startsWith(prefix);
}

/**
 * Validates a candidate library path and returns its real path.
 * Throws an ApiError with one of the fixed LIBRARY_* codes.
 */
export async function validateLibraryPath(
  input: string,
  home: string,
  timeoutMs: number = REALPATH_TIMEOUT_MS,
): Promise<string> {
  if (typeof input !== "string" || input.trim() === "" || input.includes("\0")) {
    throw libraryError("LIBRARY_NOT_FOUND");
  }
  const expanded = expandHome(input.trim(), home);
  if (!path.isAbsolute(expanded)) throw libraryError("LIBRARY_NOT_FOUND");
  const absolute = path.resolve(expanded);

  let real: string;
  try {
    real = await realpathWithTimeout(absolute, timeoutMs);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const code = errnoCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") throw libraryError("LIBRARY_NOT_FOUND");
    throw libraryError("LIBRARY_UNREADABLE");
  }

  try {
    const st = await lstat(real);
    if (!st.isDirectory()) throw libraryError("LIBRARY_NOT_DIRECTORY");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw libraryError(errnoCode(err) === "ENOENT" ? "LIBRARY_NOT_FOUND" : "LIBRARY_UNREADABLE");
  }

  let homeReal: string;
  try {
    homeReal = await realpathWithTimeout(path.resolve(home), timeoutMs);
  } catch {
    homeReal = path.resolve(home);
  }
  // Rejects "/", the home directory, and every ancestor of it (segment prefix).
  if (real === path.parse(real).root || isSameOrAncestor(real, homeReal)) {
    throw libraryError("LIBRARY_TOO_BROAD");
  }

  try {
    await access(real, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    throw libraryError("LIBRARY_UNREADABLE");
  }
  return real;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string" && field.trim() !== "") return field;
  }
  return undefined;
}

export class LibraryManager {
  private readonly dataDir: string;
  private readonly home: string;
  private readonly restartExhume: LibraryManagerOptions["restartExhume"];
  private readonly triggerScan: LibraryManagerOptions["triggerScan"];
  private readonly timeoutMs: number;

  private typedPath: string;
  private realPath: string | null = null;
  private error: LibraryStatus["error"] = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: LibraryManagerOptions) {
    this.dataDir = options.dataDir;
    this.home = options.home;
    this.restartExhume = options.restartExhume;
    this.triggerScan = options.triggerScan;
    this.timeoutMs = options.realpathTimeoutMs ?? REALPATH_TIMEOUT_MS;
    this.typedPath = path.join(this.home, DEFAULT_LIBRARY_NAME);
  }

  private get activeFile(): string {
    return path.join(this.dataDir, ACTIVE_FILE_NAME);
  }

  /**
   * Resolves the startup library: active file, then config.json `libraryPath`,
   * then the default. Each candidate is validated; the first valid one wins and
   * is persisted if it did not come from the active file. Does not restart the
   * Exhume client or scan; the caller does that after startup.
   */
  async init(): Promise<LibraryStatus> {
    const candidates: { source: "active" | "config" | "default"; value: string }[] = [];
    const active = stringField(await readJson(this.activeFile), "path");
    if (active !== undefined) candidates.push({ source: "active", value: active });
    const configured = stringField(
      await readJson(path.join(this.dataDir, CONFIG_FILE_NAME)),
      "libraryPath",
    );
    if (configured !== undefined) candidates.push({ source: "config", value: configured });
    candidates.push({ source: "default", value: path.join(this.home, DEFAULT_LIBRARY_NAME) });

    let first = true;
    for (const candidate of candidates) {
      if (first) this.typedPath = candidate.value;
      first = false;
      try {
        const real = await validateLibraryPath(candidate.value, this.home, this.timeoutMs);
        this.typedPath = candidate.value;
        this.realPath = real;
        this.error = null;
        if (candidate.source !== "active") await this.persist(real);
        return this.getStatus();
      } catch (err) {
        this.error = this.toStatusError(err);
      }
    }
    this.realPath = null;
    return this.getStatus();
  }

  /**
   * Validates `input`, persists it atomically, restarts the Exhume client and
   * triggers a scan. A rejected path throws and leaves the previous valid path
   * active; nothing is written and nothing starts.
   */
  setLibrary(input: string): Promise<LibraryStatus> {
    const run = this.queue.then(() => this.doSetLibrary(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doSetLibrary(input: string): Promise<LibraryStatus> {
    let real: string;
    try {
      real = await validateLibraryPath(input, this.home, this.timeoutMs);
    } catch (err) {
      this.error = this.toStatusError(err);
      throw err;
    }
    await this.persist(real);
    this.typedPath = input;
    this.realPath = real;
    this.error = null;
    await this.restartExhume(real);
    await this.triggerScan();
    return this.getStatus();
  }

  getStatus(): LibraryStatus {
    return { path: this.typedPath, error: this.error };
  }

  /** The validated real path of the active library, or null when none is valid. */
  getRealPath(): string | null {
    return this.realPath;
  }

  private toStatusError(err: unknown): NonNullable<LibraryStatus["error"]> {
    if (err instanceof ApiError && isLibraryCode(err.code)) {
      return { code: err.code, message: ERROR_MESSAGES[err.code] };
    }
    return { code: "LIBRARY_UNREADABLE", message: ERROR_MESSAGES.LIBRARY_UNREADABLE };
  }

  /** Atomic write: temp file in the same directory, then rename. */
  private async persist(real: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmp = path.join(this.dataDir, `.${ACTIVE_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);
    const body = JSON.stringify({ path: real, updatedAt: new Date().toISOString() }, null, 2);
    try {
      await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, this.activeFile);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}
