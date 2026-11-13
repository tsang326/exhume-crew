/**
 * Pure Disk_Card derivation, status rules and the card/summary/notes merge.
 *
 * Inputs are structural types that the backend's `OpenDiskReport` satisfies,
 * so this module has no dependency on backend code (Requirements 5.5, 5.9).
 */
import { CAPS } from "./schema";
import type {
  Annotation,
  CardWarning,
  DiskCard,
  DiskCardView,
  FormatFamily,
  GraveState,
  Geometry,
  Status,
} from "./schema";

/** Minimal structural view of an `open_disk` report entry. */
export interface ReportEntry {
  kind: "file" | "directory";
  date: string | null;
}

/** Minimal structural view of an `open_disk` report. */
export interface ReportInput {
  volume: { label: string; geometrySource: Geometry["source"] };
  totalEntries: number;
  counts: Record<GraveState, number>;
  entries: readonly ReportEntry[];
  truncated: boolean;
  warnings: readonly CardWarning[];
}

export interface DeriveCardInput {
  diskId: string;
  relPath: string;
  sizeBytes: number;
  firstSeen: string;
  report: ReportInput;
  /** Formats returned by successful `read_grave` calls during the scan. */
  formats?: readonly FormatFamily[];
  /** Warnings added by the scanner itself (after the report's own). */
  scannerWarnings?: readonly CardWarning[];
  /** Whether a Summary already exists for this Disk_Id. */
  hasSummary?: boolean;
}

const GEOMETRY_LABELS: ReadonlyMap<number, string> = new Map([
  [368_640, "360K"],
  [737_280, "720K"],
  [1_228_800, "1.2M"],
  [1_474_560, "1.44M"],
  [2_949_120, "2.88M"],
]);

/** Floppy size name derived only from the image size in bytes, else `null`. */
export function geometryLabel(sizeBytes: number): string | null {
  return GEOMETRY_LABELS.get(sizeBytes) ?? null;
}

/** Sorted, unique union of format families. */
export function mergeFormats(
  ...lists: ReadonlyArray<readonly FormatFamily[]>
): FormatFamily[] {
  const seen = new Set<FormatFamily>();
  for (const list of lists) for (const f of list) seen.add(f);
  return [...seen].sort();
}

/** Earliest and latest non-null date over file entries; both `null` when none. */
export function dateRange(entries: readonly ReportEntry[]): {
  dateFirst: string | null;
  dateLast: string | null;
} {
  let dateFirst: string | null = null;
  let dateLast: string | null = null;
  for (const e of entries) {
    if (e.kind !== "file" || e.date === null) continue;
    if (dateFirst === null || e.date < dateFirst) dateFirst = e.date;
    if (dateLast === null || e.date > dateLast) dateLast = e.date;
  }
  return { dateFirst, dateLast };
}

/** Report warnings followed by scanner warnings, capped at `CAPS.warnings`. */
export function mergeWarnings(
  report: readonly CardWarning[],
  scanner: readonly CardWarning[] = [],
): CardWarning[] {
  const out: CardWarning[] = [];
  for (const w of [...report, ...scanner]) {
    if (out.length >= CAPS.warnings) break;
    out.push(w.path === undefined ? { code: w.code, message: w.message } : { code: w.code, message: w.message, path: w.path });
  }
  return out;
}

/**
 * Card_Status: `new` before the card is stored, `catalogued` once stored,
 * `summarised` once a Summary exists (a Summary wins over everything).
 */
export function cardStatus(opts: { stored: boolean; hasSummary: boolean }): Status {
  if (opts.hasSummary) return "summarised";
  return opts.stored ? "catalogued" : "new";
}

/**
 * Derives the card the Scanner stores. The card is returned already stored,
 * so its status is `catalogued`, or `summarised` when a Summary exists.
 */
export function deriveCard(input: DeriveCardInput): DiskCard {
  const { report } = input;
  const { dateFirst, dateLast } = dateRange(report.entries);
  return {
    diskId: input.diskId,
    relPath: input.relPath,
    label: Array.from(report.volume.label).slice(0, CAPS.label).join(""),
    sizeBytes: input.sizeBytes,
    geometry: { source: report.volume.geometrySource, label: geometryLabel(input.sizeBytes) },
    fileCount: report.entries.filter((e) => e.kind === "file").length,
    totalEntries: report.totalEntries,
    entriesTruncated: report.truncated,
    dateFirst,
    dateLast,
    formats: mergeFormats(input.formats ?? []),
    counts: {
      alive: report.counts.alive,
      recovered: report.counts.recovered,
      partial: report.counts.partial,
      lost: report.counts.lost,
    },
    warnings: mergeWarnings(report.warnings, input.scannerWarnings),
    status: cardStatus({ stored: true, hasSummary: input.hasSummary === true }),
    firstSeen: input.firstSeen,
  };
}

/** Merges a stored card with its annotation into the view served to clients. */
export function toCardView(card: DiskCard, annotation: Annotation | undefined): DiskCardView {
  const summary = annotation?.summary ?? null;
  return {
    ...card,
    status: cardStatus({ stored: true, hasSummary: summary !== null }),
    summary,
    notes: annotation?.notes ?? [],
  };
}
