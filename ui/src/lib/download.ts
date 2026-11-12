/**
 * Download helper. The Blob type comes from a fixed table, never from the response, and the
 * file name always passes through `sanitizeFileName` (Requirements 15.7, 15.8).
 */
import { sanitizeFileName } from "../../../src/shared/sanitize";

export type DownloadKind = "csv" | "markdown" | "binary";

const MIME: Record<DownloadKind, string> = {
  csv: "text/csv",
  markdown: "text/markdown",
  binary: "application/octet-stream",
};

export function mimeFor(kind: DownloadKind): string {
  return MIME[kind];
}

export function makeDownloadBlob(kind: DownloadKind, data: BlobPart): Blob {
  return new Blob([data], { type: MIME[kind] });
}

/** Saves `data` as a file through a temporary object URL and anchor click. */
export function saveBlob(kind: DownloadKind, data: BlobPart, fileName: string): void {
  const blob = makeDownloadBlob(kind, data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFileName(fileName);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
