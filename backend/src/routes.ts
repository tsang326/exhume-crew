/**
 * Page API route table (Requirement 7). Exactly eleven operations, built by a
 * factory that takes every collaborator as an injected dependency so tests can
 * use fakes (store, scanner, library manager, exhume client, demo copy, clock).
 *
 * Handlers run only after the server has verified the Proxy_Signature and run
 * the parameter guard. Disk ids and entry ids are parsed again here with the
 * typed parsers; a client path is never forwarded to the Exhume server: the
 * Backend looks the stored path up by entry id.
 */
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { toCardView } from "../../src/shared/card";
import { isWithin } from "../../src/shared/paths";
import { displayName } from "../../src/shared/sanitize";
import type {
  CardWarning,
  CatalogueData,
  DiskCard,
  DiskCardView,
  FileEntry,
  ScanStatus,
} from "../../src/shared/schema";
import type { Store } from "../../src/shared/store";
import type { DemoCopyResult } from "./demo";
import { ApiError, redactPaths } from "./errors";
import { ExhumeClientError, ExhumeToolError } from "./exhume-client";
import type { ExhumeClient, ExhumeWarning } from "./exhume-client";
import { toCsv, toMarkdown } from "./exports";
import type { LibraryStatus } from "./library";
import { parseDiskId, parseEntryId } from "./params";

export const MAX_PREVIEW_BYTES = 65_536;
/** Largest exhumed PNG returned as a data URL. */
export const MAX_IMAGE_DATA_BYTES = 1_500_000;
const MAX_LIBRARY_PATH_CHARS = 4096;
const MAX_PREVIEW_WARNINGS = 50;
const EXHUMED_DIR = "exhumed";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TOOL_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// ------------------------------------------------------------------ types

export interface ScannerPort {
  getStatus(): ScanStatus;
  triggerScan(): { started: boolean; running: boolean };
}

export interface LibraryPort {
  getStatus(): LibraryStatus;
  getRealPath(): string | null;
  setLibrary(input: string): Promise<LibraryStatus>;
}

export interface RouteClock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface RouteDeps {
  store: Store;
  scanner: ScannerPort;
  library: LibraryPort;
  exhume: Pick<ExhumeClient, "readGrave" | "exhume">;
  /** Copies the demo images into the library folder named by `libraryPath` (as typed). */
  copyDemo(libraryPath: string): Promise<DemoCopyResult>;
  /** SHA-256 of the image as it is on disk now, or null when it cannot be read. */
  hashImage(relPath: string, sizeBytes: number): Promise<string | null>;
  clock: RouteClock;
}

export interface HandlerInput {
  /** Values of the `:name` pattern segments. */
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type RouteResult =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown }
  | {
      readonly kind: "text";
      readonly status: number;
      readonly contentType: string;
      readonly fileName: string;
      readonly body: string;
    };

export interface Route {
  readonly method: "GET" | "PUT" | "POST";
  /** Decoded path segments; a segment starting with `:` captures a value. */
  readonly pattern: readonly string[];
  /** Query parameter names this route accepts. */
  readonly query: readonly string[];
  readonly handler: (input: HandlerInput) => Promise<RouteResult>;
}

export type PreviewWarning = CardWarning;

export type PreviewResponse =
  | {
      kind: "text";
      format: "markdown" | "csv" | "text";
      text: string;
      truncated: boolean;
      warnings: PreviewWarning[];
    }
  | {
      kind: "png";
      width: number;
      height: number;
      bytes: number;
      imageDataUrl: string | null;
      warnings: PreviewWarning[];
    };

export interface ExhumeOutcome {
  entry: number;
  path: string;
  outcome: "exhumed" | "failed";
  outputPath?: string;
  errorCode?: string;
}

// ---------------------------------------------------------------- helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function json(status: number, body: unknown): RouteResult {
  return { kind: "json", status, body };
}

