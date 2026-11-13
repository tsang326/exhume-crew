import { describe, it } from "vitest";
import fc from "fast-check";
import { parse } from "csv-parse/sync";
import { toCsv } from "./exports";
import { CSV_COLUMNS } from "../../src/shared/csv";
import type { DiskCardView } from "../../src/shared/schema";

// Feature: crew-app, Property 22: CSV round trip
// **Validates: Requirements 8.1, 8.3, 8.5, 8.7, 19.10**

const NUM_RUNS = 100;
const LARGE_TIMEOUT_MS = 180_000;

// ---- arbitrary hostile Unicode text -------------------------------------------------

const fragment = fc.constantFrom(
  ",", '"', '""', "\n", "\r", "\r\n", "\t", " ", "=", "+", "-", "@", "'",
  "\u0000", "\u0001", "\u001f", "\u007f", "\u0080", "\u009f", "\u2028", "\ufeff",
  "é", "日本", "😀", "\ud800", "\udc00", "x", "=1+1", "@SUM(A1)",
);
const hostileText = fc
  .array(fc.oneof(fragment, fc.string({ unit: "binary", maxLength: 6 })), { maxLength: 8 })
  .map((parts) => parts.join(""));
const text = fc.oneof(hostileText, fc.string({ unit: "grapheme", maxLength: 20 }));

// ---- card generator -----------------------------------------------------------------

const count = fc.nat({ max: 5000 });
const card: fc.Arbitrary<DiskCardView> = fc
  .record({
    diskId: fc.stringMatching(/^[0-9a-f]{64}$/),
    relPath: text,
    label: text,
    sizeBytes: fc.nat({ max: 2 ** 31 }),
    geometry: fc.record({
      source: fc.constantFrom("bpb" as const, "fallback" as const, "none" as const),
      label: fc.option(text, { nil: null }),
    }),
    fileCount: count,
    totalEntries: count,
    entriesTruncated: fc.boolean(),
    dateFirst: fc.option(text, { nil: null }),
    dateLast: fc.option(text, { nil: null }),
    formats: fc.subarray(["markdown", "csv", "png", "text"] as const),
    counts: fc.record({ alive: count, recovered: count, partial: count, lost: count }),
    warnings: fc.array(fc.record({ code: text, message: text }), { maxLength: 3 }),
    status: fc.constantFrom("new" as const, "catalogued" as const, "summarised" as const),
    firstSeen: text,
    summary: fc.option(
      fc.record({ text, savedAt: text, agent: fc.constant("exhume-archivist" as const) }),
      { nil: null },
    ),
    notes: fc.array(
      fc.record({ id: text, text, savedAt: text, agent: fc.constant("exhume-undertaker" as const) }),
      { maxLength: 3 },
    ),
  })
  .map((c) => c as DiskCardView);

// ---- independent expectation --------------------------------------------------------

/** Expected raw value per column, written out separately from the implementation. */
function expectedRaw(c: DiskCardView): string[] {
  return [
    c.diskId,
    c.relPath,
    c.label,
    String(c.sizeBytes),
    c.geometry.source,
    c.geometry.label ?? "",
    String(c.fileCount),
    String(c.totalEntries),
    String(c.entriesTruncated),
    c.dateFirst ?? "",
    c.dateLast ?? "",
    c.formats.join(" "),
    String(c.counts.alive),
    String(c.counts.recovered),
    String(c.counts.partial),
    String(c.counts.lost),
    c.warnings.map((w) => `${w.code}: ${w.message}`).join("\n"),
    c.status,
    c.firstSeen,
    c.summary === null ? "" : c.summary.text,
    c.notes.map((n) => n.text).join("\n"),
  ];
}

/** Control-character removal (keeping tab, CR, LF) then the single-quote prefix. */
function expectedCell(raw: string): string {
  // Lone surrogates become U+FFFD (as String.prototype.toWellFormed does).
  const wellFormed = raw.replace(
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
    "\ufffd",
  );
  const cleaned = wellFormed.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  return /^[=+\-@\t\r]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

/** True when the independently parsed CSV matches the cards exactly. */
function roundTrips(cards: readonly DiskCardView[]): boolean {
  const csv = toCsv(cards);
  if (!csv.endsWith("\r\n")) return false;
  const rows: string[][] = parse(csv, { relax_column_count: false, skip_empty_lines: false });
  if (rows.length !== cards.length + 1) return false;
  const header = rows[0] ?? [];
  if (header.length !== CSV_COLUMNS.length || header.some((h, i) => h !== CSV_COLUMNS[i])) return false;
  for (let r = 0; r < cards.length; r++) {
    const row = rows[r + 1];
    const card = cards[r];
    if (row === undefined || card === undefined) return false;
    const expected = expectedRaw(card).map(expectedCell);
    if (row.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) if (row[i] !== expected[i]) return false;
  }
  return true;
}

describe("Feature: crew-app, Property 22: CSV round trip", () => {
  it("zero cards yields only the header row", () => {
    const rows: string[][] = parse(toCsv([]), { skip_empty_lines: false });
    const ok = rows.length === 1 && (rows[0] ?? []).join(",") === CSV_COLUMNS.join(",");
    if (!ok) throw new Error(`unexpected rows: ${JSON.stringify(rows)}`);
  });

  it("parsing toCsv(cards) returns the header and one sanitised row per card (0 to 50 cards)", () => {
    fc.assert(
      fc.property(fc.array(card, { maxLength: 50 }), (cards) => roundTrips(cards)),
      { numRuns: NUM_RUNS },
    );
  });

  it(
    "holds for large lists of up to 10,000 cards",
    () => {
      const seeds = fc.array(card, { minLength: 1, maxLength: 20 });
      const sizes = fc.constantFrom(1000, 5000, 10000);
      fc.assert(
        fc.property(seeds, sizes, (seed, n) => {
          const cards = Array.from({ length: n }, (_, i) => seed[i % seed.length] as DiskCardView);
          return roundTrips(cards);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    LARGE_TIMEOUT_MS,
  );
});
