/**
 * Scanner, walk and classify part (task 7.1).
 *
 * Discovers candidate disk images below the Library_Root without ever following a
 * symlink, classifies every entry, and opens candidates read-only to hash them.
 * Nothing here writes to the library. Warnings carry the sanitised relative path
 * only, never an absolute path. Discovery never throws for hostile entries.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants, watch as fsWatch } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { deriveCard } from "../../src/shared/card";
import { isWithin } from "../../src/shared/paths";
import { displayName } from "../../src/shared/sanitize";
import { CAPS } from "../../src/shared/schema";
import type {
  CardWarning,
  CatalogueData,
  DiskCard,
  FileEntry,
  FilesDoc,
  FormatFamily,
  ScanStatus,
} from "../../src/shared/schema";
import type { Store } from "../../src/shared/store";
import { ERROR_MESSAGES } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import { ExhumeClientError } from "./exhume-client.js";
import type { ExhumeClient, OpenDiskReport } from "./exhume-client.js";

export const MAX_DEPTH = 8;
export const MAX_ENTRIES = 10_000;
export const MAX_IMAGE_BYTES = 2_949_120;
export const SECTOR_BYTES = 512;
export const EXHUMED_DIR = "exhumed";
export const IMAGE_EXTENSIONS: readonly string[] = [".img", ".ima", ".dsk", ".flp", ".vfd"];

const IGNORED_NAMES: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** Fixed warning texts. None contains a path. */
export const SCAN_MESSAGES = {
  NAME_CONTROL_CHARS: "The file name contains control characters and was skipped.",
  SYMLINK_SKIPPED: "Symbolic links are never followed and were skipped.",
  NOT_A_DISK_IMAGE: "Not a disk image (wrong extension, empty, or size is not a multiple of 512 bytes).",
  TOO_LARGE: "The file is larger than 2,949,120 bytes and was skipped.",
  DEPTH_LIMIT: "A folder is nested deeper than 8 levels and was not entered.",
  ENTRY_LIMIT: "The library has more than 10,000 entries; the rest were not scanned.",
  OPEN_READONLY_FAILED: "The image could not be opened read-only and was skipped.",
  OUTSIDE_LIBRARY: "The image resolves outside the library and was skipped.",
  IMAGE_CHANGED: "The image changed while it was being read and was skipped.",
  WALK_FAILED: "A folder could not be read and was skipped.",
  EXHUME_FAILED: "The exhume tool could not read this disk image.",
  EXHUME_TIMEOUT: "The exhume tool took too long on this disk image.",
  EXHUME_RESTARTED: "The exhume tool stopped unexpectedly and was restarted.",
  STORE_FAILED: "The catalogue could not be updated for this disk image.",
} as const;

export type ScanWarningCode = keyof typeof SCAN_MESSAGES;

/** A file that passed classification by name, type, extension and size. */
export interface ImageCandidate {
  /** Path relative to the Library_Root, `/` separated. */
  relPath: string;
  size: number;
  mtimeMs: number;
}

export interface DiscoveryResult {
  candidates: ImageCandidate[];
  /** Library-level warnings, capped at CAPS.libraryWarnings. */
  warnings: CardWarning[];
  /** Number of directory entries examined by the walk. */
  entriesSeen: number;
}

export interface HashedImage {
  relPath: string;
  size: number;
  /** Lower-case hex SHA-256 of the image bytes. */
  sha256: string;
}

export type HashOutcome =
  | { ok: true; image: HashedImage }
  | { ok: false; warning: CardWarning };

function warn(code: ScanWarningCode, relPath: string | null): CardWarning {
  const w: CardWarning = { code, message: SCAN_MESSAGES[code] };
  if (relPath !== null) w.path = displayName(relPath);
  return w;
}

function hasControlChar(name: string): boolean {
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true;
  }
  return false;
}

function isIgnoredName(name: string): boolean {
  return IGNORED_NAMES.has(name) || name.startsWith("._");
}

