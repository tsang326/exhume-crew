/**
 * Catalogue exports. Each builder returns one complete string; any failure becomes
 * a 500 EXPORT_FAILED and no partial content is ever produced (Requirement 8.8).
 */
import { ApiError } from "./errors";
import { buildCsv } from "../../src/shared/csv";
import { displayName } from "../../src/shared/sanitize";
import type { DiskCardView } from "../../src/shared/schema";

const MARKDOWN_TITLE = "# Exhume Crew catalogue";

/**
 * Escapes untrusted text for Markdown. Only characters that can start or change structure are
 * escaped: backslash, backtick, `*`, `_`, `[`, `]`, `<`, `>`, `|`, and at the start of the text
 * `#`, `-`, `+`, `=`, `~` or digits followed by `.`/`)`. Control characters and line breaks are
 * removed or collapsed to one space first, so the result is always a single line.
 */
function escapeMarkdown(value: string): string {
  const flat = displayName(value).trim();
  return flat
    .replace(/[\\`*_[\]<>|]/g, "\\$&")
    .replace(/^([-+#=~])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function factsLine(card: DiskCardView): string {
  const facts = [formatSize(card.sizeBytes)];
  const geometry = card.geometry.label ?? "";
  facts.push(`geometry ${escapeMarkdown(geometry !== "" ? geometry : card.geometry.source)}`);
  facts.push(`${card.fileCount} files`);
  const first = card.dateFirst === null ? "" : escapeMarkdown(card.dateFirst);
  const last = card.dateLast === null ? "" : escapeMarkdown(card.dateLast);
  if (first !== "" && last !== "" && first !== last) facts.push(`${first} to ${last}`);
  else if (first !== "" || last !== "") facts.push(first !== "" ? first : last);
  const c = card.counts;
  facts.push(`${c.recovered} recovered, ${c.partial} partial, ${c.lost} lost`);
  return facts.join(" · ");
}

function markdownSection(card: DiskCardView): string {
  const label = escapeMarkdown(card.label);
  const relPath = escapeMarkdown(card.relPath);
  const heading = label === "" ? relPath : relPath === "" || relPath === label ? label : `${label} (${relPath})`;
  const blocks: string[] = [`## ${heading}`, factsLine(card)];
  const warnings = card.warnings
    .map((w) => escapeMarkdown(`${w.code}: ${w.message}`))
    .filter((w) => w !== "");
  if (warnings.length > 0) blocks.push(["Warnings:", ...warnings.map((w) => `- ${w}`)].join("\n"));
  const summary = escapeMarkdown(card.summary?.text ?? "");
  if (summary !== "") blocks.push(summary);
  const notes = card.notes.map((n) => escapeMarkdown(n.text)).filter((n) => n !== "");
  if (notes.length > 0) blocks.push(["Notes:", ...notes.map((n) => `- ${n}`)].join("\n"));
  blocks.push(`<sub>\`${card.diskId.replace(/[^0-9a-zA-Z]/g, "")}\`</sub>`);
  return blocks.join("\n\n");
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
