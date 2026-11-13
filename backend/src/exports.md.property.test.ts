import { describe, it } from "vitest";
import fc from "fast-check";
import { toMarkdown } from "./exports";
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
// Characters that can change inline structure; must all be escaped in untrusted text.
const INLINE_STRUCTURE = /[\\`*_[\]<>|]/;
// Text that would begin a block (heading, list, quote, fence, setext underline, indented code).
const BLOCK_START = /^(\s|[#>+=~-]|\d+[.)](\s|$))/;

/** True when a single untrusted-text line cannot form inline or block Markdown. */
function inertText(text: string): boolean {
  return !INLINE_STRUCTURE.test(text.replace(ESCAPED_PAIR, "")) && !BLOCK_START.test(text) && !text.includes("\n");
}

/** Checks one section's blocks (separated by blank lines) against its card. */
function sectionOk(block: string[], c: DiskCardView): boolean {
  const [heading, facts, ...rest] = block;
  if (heading === undefined || facts === undefined) return false;
  if (!heading.startsWith("## ") || heading.includes("\n")) return false;
  if (!inertText(heading.slice(3).replace(" (", " ").replace(/\)$/, ""))) return false;
  if (!/^(\d+ bytes|[\d.]+ (KiB|MiB)) · /.test(facts) || facts.includes("\n")) return false;
  const last = rest[rest.length - 1] ?? "";
  if (last !== `<sub>\`${c.diskId}\`</sub>`) return false;
  return rest.slice(0, -1).every((part) => {
    const lines = part.split("\n");
    return lines.every((line, i) => {
      if ((line === "Warnings:" || line === "Notes:") && i === 0 && lines.length > 1) return true;
      const body = lines.length > 1 && i > 0 ? (line.startsWith("- ") ? line.slice(2) : null) : line;
      return body !== null && inertText(body);
    });
  });
}

function structureOk(list: DiskCardView[]): boolean {
  const out = toMarkdown(list);
  if (BAD_CONTROL.test(out) || !out.endsWith("\n")) return false;
  const body = out.slice(0, -1);
  const blocks = body.split("\n\n");
  if (blocks[0] !== TITLE) return false;
  const lines = body.split("\n");
  // Every line that begins with "#" is the title or a section heading (no injected headings).
  if (lines.filter((l) => l.startsWith("#")).length !== 1 + list.length) return false;
  if (list.length === 0) return lines.length === 1;
  const sections: string[][] = [];
  for (const b of blocks.slice(1)) {
    if (b.startsWith("## ")) sections.push([b]);
    else sections[sections.length - 1]?.push(b);
  }
  if (sections.length !== list.length) return false;
  return list.every((c, i) => sectionOk(sections[i] ?? [], c));
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
