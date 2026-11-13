/**
 * CSV building for the catalogue export (RFC 4180). Pure functions, no I/O.
 */
import type { DiskCardView } from "./schema";
import { cellText } from "./sanitize";

/** Fixed, ordered column names. Identical on every export (Requirement 8.1). */
export const CSV_COLUMNS = [
  "diskId",
  "relPath",
  "label",
  "sizeBytes",
  "geometrySource",
  "geometryLabel",
  "fileCount",
  "totalEntries",
  "entriesTruncated",
  "dateFirst",
  "dateLast",
  "formats",
  "alive",
  "recovered",
  "partial",
  "lost",
  "warnings",
  "status",
  "firstSeen",
  "summary",
  "notes",
] as const;

/** Raw (unsanitised) exported values of one card, in `CSV_COLUMNS` order. */
export function cardValues(card: DiskCardView): string[] {
  return [
    card.diskId,
    card.relPath,
    card.label,
    String(card.sizeBytes),
    card.geometry.source,
    card.geometry.label ?? "",
    String(card.fileCount),
    String(card.totalEntries),
    card.entriesTruncated ? "true" : "false",
    card.dateFirst ?? "",
    card.dateLast ?? "",
    card.formats.join(" "),
    String(card.counts.alive),
    String(card.counts.recovered),
    String(card.counts.partial),
    String(card.counts.lost),
    card.warnings.map((w) => `${w.code}: ${w.message}`).join("\n"),
    card.status,
    card.firstSeen,
    card.summary?.text ?? "",
    card.notes.map((n) => n.text).join("\n"),
  ];
}

/** Quotes a field when it contains a comma, a double quote, CR or LF; doubles embedded quotes. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One CSV row (without line terminator); every cell passes `cellText` first. */
export function csvRow(values: readonly string[]): string {
  return values.map((v) => csvField(cellText(v))).join(",");
}

/** Complete CSV text: header plus one row per card, each row ending in CRLF. */
export function buildCsv(cards: readonly DiskCardView[]): string {
  const lines: string[] = [csvRow(CSV_COLUMNS)];
  for (const card of cards) lines.push(csvRow(cardValues(card)));
  return lines.join("\r\n") + "\r\n";
}
