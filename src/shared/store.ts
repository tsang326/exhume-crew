/**
 * The catalogue Store: the only module that touches catalogue state on disk.
 *
 * Synchronous and dependency free. Writers take a `mkdir` lock, write a temp
 * file, fsync it and atomically rename it over the target. Readers never lock.
 * Every retry or wait loop below has a hard iteration cap.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  SCHEMA_VERSION,
  isCatalogueData,
  isDiskId,
  isFilesDoc,
  type CatalogueData,
  type FilesDoc,
} from "./schema";

export type StoreError =
  | { code: "STORE_BUSY" }
  | { code: "STORE_WRITE_FAILED" }
  | { code: "STORE_CORRUPT"; file: string; reason: string; preservedAs: string };

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export interface Store {
  read(): StoreResult<CatalogueData>;
  /** Read-modify-write under the lock. A throwing `mutate` releases the lock and rethrows. */
  update(mutate: (draft: CatalogueData) => void): StoreResult<void>;
  readFiles(diskId: string): StoreResult<FilesDoc | null>;
  writeFiles(diskId: string, doc: FilesDoc): StoreResult<void>;
}

export interface StoreOptions {
  /** Delay between lock attempts. Default 25 ms. */
  retryMs?: number;
  /** Give up acquiring the lock after this long. Default 5000 ms. */
  lockTimeoutMs?: number;
  /** A lock older than this is stale. Default 30000 ms. */
  staleMs?: number;
}

const DEFAULT_RETRY_MS = 25;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 30_000;
const MAX_CORRUPT_NAME_ATTEMPTS = 100;
const MAX_STALE_REMOVALS = 8;

const REASON_UNREADABLE = "file could not be read";
const REASON_NOT_JSON = "file is not valid JSON";
const REASON_INVALID = "file failed validation";

export function emptyCatalogue(): CatalogueData {
  return { schemaVersion: SCHEMA_VERSION, paths: {}, cards: {}, annotations: {}, exhumed: {} };
}

function errorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function makeWellFormed(s: string): string {
  return (s as unknown as { toWellFormed(): string }).toWellFormed();
}

/** Deep copy of plain JSON data with every string (and object key) made well-formed. */
function wellFormed(value: unknown): unknown {
  if (typeof value === "string") return makeWellFormed(value);
  if (Array.isArray(value)) return value.map(wellFormed);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [makeWellFormed(k), wellFormed(v)]),
    );
  }
  return value;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errorCode(e) === "EPERM";
  }
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "");
}

function unique(): string {
  return `${process.pid}.${randomBytes(6).toString("hex")}`;
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is best effort; the rename has already happened.
  }
}