function storeFailure(code: string): ApiError {
  if (code === "STORE_BUSY") return new ApiError("STORE_BUSY", 503);
  if (code === "STORE_CORRUPT") return new ApiError("STORE_CORRUPT", 500);
  return new ApiError("STORE_WRITE_FAILED", 500);
}

/** Reads the catalogue. A corrupt file is set aside by the first read, so one retry is allowed. */
function readCatalogue(store: Store): CatalogueData {
  let result = store.read();
  if (!result.ok && result.error.code === "STORE_CORRUPT") result = store.read();
  if (!result.ok) throw storeFailure(result.error.code);
  return result.value;
}

function compareCards(a: DiskCard, b: DiskCard): number {
  if (a.relPath !== b.relPath) return a.relPath < b.relPath ? -1 : 1;
  if (a.diskId === b.diskId) return 0;
  return a.diskId < b.diskId ? -1 : 1;
}

function allViews(data: CatalogueData): DiskCardView[] {
  return Object.values(data.cards)
    .sort(compareCards)
    .map((card) => toCardView(card, data.annotations[card.diskId]));
}

/** An id that is not a well-formed Disk_Id cannot be in the Store, so it is a 404 too (Requirement 7.5). */
function requireCard(data: CatalogueData, rawId: string | undefined): DiskCard {
  const id = parseDiskId(rawId);
  const card = id === null ? undefined : data.cards[id];
  if (card === undefined) throw new ApiError("DISK_NOT_FOUND", 404);
  return card;
}

function readEntries(store: Store, card: DiskCard): FileEntry[] {
  const result = store.readFiles(card.diskId);
  if (!result.ok) throw storeFailure(result.error.code);
  return result.value === null ? [] : result.value.entries;
}

/**
 * Cuts `text` to at most `maxBytes` bytes of UTF-8 without splitting a code point.
 * `truncated` is true only when the cut removed something.
 */
export function truncateUtf8(
  text: string,
  maxBytes: number = MAX_PREVIEW_BYTES,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  // Step back while the first excluded byte is a continuation byte (inside a code point).
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString("utf8"), truncated: true };
}

function viewWarnings(warnings: readonly ExhumeWarning[]): PreviewWarning[] {
  return warnings.slice(0, MAX_PREVIEW_WARNINGS).map((w) => {
    const out: PreviewWarning = {
      code: displayName(w.code),
      message: redactPaths(displayName(w.message)),
    };
    if (w.path !== undefined) out.path = displayName(w.path);
    return out;
  });
}

function toolErrorCode(err: unknown): string {
  if (err instanceof ExhumeToolError && TOOL_CODE.test(err.code)) return err.code;
  if (err instanceof ExhumeClientError) return err.code;
  return "EXHUME_FAILED";
}

/**
 * Reads an exhumed PNG from `<root>/exhumed` read-only. Returns null for anything
 * unusual: outside the folder, a symlink, not a regular file, too large, not a PNG.
 */
