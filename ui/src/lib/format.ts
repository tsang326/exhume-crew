/**
 * Pure display helpers shared by the disk page and (task 22.4) the library cards.
 * Every function returns plain strings that callers render as React text children.
 */
import type { Geometry } from "../../../src/shared/schema";

/** Human size: bytes below 1 KB, then KB and MB with one decimal (1024 based). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`;
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/;

/** Date part only (`1990-11-19`). Odd values pass through trimmed; empty or non-strings give null. */
export function formatDateOnly(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  const m = ISO_DATE.exec(t);
  return m !== null ? (m[1] ?? t) : t;
}

/** Date and minutes (`1991-06-28 16:45`); date only when there is no time. Odd values pass through. */
export function formatDateTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  const m = ISO_DATE.exec(t);
  if (m === null) return t;
  return m[2] !== undefined && m[3] !== undefined ? `${m[1]} ${m[2]}:${m[3]}` : (m[1] ?? t);
}

/** "first to last" as dates only, the single date when both match, one side when only one is known, else null. */
export function formatDateRange(first: string | null, last: string | null): string | null {
  const a = formatDateOnly(first);
  const b = formatDateOnly(last);
  if (a !== null && b !== null) return a === b ? a : `${a} to ${b}`;
  return a ?? b;
}

/** Geometry text: the BPB or fallback label, or "unknown geometry". */
export function formatGeometry(g: Geometry): string {
  return g.source !== "none" && g.label !== null && g.label !== "" ? g.label : "unknown geometry";
}

export function formatFileCount(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

/**
 * The conversion Exhume applies, guessed from the file extension with the same extension list
 * the converter uses as its fallback (the catalogue stores no per-file format). Null when the
 * extension is not one the converter knows.
 */
export function conversionFor(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  switch (path.slice(dot + 1).toUpperCase()) {
    case "WS":
    case "WS4":
    case "WS5":
    case "WS6":
    case "WS7":
    case "WSD":
      return "WordStar -> Markdown";
    case "DBF":
      return "dBase -> CSV";
    case "PCX":
      return "PCX -> PNG";
    case "TXT":
    case "BAT":
    case "ASC":
    case "LOG":
    case "NFO":
    case "DIZ":
    case "1ST":
    case "ME":
      return "text";
    default:
      return null;
  }
}