export function createStore(dataDir: string, options: StoreOptions = {}): Store {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const maxLockAttempts = Math.ceil(lockTimeoutMs / Math.max(1, retryMs)) + 2;

  const storeDir = join(dataDir, "store");
  const filesDir = join(storeDir, "files");
  const lockDir = join(storeDir, ".lock");
  const ownerFile = join(lockDir, "owner.json");
  const catalogueFile = join(storeDir, "catalogue.json");

  function ensureDirs(): boolean {
    try {
      mkdirSync(filesDir, { recursive: true, mode: 0o700 });
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ lock

  function lockIsStale(): boolean {
    try {
      const raw: unknown = JSON.parse(readFileSync(ownerFile, "utf8"));
      if (typeof raw === "object" && raw !== null) {
        const o = raw as { pid?: unknown; startedAt?: unknown };
        if (typeof o.pid === "number" && !pidAlive(o.pid)) return true;
        if (typeof o.startedAt === "number" && Date.now() - o.startedAt > staleMs) return true;
        if (typeof o.pid === "number") return false;
      }
    } catch {
      // Owner file missing or unreadable: the holder may be between mkdir and
      // writing it, so fall through to the directory age.
    }
    try {
      return Date.now() - statSync(lockDir).mtimeMs > staleMs;
    } catch {
      return false; // already gone
    }
  }

  function removeStaleLock(): void {
    if (!lockIsStale()) return; // re-check right before removing
    const aside = `${lockDir}.stale.${unique()}`;
    try {
      renameSync(lockDir, aside);
    } catch {
      return; // someone else removed or replaced it
    }
    try {
      rmSync(aside, { recursive: true, force: true });
    } catch {
      // Leftover aside directory is harmless.
    }
  }

  function acquire(): "ok" | "busy" | "failed" {
    if (!ensureDirs()) return "failed";
    const deadline = Date.now() + lockTimeoutMs;
    let staleRemovals = 0;
    for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
      try {
        mkdirSync(lockDir, { mode: 0o700 });
        try {
          writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
        } catch {
          release();
          return "failed";
        }
        return "ok";
      } catch (e) {
        if (errorCode(e) !== "EEXIST") return "failed";
      }
      if (staleRemovals < MAX_STALE_REMOVALS && lockIsStale()) {
        staleRemovals++;
        removeStaleLock();
        continue;
      }
      if (Date.now() >= deadline) break;
      sleepSync(retryMs);
    }
    return "busy";
  }

  function release(): void {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Nothing more can be done; the next waiter will treat it as stale.
    }
  }

  function withLock<T>(fn: () => StoreResult<T>): StoreResult<T> {
    const got = acquire();
    if (got === "busy") return { ok: false, error: { code: "STORE_BUSY" } };
    if (got === "failed") return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
    try {
      return fn();
    } finally {
      release();
    }
  }

  // ------------------------------------------------------------ file access

  /** Temp file, fsync, atomic rename. Removes the temp file on any failure. */
  function atomicWrite(target: string, data: unknown): boolean {
    const tmp = `${target}.${unique()}.tmp`;
    let fd: number | null = null;
    try {
      const text = JSON.stringify(wellFormed(data));
      fd = openSync(tmp, "wx", 0o600);
      writeFileSync(fd, text, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmp, target);
    } catch {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
      }
      try {
        rmSync(tmp, { force: true });
      } catch {
        // ignore
      }
      return false;
    }
    fsyncDir(join(target, ".."));
    return true;
  }

  /** Renames a bad file to `<name>.corrupt-<UTC>` and returns the new base name. */
  function preserveCorrupt(path: string): string {
    const stamp = utcStamp();
    for (let i = 0; i < MAX_CORRUPT_NAME_ATTEMPTS; i++) {
      const dest = `${path}.corrupt-${stamp}${i === 0 ? "" : `-${i}`}`;
      try {
        statSync(dest);
        continue; // name taken
      } catch {
        // free
      }
      try {
        renameSync(path, dest);
        return dest;
      } catch {
        return dest; // file vanished or cannot move; report intended name
      }
    }
    return `${path}.corrupt-${stamp}`;
  }

  type Loaded<T> = { kind: "missing" } | { kind: "ok"; value: T } | { kind: "corrupt"; error: StoreError };

  function load<T>(path: string, label: string, guard: (v: unknown) => v is T): Loaded<T> {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      if (errorCode(e) === "ENOENT") return { kind: "missing" };
      return corrupt(path, label, REASON_UNREADABLE);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return corrupt(path, label, REASON_NOT_JSON);
    }
    return guard(parsed) ? { kind: "ok", value: parsed } : corrupt(path, label, REASON_INVALID);
  }

  function corrupt<T>(path: string, label: string, reason: string): Loaded<T> {
    const preserved = preserveCorrupt(path);
    const base = preserved.slice(storeDir.length + 1);
    return { kind: "corrupt", error: { code: "STORE_CORRUPT", file: label, reason, preservedAs: base } };
  }

  function readCatalogue(): StoreResult<CatalogueData> {
    const r = load(catalogueFile, "catalogue.json", isCatalogueData);
    if (r.kind === "ok") return { ok: true, value: r.value };
    if (r.kind === "missing") return { ok: true, value: emptyCatalogue() };
    return { ok: false, error: r.error };
  }

  function filesPath(diskId: string): string {
    return join(filesDir, `${diskId}.json`);
  }

  // -------------------------------------------------------------- interface

  return {
    read: readCatalogue,

    update(mutate) {
      return withLock<void>(() => {
        const current = readCatalogue();
        if (!current.ok) return current;
        const draft = wellFormed(current.value) as CatalogueData;
        mutate(draft);
        const next = wellFormed(draft);
        if (!isCatalogueData(next)) return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
        if (!atomicWrite(catalogueFile, next)) {
          return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
        }
        return { ok: true, value: undefined };
      });
    },

    readFiles(diskId) {
      if (!isDiskId(diskId)) return { ok: true, value: null };
      const r = load(filesPath(diskId), `files/${diskId}.json`, isFilesDoc);
      if (r.kind === "ok") return { ok: true, value: r.value };
      if (r.kind === "missing") return { ok: true, value: null };
      return { ok: false, error: r.error };
    },

    writeFiles(diskId, doc) {
      if (!isDiskId(diskId)) return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
      const next = wellFormed(doc);
      if (!isFilesDoc(next)) return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
      return withLock<void>(() =>
        atomicWrite(filesPath(diskId), next)
          ? { ok: true, value: undefined }
          : { ok: false, error: { code: "STORE_WRITE_FAILED" } },
      );
    },
  };
}

/** Lists leftover `.tmp` files in the store (used by tests). */
export function listTempFiles(dataDir: string): string[] {
  const out: string[] = [];
  for (const dir of [join(dataDir, "store"), join(dataDir, "store", "files")]) {
    try {
      for (const name of readdirSync(dir)) if (name.endsWith(".tmp")) out.push(join(dir, name));
    } catch {
      // directory absent
    }
  }
  return out;
}