export async function readExhumedPng(root: string, outputPath: string): Promise<string | null> {
  try {
    const exhumedDir = path.join(root, EXHUMED_DIR);
    const abs = path.resolve(root, outputPath);
    if (!(await isWithin(exhumedDir, abs))) return null;
    const linkInfo = await lstat(abs);
    if (!linkInfo.isFile()) return null;
    const handle = await open(abs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_DATA_BYTES) return null;
      const buf = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < info.size) {
        const { bytesRead } = await handle.read(buf, offset, info.size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== info.size) return null;
      if (!buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
      return `data:image/png;base64,${buf.toString("base64")}`;
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function parseLibraryBody(body: Uint8Array): string {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new ApiError("BAD_REQUEST", 400);
  }
  if (!isRecord(value)) throw new ApiError("BAD_REQUEST", 400);
  const p = value["path"];
  if (typeof p !== "string" || p.trim() === "" || p.length > MAX_LIBRARY_PATH_CHARS) {
    throw new ApiError("BAD_REQUEST", 400);
  }
  return p;
}

// ------------------------------------------------------------ route table

export function createRoutes(deps: RouteDeps): Route[] {
  const { store, scanner, library, exhume, clock } = deps;

  const getLibrary: Route["handler"] = () => {
    const s = library.getStatus();
    return Promise.resolve(json(200, { path: s.path, error: s.error }));
  };

  const putLibrary: Route["handler"] = async ({ body }) => {
    const requested = parseLibraryBody(body);
    const s = await library.setLibrary(requested);
    return json(200, { path: s.path, error: s.error });
  };

  const useDemo: Route["handler"] = async () => {
    const typed = library.getStatus().path;
    const result = await deps.copyDemo(typed);
    if (library.getRealPath() === null) {
      // First valid library: activate it (validates, persists, restarts Exhume, scans).
      await library.setLibrary(typed);
    } else {
      scanner.triggerScan();
    }
    return json(200, { copied: [...result.copied], skipped: [...result.skipped] });
  };

  const scanStatus: Route["handler"] = () => Promise.resolve(json(200, scanner.getStatus()));

  const rescan: Route["handler"] = () => {
    const r = scanner.triggerScan();
    return Promise.resolve(json(202, { started: r.started, running: r.running }));
  };

  const listDisks: Route["handler"] = () => {
    const data = readCatalogue(store);
    return Promise.resolve(json(200, { disks: allViews(data) }));
  };

  const oneDisk: Route["handler"] = ({ params }) => {
    const data = readCatalogue(store);
    const card = requireCard(data, params["id"]);
    const files = readEntries(store, card);
    return Promise.resolve(
      json(200, {
        card: toCardView(card, data.annotations[card.diskId]),
        files,
        truncated: card.entriesTruncated,
        totalEntries: card.totalEntries,
      }),
    );
  };

  const preview: Route["handler"] = async ({ params, query }) => {
    const data = readCatalogue(store);
    const card = requireCard(data, params["id"]);
    const entryId = parseEntryId(query["entry"]);
    if (entryId === null) throw new ApiError("BAD_PARAMETER", 400);
    const entry = readEntries(store, card).find((e) => e.id === entryId);
    if (entry === undefined) throw new ApiError("NOT_FOUND", 404);
    if (entry.kind !== "file") throw new ApiError("BAD_REQUEST", 400);

    let grave;
    try {
      grave = await exhume.readGrave(card.relPath, entry.path, entry.id);
    } catch (err) {
      const timedOut = err instanceof ExhumeClientError && err.code === "EXHUME_TIMEOUT";
      throw new ApiError("PREVIEW_UNAVAILABLE", timedOut ? 504 : 502);
    }

    if (grave.format === "png") {
      let imageDataUrl: string | null = null;
      const record = data.exhumed[card.diskId]?.[String(entry.id)];
      const root = library.getRealPath();
      if (record !== undefined && root !== null) {
        imageDataUrl = await readExhumedPng(root, record.outputPath);
      }
      const body: PreviewResponse = {
        kind: "png",
        width: grave.width,
        height: grave.height,
        bytes: grave.bytes,
        imageDataUrl,
        warnings: viewWarnings(grave.warnings),
      };
      return json(200, body);
    }

    const cut = truncateUtf8(grave.text);
    const body: PreviewResponse = {
      kind: "text",
      format: grave.format,
      text: cut.text,
      truncated: grave.truncated || cut.truncated,
      warnings: viewWarnings(grave.warnings),
    };
    return json(200, body);
  };

  const exhumeAll: Route["handler"] = async ({ params }) => {
    const data = readCatalogue(store);
    const card = requireCard(data, params["id"]);

    const currentHash = await deps.hashImage(card.relPath, card.sizeBytes);
    if (currentHash !== card.diskId) {
      scanner.triggerScan();
      throw new ApiError("DISK_CHANGED", 409);
    }

    // Recoverable_Entry: a live file or a deleted file graded `recovered`. Nothing else is called.
    const recoverable = readEntries(store, card).filter(
      (e) => e.kind === "file" && (e.state === "alive" || e.state === "recovered"),
    );

    const results: ExhumeOutcome[] = [];
    const saved: { entry: number; outputPath: string }[] = [];
    for (const entry of recoverable) {
      const shown = displayName(entry.path);
      try {
        const out = await exhume.exhume(card.relPath, entry.path, entry.id);
        const outputPath = displayName(out.path);
        results.push({ entry: entry.id, path: shown, outcome: "exhumed", outputPath });
        saved.push({ entry: entry.id, outputPath: out.path });
      } catch (err) {
        results.push({ entry: entry.id, path: shown, outcome: "failed", errorCode: toolErrorCode(err) });
      }
    }

    if (saved.length > 0) {
      const at = new Date(clock.now()).toISOString();
      // Outputs already exist on disk; a failed bookkeeping write must not hide the results.
      store.update((draft) => {
        const forDisk = draft.exhumed[card.diskId] ?? {};
        for (const s of saved) forDisk[String(s.entry)] = { outputPath: s.outputPath, at };
        draft.exhumed[card.diskId] = forDisk;
      });
    }
    return json(200, { results });
  };

  const exportCsv: Route["handler"] = () => {
    const body = toCsv(allViews(readCatalogue(store)));
    return Promise.resolve<RouteResult>({
      kind: "text",
      status: 200,
      contentType: "text/csv; charset=utf-8",
      fileName: "exhume-catalogue.csv",
      body,
    });
  };

  const exportMarkdown: Route["handler"] = () => {
    const body = toMarkdown(allViews(readCatalogue(store)));
    return Promise.resolve<RouteResult>({
      kind: "text",
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      fileName: "exhume-catalogue.md",
      body,
    });
  };

  return [
    { method: "GET", pattern: ["api", "library"], query: [], handler: getLibrary },
    { method: "PUT", pattern: ["api", "library"], query: [], handler: putLibrary },
    { method: "POST", pattern: ["api", "library", "demo"], query: [], handler: useDemo },
    { method: "GET", pattern: ["api", "scan"], query: [], handler: scanStatus },
    { method: "POST", pattern: ["api", "scan"], query: [], handler: rescan },
    { method: "GET", pattern: ["api", "disks"], query: [], handler: listDisks },
    { method: "GET", pattern: ["api", "disks", ":id"], query: [], handler: oneDisk },
    { method: "GET", pattern: ["api", "disks", ":id", "preview"], query: ["entry"], handler: preview },
    { method: "POST", pattern: ["api", "disks", ":id", "exhume-all"], query: [], handler: exhumeAll },
    { method: "GET", pattern: ["api", "export", "csv"], query: [], handler: exportCsv },
    { method: "GET", pattern: ["api", "export", "markdown"], query: [], handler: exportMarkdown },
  ];
}

// ---------------------------------------------------------------- matching

export type MatchResult =
  | { readonly kind: "match"; readonly route: Route; readonly params: Record<string, string> }
  | { readonly kind: "method"; readonly allow: readonly string[] }
  | { readonly kind: "none" };

/** Finds the route for decoded path segments. Distinguishes "no such path" from "wrong method". */
export function matchRoute(
  routes: readonly Route[],
  method: string,
  segments: readonly string[],
): MatchResult {
  const allow: string[] = [];
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = Object.create(null) as Record<string, string>;
    let fits = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const want = route.pattern[i];
      const got = segments[i];
      if (want === undefined || got === undefined) {
        fits = false;
        break;
      }
      if (want.startsWith(":")) params[want.slice(1)] = got;
      else if (want !== got) {
        fits = false;
        break;
      }
    }
    if (!fits) continue;
    if (route.method === method) return { kind: "match", route, params };
    allow.push(route.method);
  }
  return allow.length > 0 ? { kind: "method", allow } : { kind: "none" };
}

/** Every query name any route accepts (the server's parameter guard needs one list up front). */
export function allQueryNames(routes: readonly Route[]): string[] {
  return [...new Set(routes.flatMap((r) => r.query))];
}
