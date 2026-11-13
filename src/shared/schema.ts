/**
 * Data model and hand-written validators for the catalogue.
 *
 * All guards take `unknown` and never throw. They check shape and caps only;
 * text sanitising is done by `sanitize.ts` before data reaches the Store.
 */

export const CAPS = {
  warnings: 100,
  libraryWarnings: 200,
  notes: 100,
  summary: 1200, // code points
  note: 500, // code points
  relPath: 4096,
  label: 255,
  reason: 200,
} as const;

export const SCHEMA_VERSION = 1 as const;

export type Status = "new" | "catalogued" | "summarised";
export type GraveState = "alive" | "recovered" | "partial" | "lost";
export type FormatFamily = "markdown" | "csv" | "png" | "text";
export type AgentName = "exhume-archivist" | "exhume-undertaker";

export interface CardWarning {
  code: string;
  message: string;
  path?: string;
}

export interface Geometry {
  source: "bpb" | "fallback" | "none";
  label: string | null;
}

export interface DiskCard {
  diskId: string;
  relPath: string;
  label: string;
  sizeBytes: number;
  geometry: Geometry;
  fileCount: number;
  totalEntries: number;
  entriesTruncated: boolean;
  dateFirst: string | null;
  dateLast: string | null;
  formats: FormatFamily[];
  counts: Record<GraveState, number>;
  warnings: CardWarning[];
  status: Status;
  firstSeen: string;
}

export interface FileEntry {
  id: number;
  path: string;
  kind: "file" | "directory";
  state: GraveState;
  size: number;
  date: string | null;
  reason?: string;
}

export interface FilesDoc {
  schemaVersion: 1;
  diskId: string;
  totalEntries: number;
  truncated: boolean;
  entries: FileEntry[];
}

export interface Summary {
  text: string;
  savedAt: string;
  agent: AgentName;
}

export interface Note {
  id: string;
  text: string;
  savedAt: string;
  agent: AgentName;
}

export interface Annotation {
  summary: Summary | null;
  notes: Note[];
}

export interface ExhumedRecord {
  outputPath: string;
  at: string;
}

export interface PathRecord {
  diskId: string;
  firstSeen: string;
}

export interface CatalogueData {
  schemaVersion: 1;
  paths: Record<string, PathRecord>;
  cards: Record<string, DiskCard>;
  annotations: Record<string, Annotation>;
  exhumed: Record<string, Record<string, ExhumedRecord>>;
}

export interface ScanStatus {
  state: "idle" | "running" | "failed";
  scanned: number;
  total: number;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  libraryWarnings: CardWarning[];
}

export interface DiskCardView extends DiskCard {
  summary: Summary | null;
  notes: Note[];
}

// ---------------------------------------------------------------- helpers

const STATUSES: readonly string[] = ["new", "catalogued", "summarised"];
const GRAVE_STATES: readonly GraveState[] = ["alive", "recovered", "partial", "lost"];
const FORMATS: readonly string[] = ["markdown", "csv", "png", "text"];
const AGENTS: readonly string[] = ["exhume-archivist", "exhume-undertaker"];
const GEOMETRY_SOURCES: readonly string[] = ["bpb", "fallback", "none"];
const SCAN_STATES: readonly string[] = ["idle", "running", "failed"];
const DISK_ID = /^[0-9a-f]{64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/** Length in Unicode code points (lone surrogates count as one each). */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) {
    void _;
    n++;
  }
  return n;
}

function hasOnlyKeys(v: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(v).every((k) => allowed.includes(k));
}

export function isDiskId(v: unknown): v is string {
  return typeof v === "string" && DISK_ID.test(v);
}

// ------------------------------------------------------------------ guards

export function isCardWarning(v: unknown): v is CardWarning {
  if (!isRecord(v)) return false;
  if (!hasOnlyKeys(v, ["code", "message", "path"])) return false;
  if (typeof v["code"] !== "string" || typeof v["message"] !== "string") return false;
  return v["path"] === undefined || typeof v["path"] === "string";
}

function isWarningList(v: unknown, cap: number): v is CardWarning[] {
  return Array.isArray(v) && v.length <= cap && v.every(isCardWarning);
}

function isGeometry(v: unknown): v is Geometry {
  return (
    isRecord(v) &&
    typeof v["source"] === "string" &&
    GEOMETRY_SOURCES.includes(v["source"]) &&
    isNullableString(v["label"])
  );
}

function isCounts(v: unknown): v is Record<GraveState, number> {
  return isRecord(v) && GRAVE_STATES.every((s) => isCount(v[s]));
}

export function isFormatFamily(v: unknown): v is FormatFamily {
  return typeof v === "string" && FORMATS.includes(v);
}

