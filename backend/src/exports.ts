/**
 * Catalogue exports. Each builder returns one complete string; any failure becomes
 * a 500 EXPORT_FAILED and no partial content is ever produced (Requirement 8.8).
 */
import { ApiError } from "./errors";
import { CSV_COLUMNS, buildCsv, cardValues } from "../../src/shared/csv";
import { displayName } from "../../src/shared/sanitize";
import type { DiskCardView } from "../../src/shared/schema";

const MARKDOWN_TITLE = "# Exhume Crew catalogue";

/** Backslash-escapes every ASCII punctuation character so text cannot form Markdown or HTML. */
function escapeMarkdown(value: string): string {
  return displayName(value).replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

function markdownSection(card: DiskCardView): string {
  const values = cardValues(card);
  const heading = escapeMarkdown(card.label !== "" ? card.label : card.relPath);
  const lines = [`## ${heading} (${card.diskId.slice(0, 12)})`, ""];
  CSV_COLUMNS.forEach((column, i) => {
    // Multi-line fields (warnings, notes) become one line: line breaks turn into spaces.
    lines.push(`- ${column}: ${escapeMarkdown(values[i] ?? "")}`);
  });
  return lines.join("\n");
}

/** Builds the whole CSV export, or throws EXPORT_FAILED. */
export function toCsv(cards: readonly DiskCardView[]): string {
  try {
    return buildCsv(cards);
  } catch {
    throw new ApiError("EXPORT_FAILED", 500);
  }
}

/** Builds the whole Markdown export, or throws EXPORT_FAILED. */
export function toMarkdown(cards: readonly DiskCardView[]): string {
  try {
    const parts: string[] = [MARKDOWN_TITLE];
    for (const card of cards) parts.push(markdownSection(card));
    return parts.join("\n\n") + "\n";
  } catch {
    throw new ApiError("EXPORT_FAILED", 500);
  }
}
