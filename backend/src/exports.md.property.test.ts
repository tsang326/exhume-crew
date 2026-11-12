import { describe, it } from "vitest";
import fc from "fast-check";
import { toMarkdown } from "./exports";
import { CSV_COLUMNS } from "../../src/shared/csv";
import type { DiskCardView } from "../../src/shared/schema";

// Feature: crew-app, Property 24: Markdown export structure
// **Validates: Requirements 8.2, 8.6, 8.7**

const NUM_RUNS = 100;
const TITLE = "# Exhume Crew catalogue";

const nasty = fc.constantFrom(
  "# heading",
  "## h2",
  "[link](http://x.test)",
  "![img](http://x.test/a.png)",
  "<script>alert(1)</script>",
  "<b>",
  "\n# injected",
  "\r\n- item",
  "\u0000\u0007\u001b[31m",
  "\u0085\u009f\u007f",
  "\u2028\u2029\u202e\ufeff",
  "`code`",
  "\\",
  "> quote",
  "=cmd|' /C calc'!A0",
);
const text = fc.oneof(
  fc.string({ unit: "binary", maxLength: 30 }),
  fc.string({ unit: "grapheme-ascii", maxLength: 30 }),
  fc.array(nasty, { maxLength: 4 }).map((a) => a.join("")),
);
const date = fc.oneof(fc.constant(null), text);
const count = fc.nat(1000);
const hex = fc.stringMatching(/^[0-9a-f]{64}$/);

const card: fc.Arbitrary<DiskCardView> = fc.record({
  diskId: hex,
  relPath: text,
  label: text,
  sizeBytes: count,
  geometry: fc.record({
    source: fc.constantFrom<"bpb" | "fallback" | "none">("bpb", "fallback", "none"),
    label: date,
  }),
  fileCount: count,
  totalEntries: count,
  entriesTruncated: fc.boolean(),
  dateFirst: date,
  dateLast: date,
  formats: fc.subarray<"markdown" | "csv" | "png" | "text">(["markdown", "csv", "png", "text"]),
  counts: fc.record({ alive: count, recovered: count, partial: count, lost: count }),
  warnings: fc.array(
    fc.record({ code: text, message: text }),
    { maxLength: 3 },
  ),
  status: fc.constantFrom<"new" | "catalogued" | "summarised">("new", "catalogued", "summarised"),
  firstSeen: text,
  summary: fc.oneof(
    fc.constant(null),
    fc.record({ text, savedAt: text, agent: fc.constant<"exhume-archivist">("exhume-archivist") }),
  ),
  notes: fc.array(
    fc.record({
      id: text,
      text,
      savedAt: text,
      agent: fc.constant<"exhume-undertaker">("exhume-undertaker"),
    }),
    { maxLength: 3 },
  ),
});

const cards = fc.array(card, { maxLength: 8 });

// Control characters other than line feed.
const BAD_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
// An escaped pair: backslash followed by one ASCII punctuation character.
const ESCAPED_PAIR = /\\[!-/:-@[-`{-~]/g;
const PUNCTUATION = /[!-/:-@[-`{-~]/;

/** True when no ASCII punctuation remains once escaped pairs are removed. */
function fullyEscaped(fragment: string): boolean {
  return !PUNCTUATION.test(fragment.replace(ESCAPED_PAIR, ""));
}

/** Checks one section's lines against its card. */
function sectionOk(lines: string[], c: DiskCardView): boolean {
  if (lines.length !== 2 + CSV_COLUMNS.length) return false;
  const heading = lines[0] ?? "";
  const prefix = "## ";
  const suffix = ` (${c.diskId.slice(0, 12)})`;
  if (!heading.startsWith(prefix) || !heading.endsWith(suffix)) return false;
  const headingText = heading.slice(prefix.length, heading.length - suffix.length);
  if (!fullyEscaped(headingText)) return false;
  if (lines[1] !== "") return false;
  return CSV_COLUMNS.every((column, i) => {
    const line = lines[2 + i] ?? "";
    const lead = `- ${column}: `;
    return line.startsWith(lead) && fullyEscaped(line.slice(lead.length));
  });
}

function structureOk(list: DiskCardView[]): boolean {
  const out = toMarkdown(list);
  if (BAD_CONTROL.test(out) || !out.endsWith("\n")) return false;
  const lines = out.slice(0, -1).split("\n");
  if (lines[0] !== TITLE) return false;
  // Every line that begins with "#" is the title or a section heading (no injected headings).
  const hashLines = lines.filter((l) => l.startsWith("#"));
  if (hashLines.length !== 1 + list.length) return false;
  if (list.length === 0) return lines.length === 1;
  // Sections are separated by one blank line, so split on headings in card order.
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith("## ")) starts.push(i);
  });
  if (starts.length !== list.length) return false;
  return list.every((c, i) => {
    const from = starts[i] ?? 0;
    const to = i + 1 < starts.length ? (starts[i + 1] ?? lines.length) - 1 : lines.length;
    return sectionOk(lines.slice(from, to), c);
  });
}

describe("Feature: crew-app, Property 24: Markdown export structure", () => {
  it("has one title, one ordered section per card, no control characters and escaped text", () => {
    fc.assert(fc.property(cards, (list) => structureOk(list)), { numRuns: NUM_RUNS });
  });

  it("yields only the title for zero cards", () => {
    fc.assert(fc.property(fc.constant([] as DiskCardView[]), (list) => toMarkdown(list) === `${TITLE}\n`), {
      numRuns: NUM_RUNS,
    });
  });
});