export function isDiskCard(v: unknown): v is DiskCard {
  if (!isRecord(v)) return false;
  if (!isDiskId(v["diskId"])) return false;
  if (typeof v["relPath"] !== "string" || v["relPath"].length > CAPS.relPath) return false;
  if (typeof v["label"] !== "string" || v["label"].length > CAPS.label) return false;
  if (!isCount(v["sizeBytes"]) || !isCount(v["fileCount"]) || !isCount(v["totalEntries"])) {
    return false;
  }
  if (!isGeometry(v["geometry"])) return false;
  if (typeof v["entriesTruncated"] !== "boolean") return false;
  if (!isNullableString(v["dateFirst"]) || !isNullableString(v["dateLast"])) return false;
  const formats = v["formats"];
  if (!Array.isArray(formats) || !formats.every(isFormatFamily)) return false;
  if (!isCounts(v["counts"])) return false;
  if (!isWarningList(v["warnings"], CAPS.warnings)) return false;
  if (typeof v["status"] !== "string" || !STATUSES.includes(v["status"])) return false;
  return typeof v["firstSeen"] === "string";
}

export function isFileEntry(v: unknown): v is FileEntry {
  if (!isRecord(v)) return false;
  if (!isCount(v["id"])) return false;
  if (typeof v["path"] !== "string" || v["path"].length > CAPS.relPath) return false;
  if (v["kind"] !== "file" && v["kind"] !== "directory") return false;
  if (typeof v["state"] !== "string" || !(GRAVE_STATES as readonly string[]).includes(v["state"])) {
    return false;
  }
  if (!isCount(v["size"]) || !isNullableString(v["date"])) return false;
  const reason = v["reason"];
  return reason === undefined || (typeof reason === "string" && reason.length <= CAPS.reason);
}

export function isFilesDoc(v: unknown): v is FilesDoc {
  return (
    isRecord(v) &&
    v["schemaVersion"] === SCHEMA_VERSION &&
    isDiskId(v["diskId"]) &&
    isCount(v["totalEntries"]) &&
    typeof v["truncated"] === "boolean" &&
    Array.isArray(v["entries"]) &&
    v["entries"].every(isFileEntry)
  );
}

function isAgent(v: unknown): v is AgentName {
  return typeof v === "string" && AGENTS.includes(v);
}

export function isSummary(v: unknown): v is Summary {
  return (
    isRecord(v) &&
    typeof v["text"] === "string" &&
    codePointLength(v["text"]) <= CAPS.summary &&
    typeof v["savedAt"] === "string" &&
    isAgent(v["agent"])
  );
}

export function isNote(v: unknown): v is Note {
  return (
    isRecord(v) &&
    typeof v["id"] === "string" &&
    typeof v["text"] === "string" &&
    codePointLength(v["text"]) <= CAPS.note &&
    typeof v["savedAt"] === "string" &&
    isAgent(v["agent"])
  );
}

export function isAnnotation(v: unknown): v is Annotation {
  return (
    isRecord(v) &&
    (v["summary"] === null || isSummary(v["summary"])) &&
    Array.isArray(v["notes"]) &&
    v["notes"].length <= CAPS.notes &&
    v["notes"].every(isNote)
  );
}

function isExhumedRecord(v: unknown): v is ExhumedRecord {
  return isRecord(v) && typeof v["outputPath"] === "string" && typeof v["at"] === "string";
}

function isPathRecord(v: unknown): v is PathRecord {
  return isRecord(v) && isDiskId(v["diskId"]) && typeof v["firstSeen"] === "string";
}

function everyValue(v: Record<string, unknown>, test: (x: unknown) => boolean): boolean {
  return Object.keys(v).every((k) => test(v[k]));
}

export function isCatalogueData(v: unknown): v is CatalogueData {
  if (!isRecord(v) || v["schemaVersion"] !== SCHEMA_VERSION) return false;
  const { paths, cards, annotations, exhumed } = v;
  if (!isRecord(paths) || !isRecord(cards) || !isRecord(annotations) || !isRecord(exhumed)) {
    return false;
  }
  if (!Object.keys(paths).every((k) => k.length <= CAPS.relPath)) return false;
  if (!everyValue(paths, isPathRecord)) return false;
  if (!Object.keys(cards).every((k) => isDiskId(k) && isDiskCard(cards[k]) && (cards[k] as DiskCard).diskId === k)) {
    return false;
  }
  if (!Object.keys(annotations).every((k) => isDiskId(k) && isAnnotation(annotations[k]))) {
    return false;
  }
  return Object.keys(exhumed).every((k) => {
    const inner = exhumed[k];
    return isDiskId(k) && isRecord(inner) && everyValue(inner, isExhumedRecord);
  });
}

export function isScanStatus(v: unknown): v is ScanStatus {
  if (!isRecord(v)) return false;
  if (typeof v["state"] !== "string" || !SCAN_STATES.includes(v["state"])) return false;
  if (!isCount(v["scanned"]) || !isCount(v["total"])) return false;
  const err = v["error"];
  if (
    err !== null &&
    !(isRecord(err) && typeof err["code"] === "string" && typeof err["message"] === "string")
  ) {
    return false;
  }
  return (
    isNullableString(v["startedAt"]) &&
    isNullableString(v["finishedAt"]) &&
    isWarningList(v["libraryWarnings"], CAPS.libraryWarnings)
  );
}

export function isDiskCardView(v: unknown): v is DiskCardView {
  return (
    isDiskCard(v) &&
    isRecord(v) &&
    (v["summary"] === null || isSummary(v["summary"])) &&
    Array.isArray(v["notes"]) &&
    v["notes"].length <= CAPS.notes &&
    v["notes"].every(isNote)
  );
}