function hasImageExtension(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

interface StackItem {
  absDir: string;
  relDir: string;
  /** Depth of the entries inside this directory (the root's children have depth 1). */
  depth: number;
}

/**
 * Iterative depth-first walk and classification. Never throws: every problem becomes
 * a warning. The top-level `exhumed` directory is skipped without being read.
 */
export async function discoverImages(root: string): Promise<DiscoveryResult> {
  const candidates: ImageCandidate[] = [];
  const warnings: CardWarning[] = [];
  const addWarning = (w: CardWarning): void => {
    if (warnings.length < CAPS.libraryWarnings) warnings.push(w);
  };
  let entriesSeen = 0;
  let depthWarned = false;
  let capHit = false;

  const stack: StackItem[] = [{ absDir: root, relDir: "", depth: 1 }];
  while (stack.length > 0 && !capHit) {
    const item = stack.pop();
    if (item === undefined) break;

    let names: string[];
    try {
      names = await readdir(item.absDir);
    } catch {
      addWarning(warn("WALK_FAILED", item.relDir === "" ? null : item.relDir));
      continue;
    }
    names.sort();

    const subdirs: StackItem[] = [];
    for (const name of names) {
      if (isIgnoredName(name)) continue;
      if (entriesSeen >= MAX_ENTRIES) {
        addWarning(warn("ENTRY_LIMIT", null));
        capHit = true;
        break;
      }
      entriesSeen++;

      const rel = item.relDir === "" ? name : `${item.relDir}/${name}`;
      if (hasControlChar(name)) {
        addWarning(warn("NAME_CONTROL_CHARS", rel));
        continue;
      }

      let st;
      try {
        st = await lstat(path.join(item.absDir, name));
      } catch {
        addWarning(warn("WALK_FAILED", rel));
        continue;
      }

      if (st.isSymbolicLink()) {
        addWarning(warn("SYMLINK_SKIPPED", rel));
      } else if (st.isDirectory()) {
        if (item.relDir === "" && name === EXHUMED_DIR) continue;
        if (item.depth >= MAX_DEPTH) {
          if (!depthWarned) {
            depthWarned = true;
            addWarning(warn("DEPTH_LIMIT", rel));
          }
        } else {
          subdirs.push({ absDir: path.join(item.absDir, name), relDir: rel, depth: item.depth + 1 });
        }
      } else if (st.isFile()) {
        if (st.size > MAX_IMAGE_BYTES) {
          addWarning(warn("TOO_LARGE", rel));
        } else if (st.size === 0 || st.size % SECTOR_BYTES !== 0 || !hasImageExtension(name)) {
          addWarning(warn("NOT_A_DISK_IMAGE", rel));
        } else {
          candidates.push({ relPath: rel, size: st.size, mtimeMs: st.mtimeMs });
        }
      } else {
        addWarning(warn("NOT_A_DISK_IMAGE", rel));
      }
    }
    // Reverse so the alphabetically first directory is popped first.
    for (let i = subdirs.length - 1; i >= 0; i--) {
      const d = subdirs[i];
      if (d !== undefined) stack.push(d);
    }
  }

  return { candidates, warnings, entriesSeen };
}

/**
 * Opens one candidate read-only (`O_RDONLY | O_NOFOLLOW`, no other mode is ever tried),
 * checks it is still a regular file of the expected size whose realpath lies inside the
 * Library_Root, and returns its SHA-256. Never throws; failures are warnings.
 */
export async function hashCandidate(root: string, candidate: ImageCandidate): Promise<HashOutcome> {
  const abs = path.join(root, ...candidate.relPath.split("/"));
  let handle;
  try {
    handle = await open(abs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    return { ok: false, warning: warn("OPEN_READONLY_FAILED", candidate.relPath) };
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size !== candidate.size || st.size > MAX_IMAGE_BYTES) {
      return { ok: false, warning: warn("IMAGE_CHANGED", candidate.relPath) };
    }
    let inside = false;
    try {
      const real = await realpath(abs);
      inside = await isWithin(await realpath(root), real);
    } catch {
      inside = false;
    }
    if (!inside) return { ok: false, warning: warn("OUTSIDE_LIBRARY", candidate.relPath) };

    const buf = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < st.size) {
      const { bytesRead } = await handle.read(buf, offset, st.size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== st.size) {
      return { ok: false, warning: warn("IMAGE_CHANGED", candidate.relPath) };
    }
    const sha256 = createHash("sha256").update(buf).digest("hex");
    return { ok: true, image: { relPath: candidate.relPath, size: st.size, sha256 } };
  } catch {
    return { ok: false, warning: warn("OPEN_READONLY_FAILED", candidate.relPath) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ===================================================================
// Scan orchestration, status and watcher (task 7.3)
// ===================================================================

export const DISK_BUDGET_MS = 30_000;
export const MAX_GRAVE_READS = 64;
export const DEBOUNCE_MS = 2_000;
export const POLL_MS = 15_000;
/** Safety bound on the polling chain (about 3.5 days at 15 s). */
export const MAX_POLLS = 20_000;

/** Opaque timer handle so tests can supply fake timers. */
export type TimerHandle = unknown;

export interface Timers {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface WatchHandle {
  close(): void;
}

/** Starts a recursive watch; throws if that is not possible. */
export type WatchFn = (
  root: string,
  onChange: (name: string | null) => void,
  onError: () => void,
) => WatchHandle;

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export const realClock: Clock = { now: () => Date.now() };

export const realWatch: WatchFn = (root, onChange, onError) => {
  const watcher = fsWatch(root, { recursive: true, persistent: false }, (_event, filename) => {
    onChange(typeof filename === "string" ? filename : null);
  });
  watcher.on("error", onError);
  return { close: () => watcher.close() };
};

export interface ScannerOptions {
  client: ExhumeClient;
  store: Store;
  /** Real path of the Library_Root. */
  root: string;
  clock?: Clock;
  timers?: Timers;
  watch?: WatchFn;
  diskBudgetMs?: number;
  debounceMs?: number;
  pollMs?: number;
  maxPolls?: number;
}

export interface TriggerResult {
  started: boolean;
  running: boolean;
}

/** A whole-scan failure with a fixed error code. */
class ScanFailure extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ScanFailure";
    this.code = code;
  }
}

class BudgetExceeded extends Error {
  constructor() {
    super("per-disk budget exceeded");
    this.name = "BudgetExceeded";
  }
}

function fingerprintOf(candidates: readonly ImageCandidate[]): string {
  return candidates.map((c) => `${c.relPath}|${c.size}|${c.mtimeMs}`).join("\n");
}

function isExhumedName(name: string): boolean {
  return name.split(/[\\/]/, 1)[0] === EXHUMED_DIR;
}

function emptyStatus(): ScanStatus {
  return {
    state: "idle",
    scanned: 0,
    total: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    libraryWarnings: [],
  };
}

function placeholderCard(rel: string, image: HashedImage, firstSeen: string): DiskCard {
  return {
    diskId: image.sha256,
    relPath: rel,
    label: "",
    sizeBytes: image.size,
    geometry: { source: "none", label: null },
    fileCount: 0,
    totalEntries: 0,
    entriesTruncated: false,
    dateFirst: null,
    dateLast: null,
    formats: [],
    counts: { alive: 0, recovered: 0, partial: 0, lost: 0 },
    warnings: [],
    status: "new",
    firstSeen,
  };
}

function toFilesDoc(diskId: string, report: OpenDiskReport): FilesDoc {
  const entries: FileEntry[] = report.entries.map((e) => {
    const entry: FileEntry = {
      id: e.id,
      path: e.path,
      kind: e.kind,
      state: e.state,
      size: e.size,
      date: e.date,
    };
    if (e.reason !== undefined) entry.reason = e.reason.slice(0, CAPS.reason);
    return entry;
  });
  return { schemaVersion: 1, diskId, totalEntries: report.totalEntries, truncated: report.truncated, entries };
}

/**
 * Orchestrates scans: walk, hash, catalogue through the Exhume client, prune.
 * Makes no model calls and keeps no cron state. The client, store, clock,
 * timers and watch function are injected so tests can run it in memory.
 */
export class Scanner {
  private readonly client: ExhumeClient;
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly timers: Timers;
  private readonly watchFn: WatchFn;
  private readonly budgetMs: number;
  private readonly debounceMs: number;
  private readonly pollMs: number;
  private readonly maxPolls: number;

  private root: string;
  private status: ScanStatus = emptyStatus();
  private running = false;
  private pendingRescan = false;
  private current: Promise<void> = Promise.resolve();
  private fingerprint: string | null = null;

  private watching = false;
  private watchHandle: WatchHandle | null = null;
  private debounceTimer: TimerHandle | null = null;
  private pollTimer: TimerHandle | null = null;
  private pollsLeft = 0;
  private polling = false;

  constructor(options: ScannerOptions) {
    this.client = options.client;
    this.store = options.store;
    this.root = options.root;
    this.clock = options.clock ?? realClock;
    this.timers = options.timers ?? realTimers;
    this.watchFn = options.watch ?? realWatch;
    this.budgetMs = options.diskBudgetMs ?? DISK_BUDGET_MS;
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.pollMs = options.pollMs ?? POLL_MS;
    this.maxPolls = options.maxPolls ?? MAX_POLLS;
  }

  // ------------------------------------------------------------- public

  /** Copy of the in-memory scan status. */
  getStatus(): ScanStatus {
    return { ...this.status, error: this.status.error === null ? null : { ...this.status.error }, libraryWarnings: [...this.status.libraryWarnings] };
  }

  /** Resolves when no scan is running (including a queued follow-up scan). */
  async idle(): Promise<void> {
    for (let i = 0; i < 8 && this.running; i++) await this.current;
  }

  /** Starts a scan unless one is already running; never touches a running scan. */
  triggerScan(): TriggerResult {
    if (this.running) return { started: false, running: true };
    this.running = true;
    this.current = this.run();
    return { started: true, running: true };
  }

  /** Runs the initial scan and starts the watcher. */
  start(): void {
    this.triggerScan();
    this.startWatching();
  }

  /** Stops the watcher, polling and any pending debounce. A running scan finishes. */
  stop(): void {
    this.stopWatching();
    this.pendingRescan = false;
  }

  /** Points the scanner at a new Library_Root; the watcher follows. */
  setRoot(root: string): void {
    if (root === this.root) return;
    this.root = root;
    this.fingerprint = null;
    if (this.running) this.pendingRescan = true;
    if (this.watching) {
      this.stopWatching();
      this.startWatching();
    }
  }

  startWatching(): void {
    if (this.watching) return;
    this.watching = true;
    try {
      this.watchHandle = this.watchFn(
        this.root,
        (name) => {
          if (name !== null && isExhumedName(name)) return;
          this.scheduleDebounced();
        },
        () => this.fallBackToPolling(),
      );
    } catch {
      this.watchHandle = null;
      this.startPolling();
    }
  }

  stopWatching(): void {
    this.watching = false;
    this.closeWatchHandle();
    if (this.debounceTimer !== null) this.timers.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollsLeft = 0;
  }

  // ------------------------------------------------------------ watcher

  private closeWatchHandle(): void {
    const handle = this.watchHandle;
    this.watchHandle = null;
    if (handle === null) return;
    try {
      handle.close();
    } catch {
      // already closed
    }
  }

  private scheduleDebounced(): void {
    if (!this.watching) return;
    if (this.debounceTimer !== null) this.timers.clearTimeout(this.debounceTimer);
    this.debounceTimer = this.timers.setTimeout(() => {
      this.debounceTimer = null;
      if (!this.watching) return;
      if (this.running) this.pendingRescan = true;
      else this.triggerScan();
    }, this.debounceMs);
  }

  private fallBackToPolling(): void {
    if (!this.watching) return;
    this.closeWatchHandle();
    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollsLeft = this.maxPolls;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (!this.watching || this.pollsLeft <= 0) return;
    this.pollsLeft--;
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce().then(() => {
        if (this.watching && this.pollTimer === null) this.schedulePoll();
      });
    }, this.pollMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const { candidates } = await discoverImages(this.root);
      const next = fingerprintOf(candidates);
      const previous = this.fingerprint;
      this.fingerprint = next;
      if (previous !== null && previous !== next) this.scheduleDebounced();
    } catch {
      // A failed poll is retried at the next tick.
    } finally {
      this.polling = false;
    }
  }

  // --------------------------------------------------------------- scan

  private async run(): Promise<void> {
    try {
      await this.scan();
    } catch (err) {
      const code: ErrorCode = err instanceof ScanFailure ? err.code : "INTERNAL_ERROR";
      this.status = {
        ...this.status,
        state: "failed",
        error: { code, message: ERROR_MESSAGES[code] },
        finishedAt: new Date(this.clock.now()).toISOString(),
      };
    } finally {
      this.running = false;
      if (this.pendingRescan) {
        this.pendingRescan = false;
        this.triggerScan();
      }
    }
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private readCatalogue(): CatalogueData {
    let result = this.store.read();
    // A corrupt file is set aside by the first read; the second read is empty.
    if (!result.ok) result = this.store.read();
    if (!result.ok) throw new ScanFailure(result.error.code);
    return result.value;
  }

  private addLibraryWarning(w: CardWarning): void {
    if (this.status.libraryWarnings.length < CAPS.libraryWarnings) this.status.libraryWarnings.push(w);
  }

  private async scan(): Promise<void> {
    const root = this.root;
    this.status = { ...emptyStatus(), state: "running", startedAt: this.nowIso() };

    const discovery = await discoverImages(root);
    this.fingerprint = fingerprintOf(discovery.candidates);
    for (const w of discovery.warnings) this.addLibraryWarning(w);
    this.status.total = discovery.candidates.length;

    const incomplete =
      discovery.warnings.length >= CAPS.libraryWarnings ||
      discovery.warnings.some((w) => w.code === "WALK_FAILED" || w.code === "ENTRY_LIMIT");

    const snapshot = this.readCatalogue();
    const handled = new Set<string>();
    const present = new Set<string>();
    let rootChanged = false;

    // Bounded by the discovery entry cap (MAX_ENTRIES).
    for (const candidate of discovery.candidates) {
      if (this.root !== root) {
        rootChanged = true;
        break;
      }
      present.add(candidate.relPath);
      const hashed = await hashCandidate(root, candidate);
      if (!hashed.ok) {
        this.addLibraryWarning(hashed.warning);
      } else {
        await this.processImage(root, hashed.image, snapshot, handled);
      }
      this.status.scanned++;
    }

    if (!rootChanged && !incomplete) this.prune(present);
    this.status = { ...this.status, state: "idle", finishedAt: this.nowIso() };
  }

  private mapPath(rel: string, diskId: string): boolean {
    const now = this.nowIso();
    return this.store.update((draft) => {
      if (draft.cards[diskId] === undefined) return;
      draft.paths[rel] = { diskId, firstSeen: draft.paths[rel]?.firstSeen ?? now };
    }).ok;
  }

  private async processImage(
    root: string,
    image: HashedImage,
    snapshot: CatalogueData,
    handled: Set<string>,
  ): Promise<void> {
    const rel = image.relPath;
    const id = image.sha256;
    const existing = snapshot.cards[id];

    // Unchanged image, or a second path to a disk already handled.
    if (handled.has(id) || (existing !== undefined && existing.status !== "new")) {
      handled.add(id);
      if (snapshot.paths[rel]?.diskId === id && existing !== undefined) return;
      if (!this.mapPath(rel, id)) this.addLibraryWarning(this.storeWarning(rel));
      return;
    }
    handled.add(id);

    // Placeholder card (status new); the original first-seen of the path is kept.
    const now = this.nowIso();
    const placed = this.store.update((draft) => {
      const firstSeen = draft.paths[rel]?.firstSeen ?? now;
      draft.paths[rel] = { diskId: id, firstSeen };
      if (draft.cards[id] === undefined) draft.cards[id] = placeholderCard(rel, image, firstSeen);
    });
    if (!placed.ok) {
      this.addLibraryWarning(this.storeWarning(rel));
      return;
    }

    const warnings: CardWarning[] = [];
    try {
      const { report, formats } = await this.readDisk(rel);
      const wrote = this.store.writeFiles(id, toFilesDoc(id, report));
      if (!wrote.ok) throw new ScanFailure(wrote.error.code);
      const stored = this.store.update((draft) => {
        const firstSeen = draft.paths[rel]?.firstSeen ?? now;
        draft.paths[rel] = { diskId: id, firstSeen };
        const previous = draft.cards[id];
        draft.cards[id] = deriveCard({
          diskId: id,
          relPath: previous?.relPath ?? rel,
          sizeBytes: image.size,
          firstSeen: previous?.firstSeen ?? firstSeen,
          report,
          formats,
          hasSummary: draft.annotations[id]?.summary != null,
        });
      });
      if (!stored.ok) throw new ScanFailure(stored.error.code);
      return;
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        warnings.push(warn("EXHUME_TIMEOUT", null));
      } else if (err instanceof ExhumeClientError) {
        if (err.code === "EXHUME_TIMEOUT") {
          warnings.push(warn("EXHUME_TIMEOUT", null));
        } else {
          warnings.push(warn("EXHUME_FAILED", null), warn("EXHUME_RESTARTED", null));
        }
        // The client killed its child; make sure a fresh one serves the next image.
        await this.client.restart(root).catch(() => undefined);
      } else if (err instanceof ScanFailure) {
        warnings.push(warn("STORE_FAILED", null));
      } else {
        warnings.push(warn("EXHUME_FAILED", null));
      }
    }

    // Failure: warnings only, no open_disk fields stored.
    this.store.update((draft) => {
      const card = draft.cards[id];
      if (card === undefined || card.status !== "new") return;
      card.warnings = warnings.slice(0, CAPS.warnings);
    });
  }

  private storeWarning(rel: string): CardWarning {
    return warn("STORE_FAILED", rel);
  }

  /** `open_disk`, then up to 64 `read_grave` calls, all inside one per-disk budget. */
  private async readDisk(rel: string): Promise<{ report: OpenDiskReport; formats: FormatFamily[] }> {
    const deadline = this.clock.now() + this.budgetMs;
    const report = await this.client.openDisk(rel);
    if (this.clock.now() > deadline) throw new BudgetExceeded();

    const formats = new Set<FormatFamily>();
    let reads = 0;
    for (const entry of report.entries) {
      if (reads >= MAX_GRAVE_READS) break;
      if (entry.kind !== "file" || entry.state === "lost") continue;
      if (this.clock.now() > deadline) throw new BudgetExceeded();
      reads++;
      try {
        const grave = await this.client.readGrave(rel, entry.path, entry.id);
        formats.add(grave.format);
      } catch (err) {
        // A tool error on one entry only means no format for it; client errors fail the disk.
        if (err instanceof ExhumeClientError) throw err;
      }
    }
    if (this.clock.now() > deadline) throw new BudgetExceeded();
    return { report, formats: [...formats] };
  }

  /** Removes paths whose files vanished and cards that no path maps to. */
  private prune(present: ReadonlySet<string>): void {
    this.store.update((draft) => {
      for (const p of Object.keys(draft.paths)) {
        if (!present.has(p)) delete draft.paths[p];
      }
      const firstPath = new Map<string, string>();
      for (const p of Object.keys(draft.paths).sort()) {
        const rec = draft.paths[p];
        if (rec !== undefined && !firstPath.has(rec.diskId)) firstPath.set(rec.diskId, p);
      }
      for (const id of Object.keys(draft.cards)) {
        const card = draft.cards[id];
        const first = firstPath.get(id);
        if (card === undefined) continue;
        if (first === undefined) {
          delete draft.cards[id];
        } else if (draft.paths[card.relPath]?.diskId !== id) {
          card.relPath = first;
        }
      }
    });
  }
}
